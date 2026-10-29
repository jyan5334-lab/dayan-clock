const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'work'), { recursive:true });
const testDir = fs.mkdtempSync(path.join(root, 'work/shell-'));
const data = path.join(testDir, 'data');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data,'preferences.json'),JSON.stringify({settingsGuideVersion:1,style:1,windowLayers:{unlocked:'bottom',locked:'top'},bounds:{x:50,y:50,width:800,height:568}}));
const packaged = process.argv.includes('--packaged');
const env = {...process.env,DAYAN_TEST:'1',DAYAN_TEST_DATA:data};
delete env.ELECTRON_RUN_AS_NODE;
const native = args => {
  const result=spawnSync(path.join(root,'assets/DAYANDesktopHost.exe'),args.map(String),{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
const inspect = () => native(['inspect']).windows;
const probe = path.join(testDir,'shell-probe.exe');
const quote = value => "'"+value.replaceAll("'","''")+"'";
const wpf=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/WPF');
const references=['System.dll','System.Core.dll','System.Web.Extensions.dll','System.Drawing.dll',...['WindowsBase.dll','UIAutomationClient.dll','UIAutomationTypes.dll'].map(name=>path.join(wpf,name))];
const command=`Add-Type -Path ${quote(path.join(__dirname,'desktop-shell-probe.cs'))} -ReferencedAssemblies @(${references.map(quote).join(',')}) -OutputAssembly ${quote(probe)} -OutputType ConsoleApplication`;
const compile=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
assert.equal(compile.status,0,compile.stderr);
let desktop;
const checks=[],errors=[];
(async()=>{
  desktop=await _electron.launch({executablePath:packaged?path.join(root,'release/win-unpacked/DAYANClock.exe'):require(path.join(root,'node_modules/electron')),args:packaged?[]:[root],env});
  desktop.process().stderr.on('data',chunk=>fs.appendFileSync(path.join(testDir,'app.log'),chunk));
  const page=await desktop.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('html[data-ready=true]');
  for(let attempt=0;attempt<100;attempt++){
    if(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()))break;
    await page.waitForTimeout(50);
  }
  const hwnd=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const ownerPid=await desktop.evaluate(()=>process.pid);
  const started=Date.now();
  await page.evaluate(()=>window.dayan.windowAction('fullscreen'));
  const fullscreenMilliseconds=Date.now()-started;
  await page.waitForTimeout(200);
  const windows=inspect();
  const target=windows.find(item=>item.handle===hwnd),icons=windows.find(item=>item.cls==='SHELLDLL_DefView');
  assert.ok(target,'Application must be an actual Explorer child');
  assert.equal(native(['snapshot',hwnd,ownerPid]).transparent,true,'Wallpaper must pass input through to Explorer');
  const expected=await desktop.evaluate(({screen,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];return screen.dipToScreenRect(win,screen.getDisplayMatching(win.getBounds()).bounds);});
  for(const key of ['x','y','width','height'])assert.equal(target[key],expected[key],`Native display ${key}`);
  assert.equal(target.visible,true);
  assert.ok(target.parent===icons.parent || windows.find(item=>item.handle===target.parent)?.cls==='WorkerW');
  assert.ok(windows.indexOf(icons)<windows.indexOf(target),'Icons must precede wallpaper in native Z order');
  const list=windows.find(item=>item.cls==='SysListView32');
  assert.equal(list.visible,true);
  checks.push('Native Explorer icon layer is above visible, correctly sized wallpaper');
  let contextPoint;
  for(const x of [expected.x+expected.width-180,expected.x+480,expected.x+180]){
    for(const y of [expected.y+expected.height-200,expected.y+200]){
      if(native(['point',x,y]).window.handle===list.handle){contextPoint={x,y};break;}
    }
    if(contextPoint)break;
  }
  assert.ok(contextPoint,'An uncovered desktop test point is required');
  const menuProcess=spawnSync(probe,[list.handle,String(contextPoint.x),String(contextPoint.y),path.join(testDir,'actual-desktop.png'),...['x','y','width','height'].map(key=>String(expected[key]))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(menuProcess.status,0,menuProcess.stderr);
  const menu=JSON.parse(menuProcess.stdout);
  fs.writeFileSync(path.join(testDir,'context-menu.json'),JSON.stringify(menu,null,2));
  assert.ok(menu.iconCount>0,'Desktop must contain real icons');
  assert.equal(menu.menuOpened,true,'Explorer desktop context menu must open');
  assert.ok(menu.items.some(item=>/刷新|Refresh/.test(item)),JSON.stringify(menu));
  assert.ok(menu.items.some(item=>/新建|New/.test(item)),JSON.stringify(menu));
  checks.push('Real Explorer context menu opens with Refresh and New, without modifying files');
  await page.screenshot({path:path.join(testDir,'wallpaper.png')});
  await page.evaluate(()=>window.dayan.securitySetPassword({current:'',next:'123456'}));
  // Feed a deterministic edge position to the app; do not move the user's cursor.
  const displays=await desktop.evaluate(({screen})=>screen.getAllDisplays());
  let edge;
  for(const display of displays){
    const point={x:display.bounds.x+display.bounds.width-190,y:display.bounds.y};
    const physical=await desktop.evaluate(({screen},point)=>screen.dipToScreenPoint(point),point);
    if(['SysListView32','SHELLDLL_DefView','WorkerW','Progman'].includes(native(['point',physical.x,physical.y]).window.cls)){edge=point;break;}
  }
  if(edge){
    await desktop.evaluate(({screen},point)=>{globalThis.originalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>point;},edge);
    let toolbar;
    for(let attempt=0;attempt<50;attempt++){
      toolbar=desktop.windows().find(candidate=>candidate.url().includes('wallpaper-controls.html'));
      if(toolbar)break;
      await page.waitForTimeout(100);
    }
    assert.ok(toolbar,'Top-edge toolbar must appear');
    await toolbar.locator('[data-action="lock"]').click();
    await desktop.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.originalCursor;});
    checks.push('Separate top-edge toolbar can lock while wallpaper remains below icons');
  }else{
    await page.evaluate(()=>window.dayan.securityLock());
    checks.push('Top-edge toolbar not exercised: another app covers all display edges');
  }
  await page.waitForFunction(()=>document.documentElement.classList.contains('locked'));
  await page.waitForTimeout(500);
  assert.equal(inspect().some(item=>item.handle===hwnd),false,'Lock must detach desktop child');
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/index.html')).isKiosk()),true);
  assert.equal(await page.evaluate(()=>window.dayan.securityVerify('123456')),true);
  assert.equal(native(['snapshot',hwnd,ownerPid]).transparent,false,'Ordinary window must regain real native mouse input');
  await page.waitForTimeout(200);
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/index.html')).getBounds().width),800);
  checks.push('Lock/unlock restores input, kiosk and original ordinary bounds');
  for(let count=0;count<3;count++){
    await page.evaluate(()=>window.dayan.windowAction('fullscreen'));
    for(let attempt=0;attempt<30 && !inspect().some(item=>item.handle===hwnd);attempt++) await page.waitForTimeout(50);
    assert.ok(inspect().some(item=>item.handle===hwnd),JSON.stringify(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({url:win.webContents.getURL(),bounds:win.getBounds(),hwnd:win.getNativeWindowHandle().readBigUInt64LE().toString(),fullscreen:win.isFullScreen(),kiosk:win.isKiosk()})))));
    await page.evaluate(()=>window.dayan.windowAction('fullscreen'));
    await page.waitForTimeout(150);
    assert.equal(inspect().some(item=>item.handle===hwnd),false);
  }
  checks.push('Three repeated native attach/detach cycles passed');
  if(edge){
    await page.evaluate(()=>window.dayan.windowAction('fullscreen'));
    await page.waitForSelector('html[data-desktop-hosted="true"]');
    await desktop.evaluate(({screen},point)=>{globalThis.originalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>point;},edge);
    const toolbar=desktop.windows().find(candidate=>candidate.url().includes('wallpaper-controls.html'));
    await toolbar.locator('[data-action="settings-toggle"]').click();
    await page.waitForSelector('#settings-modal:not([hidden])');
    await desktop.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.originalCursor;});
    assert.equal(inspect().some(item=>item.handle===hwnd),false);
    checks.push('Top-edge settings control returns to an interactive ordinary window');
  }
  assert.deepEqual(errors,[]);
  const report={result:'passed',packaged,testDir,fullscreenMilliseconds,iconCount:menu.iconCount,contextMenu:menu.items,checks,errors};
  fs.writeFileSync(path.join(testDir,'validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(desktop)await desktop.close();});
