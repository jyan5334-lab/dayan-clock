const workspacePaths = require('./workspace-paths.cjs');
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
function checkDirector(){
 const sandbox={};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/backgrounds/dynamic/island-director.js'),'utf8'),sandbox);
 const d=sandbox.DayanIslandDirector;
 for(const [h,slot] of [[8,'morning'],[9,'morning'],[13,'noon'],[17,'evening'],[18,'evening'],[22,'night'],[23,'night'],[0,'night'],[15,null]]){
  const date=new Date(2026,10,22,h,0,0);assert.equal(d.period(date),slot);assert.equal(Boolean(d.greeting(date)),Boolean(slot));assert.equal(d.localHour(date),h);
 }
 let previous='',changes=0,last=0;
 for(let s=0;s<=24*3600;s++){
  const shot=d.shot(new Date(2026,10,22,0,0,s));assert.ok(['follow','side','orbit','aerial'].includes(shot.mode));
  if(shot.mode!==previous){if(previous){assert.ok(s-last>=180&&s-last<=300);changes++;}last=s;previous=shot.mode;}
 }
 assert.ok(changes>200);
}
async function checkIslandWallpaper(browser,output){
 checkDirector();
 const context=await browser.newContext({viewport:{width:1280,height:720},offline:true});
 const page=await context.newPage(),errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 await page.addInitScript(()=>{window.__audioCalls=0;window.AudioContext=window.webkitAudioContext=function(){window.__audioCalls++;throw Error('Wallpaper must be silent');};});
 await page.goto(pathToFileURL(path.join(root,'assets/backgrounds/dynamic/island.html')).href+'?scene=pelican-island&test=1');
 await page.waitForFunction(()=>window.__appReady,null,{timeout:60000});
 const start=await page.evaluate(()=>window.__pelican.ride.dist);
 await page.waitForFunction(before=>window.__pelican.ride.dist>before+.2,start);
 const coverage=[];
 const sizes=[[800,600],[1920,1080],[1920,1200],[2560,1080],[3440,1440],[3840,1080],[1080,1920],[360,780]];
 const shots=[['follow','2026-11-22T08:01:00'],['side','2026-11-22T08:05:00'],['orbit','2026-11-22T08:09:00'],['aerial','2026-11-22T08:14:00']];
 for(const [mode,date] of shots){
  await page.evaluate(date=>window.__pelican.setTestDate(date),date);
  await page.waitForFunction(mode=>window.__pelican.cam.mode===mode&&window.__pelican.cam.blend===1,mode,{timeout:45000});
  const cameraState=await page.evaluate(()=>{
   const p=window.__pelican;
   const dx=p.camera.position.x-p.ride.x,dz=p.camera.position.z-p.ride.z;
   const fx=Math.cos(p.ride.h),fz=-Math.sin(p.ride.h);
   return {rearDot:dx*fx+dz*fz,castShadow:p.sunLight.castShadow};
  });
  if(mode==='aerial')assert.equal(cameraState.castShadow,false,'aerial view must disable dynamic shadows');
  else assert.ok(cameraState.rearDot<-.5,mode+' camera must stay behind the rider: '+cameraState.rearDot);
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});
   await page.waitForFunction(ratio=>Math.abs(window.__pelican.camera.aspect-ratio)<.001,width/height);
   for(const route of [0,.25,.5,.75]){
    const frame=await page.evaluate(route=>{window.__pelican.setTestRoute(route);return window.__pelican.getState().frames;},route);
    await page.waitForFunction(frame=>window.__pelican.getState().frames>frame+2,frame);
    const geometry=await page.evaluate(()=>{
     const p=window.__pelican,c=document.querySelector('canvas'),box=new p.THREE.Box3().setFromObject(p.bike.root).expandByObject(p.pelican.root),points=[];
     for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new p.THREE.Vector3(x,y,z).project(p.camera).toArray());
     const rect=c.getBoundingClientRect();return {rect:{width:rect.width,height:rect.height,x:rect.x,y:rect.y},buffer:[c.width,c.height],points};
    });
    assert.deepEqual(geometry.rect,{width,height,x:0,y:0});assert.ok(Math.abs(geometry.buffer[0]/geometry.buffer[1]-width/height)<.025);
    assert.ok(geometry.points.every(([x,y,z])=>Math.abs(x)<.98&&Math.abs(y)<.98&&z<1),mode+' crops rider at '+width+'x'+height+' route '+route+': '+JSON.stringify(geometry.points));
   }
   const buffer=await page.screenshot({path:path.join(output,'island-'+mode+'-'+width+'x'+height+'.png')});
   const pixels=await page.evaluate(async b64=>{
    const image=new Image();image.src='data:image/png;base64,'+b64;await image.decode();const c=document.createElement('canvas');c.width=96;c.height=64;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,96,64);const d=ctx.getImageData(0,0,96,64).data,colors=new Set();let edgeBase=0,edges=0;
    for(let y=0;y<64;y++)for(let x=0;x<96;x++){const i=(y*96+x)*4;colors.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));if(x===0||x===95||y===0||y===63){edges++;if(Math.abs(d[i]-13)+Math.abs(d[i+1]-21)+Math.abs(d[i+2]-34)<6)edgeBase++;}}
    return {colors:colors.size,edgeBase,edges};
   },buffer.toString('base64'));
   assert.ok(pixels.colors>16,'3D output is blank');assert.ok(pixels.edgeBase<pixels.edges*.1,'Unpainted bars at scene edge');coverage.push({mode,width,height,pixels});
  }
 }
 await page.evaluate(()=>window.__pelican.setTestDate('2026-11-22T23:05:00'));
 await page.waitForFunction(()=>window.__pelican.getState().night>.8);
 const night=await page.evaluate(()=>window.__pelican.getState());
 await page.evaluate(()=>window.__pelican.setTestDate('2026-11-22T08:05:00'));
 await page.waitForFunction(()=>window.__pelican.getState().night<.1&&!document.getElementById('greeting').hidden,null,{timeout:45000});
 assert.match(await page.locator('#greeting').textContent(),/早|一天/);
 await page.waitForFunction(()=>window.__pelican.getState().timeScale===1&&document.getElementById('greeting').hidden,null,{timeout:20000});
 assert.equal(await page.evaluate(()=>window.__audioCalls),0);assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
 const state=await page.evaluate(()=>window.__pelican.getState());await context.close();
 return {scene:'pelican-island',animationAdvances:true,offline:true,silent:true,localTime:true,night,coverage,state};
}
module.exports={checkDirector,checkIslandWallpaper};
if(require.main===module){
 const {chromium}=require(process.env.DAYAN_PLAYWRIGHT_MODULE||'playwright');
 const output=process.env.DAYAN_ISLAND_OUTPUT||workspacePaths.output('island-3d-20261122/source');fs.mkdirSync(output,{recursive:true});
 (async()=>{const b=await chromium.launch({headless:true,args:['--allow-file-access-from-files'],...(process.platform==='win32'?{executablePath:process.env.DAYAN_BROWSER_EXE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{})});try{const result=await checkIslandWallpaper(b,output);fs.writeFileSync(path.join(output,'island-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:'PASS',coverage:result.coverage.length,output}));}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}

