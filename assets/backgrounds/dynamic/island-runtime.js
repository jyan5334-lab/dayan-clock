const director=window.DayanIslandDirector;
let environmentReady=false;
const cam={mode:'',focus:V3(),fromP:V3(),fromT:V3(),lastRider:V3(),followBlend:false,blend:1,init:false};
const desiredP=V3(),desiredT=V3(),offset=V3(),projected=V3(),forward=V3(),left=V3();
const greetingEl=document.getElementById('greeting');
let greetingsAllowed=window.parent===window, greetingUntil=0, greetingAt=-Infinity, greetingSlot='', slowUntil=0, actionAt=Infinity;
let simTime=0, frameCount=0, lastTime=0, raf=0, suspended=false, contextLost=false, hour=0, qualityTier=0, renderCost=0;
let dateProvider=()=>new Date();
const nowDate=()=>dateProvider();
function setCamMode(mode,animate=true){
  if(!['follow','side','orbit','aerial'].includes(mode)||mode===cam.mode)return;
  cam.followBlend=cam.mode!=='aerial'&&mode!=='aerial';
  cam.fromP.copy(camera.position);cam.fromT.copy(cam.focus);cam.lastRider.set(ride.x,0,ride.z);cam.mode=mode;cam.blend=animate&&cam.init?0:1;
  actionAt=performance.now()+6500;
}
function updateCamera(dt,date){
  const shot=director.shot(date);setCamMode(shot.mode);
  const fit=Math.max(1,Math.min(1.4,1.1/camera.aspect));
  const fov=camera.aspect<1?70:54;
  if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
  forward.set(Math.cos(ride.h),0,-Math.sin(ride.h));
  left.set(Math.sin(ride.h),0,Math.cos(ride.h));
  // Aim down the road instead of directly at the rider. The lower target
  // keeps the horizon and the rider's waving upper body in the same frame.
  desiredT.set(ride.x+2.8*forward.x,.55,ride.z+2.8*forward.z);
  if(cam.mode==='aerial'){
    const angle=shot.phase*.28;
    desiredP.set(-140*Math.cos(angle)*fit,115*fit,165*Math.cos(angle)*fit);desiredT.set(0,0,0);
  }else{
    // Keep the rider in a rear three-quarter composition so the road and
    // scenery ahead remain visible during every close camera shot.
    if(cam.mode==='follow'){
      desiredP.copy(desiredT)
        .addScaledVector(forward,-5.8*fit)
        .addScaledVector(left,-1.25*fit);
      desiredP.y+=1.55*fit;
    }else if(cam.mode==='side'){
      desiredP.copy(desiredT)
        .addScaledVector(forward,-5.5*fit)
        .addScaledVector(left,2.15*fit);
      desiredP.y+=1.45*fit;
    }else{
      const lateral=lerp(-2.4,2.4,smooth(0,1,shot.phase));
      desiredP.copy(desiredT)
        .addScaledVector(forward,-5.9*fit)
        .addScaledVector(left,lateral*fit);
      desiredP.y+=(1.6+0.12*Math.sin(shot.phase*Math.PI))*fit;
    }
  }
  if(cam.blend<1&&cam.followBlend){
    const dx=ride.x-cam.lastRider.x,dz=ride.z-cam.lastRider.z;
    cam.fromP.x+=dx;cam.fromP.z+=dz;cam.fromT.x+=dx;cam.fromT.z+=dz;
  }
  cam.lastRider.set(ride.x,0,ride.z);
  cam.blend=Math.min(1,cam.blend+dt/8);
  const t=cam.blend*cam.blend*(3-2*cam.blend);
  if(cam.blend<1){camera.position.lerpVectors(cam.fromP,desiredP,t);cam.focus.lerpVectors(cam.fromT,desiredT,t);}
  else{camera.position.copy(desiredP);cam.focus.copy(desiredT);}
  camera.position.y=Math.max(camera.position.y,groundY(camera.position.x,camera.position.z)+1.6);
  camera.lookAt(cam.focus);camera.updateMatrixWorld();cam.init=true;
}
function stabilizeSceneDepth(){
  // Render the terrain first, then water and road. Water does not write a
  // competing depth value, so the shoreline cannot alternate between meshes.
  terrain.renderOrder=0;
  ocean.renderOrder=1;
  ocean.material.depthTest=true;
  ocean.material.depthWrite=false;
  road.renderOrder=2;
  road.material.polygonOffset=true;
  road.material.polygonOffsetFactor=-1;
  road.material.polygonOffsetUnits=-1;
  for(const mat of [lineMat,centerMat]){
    mat.polygonOffset=true;
    mat.polygonOffsetFactor=-2;
    mat.polygonOffsetUnits=-2;
  }
  for(const mat of [vegMat,palmMat,grassMat,flowerMat]){
    mat.polygonOffset=true;
    mat.polygonOffsetFactor=-1;
    mat.polygonOffsetUnits=-1;
  }
  // Window materials are created inside the village builder, so find them by
  // their stable colors after the world has been assembled.
  scene.traverse(obj=>{
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    for(const mat of mats){
      if(!mat?.color)continue;
      const color=mat.color.getHex();
      if(color!==0x3a4655&&color!==0x33404e)continue;
      mat.polygonOffset=true;
      mat.polygonOffsetFactor=-1;
      mat.polygonOffsetUnits=-1;
    }
  });
  const compileOcean=ocean.material.onBeforeCompile;
  ocean.material.onBeforeCompile=(shader,renderer)=>{
    compileOcean(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace(
      'diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 5.5, vDepth));',
      'if(vDepth < -0.08) discard;\n         diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 5.5, vDepth));'
    );
  };
  ocean.material.needsUpdate=true;
}
function showGreeting(date,now){
  const slot=director.period(date);
  if(greetingSlot&&slot!==greetingSlot){greetingUntil=0;greetingAt=-Infinity;greetingSlot='';}
  if(!greetingsAllowed||!slot||cam.mode==='aerial'||cam.blend<1||now-greetingAt<12*60*1000)return;
  if(greetingSlot===slot&&now-greetingAt<16*60*1000)return;
  greetingEl.textContent=director.greeting(date);greetingUntil=now+10000;greetingAt=now;greetingSlot=slot;
  pelican.greet(-1);slowUntil=now+4300;
}
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.data?.type!=='dayan:wallpaper-context'||typeof event.data.greetings!=='boolean')return;
  greetingsAllowed=event.data.greetings;
  if(!greetingsAllowed){greetingEl.hidden=true;greetingUntil=0;}
});
function positionGreeting(now){
  if(!greetingsAllowed||now>=greetingUntil||cam.mode==='aerial'){greetingEl.hidden=true;return;}
  pelican.head.getWorldPosition(projected);projected.y+=.25;projected.project(camera);
  if(projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1){greetingEl.hidden=true;return;}
  greetingEl.hidden=false;
  const x=(projected.x*.5+.5)*innerWidth,y=(-projected.y*.5+.5)*innerHeight;
  greetingEl.style.left=Math.max(16,Math.min(innerWidth-greetingEl.offsetWidth-16,x+22))+'px';
  greetingEl.style.top=Math.max(20,Math.min(innerHeight-greetingEl.offsetHeight-20,y-greetingEl.offsetHeight-22))+'px';
}
function degradeQuality(){
  if(qualityTier>=3)return;
  qualityTier++;
  if(qualityTier===1)pixelRatio=Math.max(1,pixelRatio*.86);
  if(qualityTier===2)bloomPass.enabled=false;
  if(qualityTier===3){
    sunLight.shadow.mapSize.set(1024,1024);
    if(sunLight.shadow.map){sunLight.shadow.map.dispose();sunLight.shadow.map=null;}
  }
  renderer.setPixelRatio(pixelRatio);composer.setPixelRatio(pixelRatio);onResize();
}
function frame(now){
  if(suspended||contextLost)return;raf=requestAnimationFrame(frame);
  if(lastTime&&now-lastTime<32)return;
  const rdt=Math.min(lastTime?(now-lastTime)/1000:1/30,.065);lastTime=now;
  const started=performance.now(),date=nowDate();hour=director.localHour(date);
  updateTimeOfDay(hour);
  ride.timeScale=now<slowUntil?.55:1;
  const dt=rdt*ride.timeScale;simTime+=dt;uTime.value=simTime;
  stepRide(dt,simTime);bike.root.updateMatrixWorld();bike.root.worldToLocal(camLocal.copy(camera.position));
  pelican.update(dt,{time:simTime,theta:ride.crank,speed:ride.v,effort:ride.effort,lean:ride.lean,pedal:pedalPos,pedalPitch,grip:gripPos,turnK:ride.turnK,stopped:ride.v<.1,camLocal});
  for(const f of world.update)f(dt,simTime);
  const n=env.night;bike.headlight.intensity=n*60;bike.lensMat.emissiveIntensity=.1+n*8;
  bike.rearLightMat.emissiveIntensity=.3+n*2.2*(.75+.25*Math.sin(simTime*6));
  updateCamera(rdt,date);sky.position.copy(camera.position);
  const shadowEnabled=cam.mode!=='aerial';
  if(sunLight.castShadow!==shadowEnabled){
    sunLight.castShadow=shadowEnabled;
    sunLight.shadow.needsUpdate=true;
  }
  const ld=sunLight.userData.dir||sunDir;
  const shadowLead=shadowEnabled?8:0;
  sunLight.target.position.set(
    ride.x+.5+Math.cos(ride.h)*shadowLead,
    0,
    ride.z-Math.sin(ride.h)*shadowLead
  );
  sunLight.position.copy(sunLight.target.position).addScaledVector(ld,80);
  if(now>=actionAt&&cam.mode!=='aerial'){pelican.greet(-1);slowUntil=now+3500;actionAt=Infinity;}
  showGreeting(date,now);positionGreeting(now);composer.render();frameCount++;
  renderCost=renderCost*.97+(performance.now()-started)*.03;
  if(frameCount%600===0&&renderCost>38)degradeQuality();
  if(!window.__appReady){window.__appReady=true;document.documentElement.dataset.ready='true';document.getElementById('loader').hidden=true;}
}
function resume(){
  cancelAnimationFrame(raf);lastTime=0;suspended=document.hidden;
  if(!suspended&&!contextLost)raf=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',resume);
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(raf);});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;updateTimeOfDay(director.localHour(nowDate()),true);resume();});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);});
ride.vTarget=17/3.6;ride.v=ride.vTarget;
stabilizeSceneDepth();
// Render the first frame without blocking on a full PMREM rebuild. Refresh the
// environment during idle time so background switching reaches the desktop
// quickly while retaining the original lighting quality afterwards.
updateTimeOfDay(director.localHour(nowDate()),false);
const scheduleIdle=window.requestIdleCallback
  ? callback=>window.requestIdleCallback(callback,{timeout:1500})
  : callback=>window.setTimeout(callback,80);
scheduleIdle(()=>{if(!contextLost)updateTimeOfDay(director.localHour(nowDate()),true);});
window.__pelican={THREE,scene,camera,renderer,composer,bloomPass,sunLight,ride,bike,pelican,cam,
  getState:()=>({hour,night:env.night,mode:cam.mode,frames:frameCount,timeScale:ride.timeScale,greetingsAllowed,qualityTier,renderCost}),
  setTestDate:date=>{if(new URLSearchParams(location.search).get('test')==='1')dateProvider=()=>new Date(date);},
  setTestRoute:fraction=>{if(new URLSearchParams(location.search).get('test')==='1')ride.s=Math.max(0,Math.min(1,fraction))*ROAD_LEN;}

};
resume();

