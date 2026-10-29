const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { _electron } = require(process.env.DAYAN_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const testDir = fs.mkdtempSync(path.join(root, 'work/keyboard-'));
const data = path.join(testDir, 'data');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'preferences.json'), JSON.stringify({ settingsGuideVersion:1, windowLayers:{unlocked:'bottom',locked:'top'}, bounds:{x:50,y:50,width:800,height:568} }));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const probeExe = path.join(testDir, 'keyboard-probe.exe');
const compileCommand = `Add-Type -Path ${quote(path.join(__dirname, 'keyboard-probe.cs'))} -ReferencedAssemblies System.dll,System.Core.dll,System.Web.Extensions.dll,System.Windows.Forms.dll -OutputAssembly ${quote(probeExe)} -OutputType ConsoleApplication`;
const compile = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(compileCommand,'utf16le').toString('base64')], {encoding:'utf8',windowsHide:true});
assert.equal(compile.status,0,compile.stderr);
let desktop, probe, rawGuard, requestId = 0;
let targetWindow, focusPoint;
const requests = new Map(), checks = [];
const packaged = process.argv.includes('--packaged');
const key = (vk,scan=0) => [{vk,scan,flags:0},{vk,scan,flags:2}];
const chord = (...vks) => [...vks.map(vk=>({vk,scan:0,flags:0})),...vks.reverse().map(vk=>({vk,scan:0,flags:2}))];
async function send(events,click=false) {
  const id = ++requestId;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{requests.delete(id);reject(Error(`Probe timeout at request ${id}; completed: ${checks.join('; ')}`));},5000);
    requests.set(id,result=>{clearTimeout(timeout);if(result.error){reject(Error(result.error));return;}if(result.sent!==events.length){reject(Error('Native input injection incomplete'));return;}resolve(result);});
    probe.stdin.write(JSON.stringify({id,command:'keys',events,window:Number(targetWindow),click,...focusPoint})+'\n');
  });
}
async function nativeGuard(hwnd,pid) {
  const child=rawGuard=spawn(path.join(root,'assets/DAYANKeyboardGuard.exe'),[hwnd,String(pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=createInterface({input:child.stdout});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Raw guard not ready')),5000);
    lines.on('line',line=>{const message=JSON.parse(line);if(message.type==='ready'){clearTimeout(timer);resolve();}else if(message.type==='error'){clearTimeout(timer);reject(Error(message.error));}});
  });
  return child;
}
(async()=>{
  probe=spawn(probeExe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  probe.stderr.on('data',chunk=>fs.appendFileSync(path.join(testDir,'probe-error.log'),chunk));
  const lines=createInterface({input:probe.stdout});
  await new Promise(resolve=>lines.once('line',line=>{assert.equal(JSON.parse(line).ready,true);resolve();}));
  lines.on('line',line=>{const result=JSON.parse(line);requests.get(result.id)?.(result);requests.delete(result.id);});
  const env={...process.env,DAYAN_TEST:'1',DAYAN_TEST_DATA:data}; delete env.ELECTRON_RUN_AS_NODE;
  desktop=await _electron.launch({executablePath:packaged?path.join(root,'release/win-unpacked/DAYANClock.exe'):require(path.join(root,'node_modules/electron')),args:packaged?[]:[root],env});
  const page=await desktop.firstWindow(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('html[data-ready=true]');
  targetWindow=await desktop.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setAlwaysOnTop(true);win.show();win.focus();return win.getNativeWindowHandle().readBigUInt64LE().toString();});
  await page.evaluate(()=>{const input=document.createElement('input');input.type='password';input.id='native-input-probe';input.style.cssText='position:fixed;bottom:4px;left:4px;z-index:99';document.body.append(input);input.focus();});
  const rect=await page.locator('#native-input-probe').boundingBox();
  focusPoint=await desktop.evaluate(({BrowserWindow,screen},rect)=>{const win=BrowserWindow.getAllWindows()[0],bounds=win.getContentBounds();return screen.dipToScreenPoint({x:Math.round(bounds.x+rect.x+rect.width/2),y:Math.round(bounds.y+rect.y+rect.height/2)});},rect);
  await send([],true);
  await page.locator('#native-input-probe').focus();
  assert.equal((await send(key(0x41))).received,2);
  assert.equal(await page.locator('#native-input-probe').inputValue(),'a',JSON.stringify(await page.evaluate(()=>({active:document.activeElement.id,focused:document.hasFocus()}))));
  checks.push('Downstream native probe and ordinary real keyboard input work before locking');
  assert.equal((await page.evaluate(()=>window.dayan.securitySetPassword({current:'',next:'123456'}))).ok,true);
  assert.equal((await send([{vk:0x11,scan:0,flags:0}])).received,1);
  assert.equal(await page.evaluate(()=>window.dayan.securityLock()),true);
  await page.waitForFunction(()=>document.documentElement.classList.contains('locked'));
  await page.waitForTimeout(400);
  assert.equal((await page.evaluate(()=>window.dayan.load())).keyboardGuardActive,true);
  assert.equal((await send([{vk:0x11,scan:0,flags:2}])).received,0);
  const shortcuts=[['Left Win',key(0x5B)],['Right Win',key(0x5C)],['Win+R',chord(0x5B,0x52)],['Win+E',chord(0x5B,0x45)],['Win+S',chord(0x5B,0x53)],['Alt+Tab',chord(0x12,0x09)],['Alt+F4',chord(0x12,0x73)],['Ctrl+Esc',chord(0x11,0x1B)],['Ctrl+Shift+Esc',chord(0x11,0x10,0x1B)],['A / Tab / Esc / F11',[...key(0x41),...key(0x09),...key(0x1B),...key(0x7A)]]];
  for(const [label,events] of shortcuts)assert.equal((await send(events)).received,0,`${label} reached the Windows input chain`);
  assert.equal((await send([...key(0x31),...key(0x62)])).received,0);
  assert.equal(await page.locator('#unlock-password').inputValue(),'');
  checks.push('Native Win keys, common system shortcuts and ordinary keys are swallowed; closed unlock panel accepts no digits');
  await page.mouse.move(30,2);
  await page.locator('#lock').click();
  await page.waitForSelector('#unlock-panel:not([hidden])');
  await page.waitForTimeout(150);
  await send(chord(0x10,0x34));
  assert.equal(await page.locator('#unlock-password').inputValue(),'');
  await send([...key(0x30),...key(0x30),...key(0x30),...key(0x30),...key(0x0D)]);
  await page.waitForSelector('#unlock-error:not([hidden])');
  assert.equal((await page.evaluate(()=>window.dayan.load())).locked,true);
  await send([...key(0x31),...key(0x39),...key(0x08),...key(0x32),...key(0x22,0x51),...key(0x25,0x4B),...key(0x0C,0x4C),...key(0x27,0x4D)]);
  assert.equal(await page.locator('#unlock-password').inputValue(),'123456');
  await send(key(0x0D));
  await page.waitForFunction(()=>!document.documentElement.classList.contains('locked'));
  assert.equal((await page.evaluate(()=>window.dayan.load())).keyboardGuardActive,false);
  await page.locator('#native-input-probe').fill('');
  await send(key(0x41));
  assert.equal(await page.locator('#native-input-probe').inputValue(),'a');
  checks.push('Only digits, Backspace and Enter reach the password field; wrong password stays locked; mixed number-row/keypad input unlocks and restores keyboard, including Ctrl held before locking');
  const helperFile=path.join(data,'native',fs.readdirSync(path.join(data,'native')).find(file=>file.startsWith('keyboard-guard-')));
  fs.renameSync(helperFile,helperFile+'.test-backup');
  await desktop.evaluate(({dialog})=>{globalThis.originalMessageBox=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:0});});
  try{ assert.equal(await page.evaluate(()=>window.dayan.securityLock()),false); }
  finally{fs.renameSync(helperFile+'.test-backup',helperFile);await desktop.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.originalMessageBox;});}
  assert.equal((await page.evaluate(()=>window.dayan.load())).locked,false);
  assert.equal((await send(key(0x41))).received,2);
  checks.push('Missing keyboard guard rejects locking and leaves keyboard available');
  const identity=await desktop.evaluate(({BrowserWindow})=>({hwnd:BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString(),pid:process.pid}));
  await nativeGuard(identity.hwnd,identity.pid);
  assert.equal((await send(key(0x41))).received,0);
  await once(rawGuard,'exit'); rawGuard=null;
  await desktop.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setAlwaysOnTop(true);win.focus();});
  assert.equal((await send(key(0x41),true)).received,2);
  checks.push('Missing heartbeat releases the native keyboard hook within the four-second lease');
  await nativeGuard(identity.hwnd,identity.pid);
  assert.equal((await send(key(0x41))).received,0);
  const exited=once(rawGuard,'exit');
  await desktop.close(); desktop=null;
  await exited; rawGuard=null;
  // Observer sees only this test's marked input; no user keystrokes are retained.
  assert.deepEqual(errors,[]);
  checks.push('Owner process exit automatically removes the keyboard hook');
  const report={result:'passed',packaged,testDir,checks,errors,excluded:['Ctrl+Alt+Delete secure desktop','Win+L not injected to avoid locking the user session']};
  fs.writeFileSync(path.join(testDir,'validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  if(rawGuard)rawGuard.kill();
  if(desktop)await desktop.close().catch(()=>{});
  if(probe && probe.exitCode===null){const exited=once(probe,'exit');probe.stdin.end('{"command":"stop"}\n');const timer=setTimeout(()=>probe.kill(),1000);await exited;clearTimeout(timer);}
});
