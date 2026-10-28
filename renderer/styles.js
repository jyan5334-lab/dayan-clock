(() => {
  const catalog = [
    { id:'stage', name:'霓虹矩阵', icon:'circuit-board' },
    { id:'broadcast', name:'液态铬金', icon:'zap' },
    { id:'flip', name:'机械黑曜', icon:'panels-top-left' },
    { id:'orbit', name:'量子光环', icon:'orbit' },
    { id:'terminal', name:'赛博终端', icon:'terminal' },
    { id:'giant', name:'巨幕极简', icon:'maximize', accent:'#ff797f' },
    { id:'bridge', name:'星舰中枢', icon:'scan-line', accent:'#aff9d9' },
    { id:'dust', name:'星尘聚时', icon:'sparkles', accent:'#bcecfb' },
    { id:'circuit', name:'电路脉冲', icon:'circuit-board', accent:'#a8f4dc' },
    { id:'glitch', name:'故障电压', icon:'zap', accent:'#ff738f' },
    { id:'acid', name:'酸性涂鸦', icon:'paintbrush', accent:'#d6ff59' },
    { id:'light', name:'光速轨迹', icon:'move-right', accent:'#cdf8ff' },
    { id:'orbits', name:'三体星轨', icon:'orbit', accent:'#f2ba9f' },
    { id:'spectrum', name:'光谱脉冲', icon:'audio-lines', accent:'#a1f3e4' }
  ];
  const root=document.getElementById('simple-timers'),menu=document.getElementById('style-menu');
  for(const item of catalog.slice(5)){
    const section=document.createElement('section');section.dataset.variant=item.name;section.hidden=true;root.append(section);
  }
  menu.replaceChildren();
  catalog.forEach((item,index)=>{
    if(index===0||index===5){const label=document.createElement('div');label.className='style-heading';label.textContent=index===0?'经典样式':'新增样式';menu.append(label);}
    const button=document.createElement('button');button.type='button';button.dataset.style=String(index);
    const icon=document.createElement('i');icon.dataset.lucide=item.icon;icon.setAttribute('aria-hidden','true');
    const name=document.createElement('span');name.textContent=item.name;button.append(icon,name);menu.append(button);
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const pad=n=>String(n).padStart(2,'0');
  const tier=(w,a,b,c,d,e)=>w>=840?a:w>=620?b:w>=450?c:w>=340?d:e;
  const rgba=(hex,a)=>{const v=parseInt(hex.slice(1),16);return `rgba(${v>>16&255},${v>>8&255},${v&255},${a})`;};
  function text(c,v,x,y,size,color,weight=500,family='Bahnschrift,"Segoe UI",sans-serif'){c.font=`${weight} ${size}px ${family}`;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.fillText(v,x,y);}
  function line(c,x1,y1,x2,y2,color,width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function arc(c,x,y,r,start,end,color,width=1){c.beginPath();c.arc(x,y,r,start,end);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function path(c,points,color,width=1){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function motion(m,t){return m.options.motion&&!reduced.matches?t.sub:0;}
  function maskFor(m,size,family,weight,y,value){const mask=m.mask||(m.mask=document.createElement('canvas'));if(mask.width!==Math.ceil(m.w)||mask.height!==Math.ceil(m.h)){mask.width=Math.ceil(m.w);mask.height=Math.ceil(m.h);}const c=mask.getContext('2d');c.globalCompositeOperation='source-over';c.clearRect(0,0,mask.width,mask.height);text(c,value,m.w/2,y,size,'#fff',weight,family);return {mask,c};}
  function giant(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,cy=h*.47,size=tier(w,173,143,105,78,67),seconds=tier(w,73,62,49,39,34);
    c.font=`650 ${size}px "Segoe UI",sans-serif`;const hm=`${t.hh}:${t.mm}`,main=c.measureText(hm).width,side=seconds*1.4,gap=25,total=main+gap+side,left=(w-total)/2;
    text(c,hm,left+main/2,cy,size,'#eef9f6',650,'"Segoe UI",sans-serif');
    const sx=left+main+gap;line(c,sx,cy-seconds*.82,sx,cy+seconds*.84,'#d9f4ed40',2);
    line(c,sx,cy+seconds*.84,sx,cy+seconds*.84-seconds*1.66*t.seconds/59,a,2);
    text(c,t.ss,sx+side*.6,cy-8,seconds,a,500,'"Segoe UI",sans-serif');text(c,'秒',sx+side*.6,cy+seconds*.65,12,'#a8bfb6');
    const base=cy+size*.65+15;for(let i=0;i<60;i++){const x=w*.09+w*.82*i/59;line(c,x,base,x,base+(i%5===0?13:6),'#c5e3d65b');}const marker=w*.09+w*.82*t.seconds/60;line(c,marker,base-4,marker,base+17,a,2);
  }
  function bridge(m,t){
    const {ctx:c,w,h}=m;const accent=m.options.accent;const cy=h*.5;const large=tier(w,116,100,77,58,50);const group=tier(w,208,178,129,99,86);const centers=[w/2-group,w/2,w/2+group];
    const top=cy-large*.7-17,bottom=cy+large*.7+24,left=Math.max(8,centers[0]-group*.47),right=Math.min(w-8,centers[2]+group*.47);
    c.strokeStyle=rgba(accent,.52);c.lineWidth=1;c.beginPath();c.moveTo(left,top+19);c.lineTo(left+19,top);c.lineTo(right-19,top);c.lineTo(right,top+19);c.lineTo(right,bottom-19);c.lineTo(right-19,bottom);c.lineTo(left+19,bottom);c.lineTo(left,bottom-19);c.closePath();c.stroke();
    const vals=[t.hh,t.mm,t.ss];
    vals.forEach((v,i)=>{
      c.shadowColor=rgba(accent,.4);c.shadowBlur=m.options.glow/8;text(c,v,centers[i],cy,large,'#effbf6',600,'Bahnschrift,"Segoe UI",sans-serif');c.shadowBlur=0;
      const half=group*.34;
      line(c,centers[i]-half,cy+large*.65,centers[i]+half,cy+large*.65,'#dff7ed24',2);
      line(c,centers[i]-half,cy+large*.65,centers[i]-half+half*2*[t.hours/24,t.minutes/60,t.seconds/60][i],cy+large*.65,accent,2);
      text(c,['时','分','秒'][i],centers[i],bottom+21,12,'#adc6c0');
    });
    for(let i=0;i<2;i++){const x=(centers[i]+centers[i+1])/2;line(c,x,cy-10,x,cy+10,accent,2);}
    for(let i=0;i<41;i++){const x=left+(right-left)*i/40;line(c,x,top-10,x,top-(i%5===0?18:13),'#d8f8eb5e');}
    line(c,left,top+35,left,top+65,accent,3);line(c,right,bottom-35,right,bottom-65,'#ff8c915c',3);
  }
  function makeParticles(m,t){
    const w=m.w,h=m.h;const font=tier(w,140,119,89,66,57);const key=`${t.string}:${w}:${font}`;
    if(key===m.lastParticleText)return;
    const mask=m.mask||(m.mask=document.createElement('canvas'));mask.width=Math.ceil(w);mask.height=Math.ceil(h);const c=mask.getContext('2d',{willReadFrequently:true});
    text(c,t.string,w/2,h*.5,font,'#fff',700,'Consolas,"Courier New",monospace');
    const data=c.getImageData(0,0,mask.width,mask.height).data;const gap=w<450?2.2:3.2;const map=new Map((m.particles||[]).map(p=>[p.key,p]));const next=[];
    for(let y=0;y<h;y+=gap)for(let x=0;x<w;x+=gap){const xi=Math.floor(x),yi=Math.floor(y);if(data[(yi*mask.width+xi)*4+3]<120)continue;const id=`${xi},${yi}`;let p=map.get(id);if(!p){const seed=(Math.sin(x*12.98+y*78.23)*43758.54)%1;p={key:id,x:x+seed*22,y:y-seed*28,tx:x,ty:y,seed};}next.push(p);}
    m.particles=next;m.lastParticleText=key;
  }
  function dust(m,t){
    const {ctx:c,w,h}=m;makeParticles(m,t);const accent=m.options.accent;const motion=m.options.motion&&!reduced.matches;const font=tier(w,140,119,89,66,57);
    text(c,t.string,w/2,h*.5,font,'#e8f9ff13',700,'Consolas,"Courier New",monospace');
    const glow=m.options.glow/13;c.shadowColor=accent;c.shadowBlur=glow;
    for(const p of m.particles){let tx=p.tx,ty=p.ty;if(motion&&m.pointer){const dx=p.tx-m.pointer.x,dy=p.ty-m.pointer.y,d=Math.hypot(dx,dy);if(d<52&&d>0){tx+=dx/d*(52-d)*.3;ty+=dy/d*(52-d)*.3;}}p.x=motion?p.x+(tx-p.x)*.16:tx;p.y=motion?p.y+(ty-p.y)*.16:ty;c.fillStyle=p.seed>.3?accent:'#eafaff';const size=w<450?1.5:1.9;c.fillRect(p.x,p.y,size,size);}
    c.shadowBlur=0;
    const base=h*.5+font*.58+24;line(c,w*.13,base,w*.87,base,'#b5e2ec29');
    const marker=w*.13+(w*.74)*(t.seconds/60);line(c,marker,base-3,marker,base+3,accent,2);
    for(let i=0;i<7;i++)text(c,pad(i*10),w*.13+w*.74*i/6,base+19,11,'#b3ccd57a',400,'Consolas,monospace');
  }
  function circuit(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,cy=h*.47,size=tier(w,137,115,87,64,55);text(c,t.string,w/2,cy,size,'#edfff7',600);
    const top=cy-size*.69-20,bottom=cy+size*.72+25,left=Math.max(40,w*.09),right=w-left;
    for(const direction of [-1,1])for(let i=0;i<4;i++){const xx=direction<0?left:right;const outer=xx+direction*(14+i*6);const yy=top+i*10;path(c,[[w/2+direction*20,yy],[xx-direction*(25+i*10),yy],[outer,yy+25],[outer,bottom-i*10],[xx-direction*25,bottom-i*10]],rgba(a,.18+i*.07));}
    const px=left+(right-left)*((t.seconds+motion(m,t))/60);c.shadowColor=a;c.shadowBlur=m.options.glow/4;c.fillStyle=a;c.fillRect(px-3,bottom-2,6,4);c.shadowBlur=0;
    const group=(right-left)/3;[t.hh,t.mm,t.ss].forEach((_,i)=>{const cx=left+group*(i+.5);for(let j=0;j<8;j++){const active=j<Math.ceil([t.hours/24,t.minutes/60,t.seconds/60][i]*8);c.fillStyle=active?a:'#c4eadd20';c.fillRect(cx-group*.26+j*group*.07,bottom+18,group*.045,4);}});
  }
  function glitch(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,size=tier(w,153,125,92,68,58),cy=h*.47;
    c.save();c.translate(w/2,cy);c.transform(1,0,-.12,1,0,0);
    text(c,t.string,-3,0,size,'#91fff2',800);text(c,t.string,3,2,size,a,800);
    text(c,t.string,0,0,size,'#f9fbf4',800);
    const font=c.font,tw=c.measureText(t.string).width;
    for(let i=0;i<3;i++){c.save();c.beginPath();const yy=-size*.31+i*size*.27;c.rect(-tw/2-15,yy,tw+30,3+i);c.clip();const kick=m.options.motion&&!reduced.matches&&t.sub<.14?9:3;c.font=font;c.fillStyle=i%2?a:'#80fff0';c.fillText(t.string,i%2?kick:-kick,0);c.restore();}
    c.restore();
    const base=cy+size*.72+19;line(c,w*.12,base,w*.88,base,'#ffffff36');const width=w*.76;
    for(let i=0;i<70;i++){const seed=(i*17+11)%9;const x=w*.12+width*i/70;c.fillStyle=i<Math.ceil(t.seconds/60*70)?a:'#e6e9ec3b';c.fillRect(x,base+10,seed%3===0?3:1,8+seed);}
  }
  function acid(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,size=tier(w,141,117,86,63,54),cy=h*.47;
    c.save();c.translate(w/2,cy);c.rotate(-.055);c.font=`800 ${size}px Consolas,"Courier New",monospace`;const tw=c.measureText(t.string).width;
    c.fillStyle=a;c.beginPath();c.moveTo(-tw/2-8,-size*.52);c.lineTo(tw/2+12,-size*.48);c.lineTo(tw/2+8,size*.5);c.lineTo(-tw/2-13,size*.55);c.closePath();c.fill();
    text(c,t.string,0,1,size,'#0c140a',800,'Consolas,"Courier New",monospace');
    c.strokeStyle='#ff7ea9';c.lineWidth=3;c.beginPath();c.moveTo(-tw*.43,size*.8);c.bezierCurveTo(-tw*.13,size*.55,tw*.11,size*.99,tw*.42,size*.65);c.stroke();
    const n=t.seconds/60;line(c,-tw*.44,size*.88,-tw*.44+tw*.88*n,size*.88,'#f4f9e9',2);
    c.restore();
    const x=w*.91,y=h*.2;path(c,[[x-9,y-9],[x+6,y+6],[x+9,y-9],[x-6,y+6]],'#ff7ea9',2);
  }
  function light(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,size=tier(w,136,113,84,62,53),cy=h*.47;
    const left=w*.09,right=w*.91,top=cy-size*.9,bottom=cy+size*.9;
    const sub=motion(m,t);
    for(let i=0;i<10;i++){const y=top+(bottom-top)*i/9;const len=(.12+((i*17)%9)/30)*w;const x=left+((t.seconds*.037+sub*.037+i*.21)%1)*(right-left-len);const grad=c.createLinearGradient(x,0,x+len,0);grad.addColorStop(0,'#0000');grad.addColorStop(.85,rgba(a,i%3===0?.5:.16));grad.addColorStop(1,'#edfeffcc');line(c,x,y,x+len,y,grad,i%3===0?1.5:.6);}
    c.shadowColor='#070b0d';c.shadowBlur=18;text(c,t.string,w/2,cy,size,'#f3fdff',500,'"Segoe UI",sans-serif');c.shadowBlur=0;
    const base=bottom+29;line(c,left,base,right,base,'#c6e9e62b');
    for(let i=0;i<=12;i++){const x=left+(right-left)*i/12;line(c,x,base-3,x,base+(i%3===0?7:3),'#c6e9e65b');}
    line(c,left+(right-left)*t.seconds/60,base-6,left+(right-left)*t.seconds/60,base+9,a,2);
  }
  function orbits(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,group=tier(w,234,190,138,103,88),r=tier(w,94,79,56,41,35),cy=h*.48;
    const xs=[w/2-group,w/2,w/2+group],values=[t.hh,t.mm,t.ss],colors=['#eef9f3','#9de6dd',a],ratios=[t.hours/24,t.minutes/60,(t.seconds+motion(m,t))/60];
    xs.forEach((x,index)=>{const col=colors[index];arc(c,x,cy,r,0,Math.PI*2,'#c6e1d72d');arc(c,x,cy,r-5,-Math.PI/2,-Math.PI/2+Math.PI*2*ratios[index],col,2);
      for(let i=0;i<60;i++){const angle=i*Math.PI/30;const inner=r+5,outer=r+(i%5===0?10:7);line(c,x+Math.sin(angle)*inner,cy-Math.cos(angle)*inner,x+Math.sin(angle)*outer,cy-Math.cos(angle)*outer,'#cfebe339');}
      text(c,values[index],x,cy-3,tier(w,75,64,49,39,34),col,500);
      text(c,['时','分','秒'][index],x,cy+r+30,12,'#b4c8c0');
    });
  }
  function spectrum(m,t){
    const {ctx:c,w,h}=m,a=m.options.accent,size=tier(w,154,127,94,69,59),cy=h*.47;
    const {mask,c:mc}=maskFor(m,size,'Bahnschrift,"Segoe UI",sans-serif',600,cy,t.string);
    const layer=m.texture||(m.texture=document.createElement('canvas'));layer.width=w;layer.height=h;const lc=layer.getContext('2d');
    const sweep=cy-size*.5+size*(t.seconds+motion(m,t))/60;
    for(let y=0;y<h;y+=3){const dist=Math.abs(y-sweep);lc.fillStyle=dist<6?'#f6fffa':dist<21?a:'#b9e0dce0';lc.fillRect(0,y,w,1.5);}
    mc.globalCompositeOperation='source-in';mc.drawImage(layer,0,0);
    mc.globalCompositeOperation='source-over';c.shadowColor=a;c.shadowBlur=m.options.glow/12;c.drawImage(mask,0,0);c.shadowBlur=0;
    c.font=`600 ${size}px Bahnschrift,"Segoe UI",sans-serif`;const tw=c.measureText(t.string).width,left=w/2-tw/2,right=w/2+tw/2;
    line(c,left-10,cy-size*.6,left-10,cy+size*.6,'#c4e6dd33');line(c,right+10,cy-size*.6,right+10,cy+size*.6,'#c4e6dd33');
    line(c,left-15,sweep,left-5,sweep,a,2);line(c,right+5,sweep,right+15,sweep,a,2);
    const base=cy+size*.75+18;for(let i=0;i<48;i++){const x=left+tw*i/47,phase=(i*13+t.seconds)%19;line(c,x,base,x,base+4+phase*.4,i/48<t.seconds/60?a:'#d0ebe04d',2);}
  }

  const painters={giant,bridge,dust,circuit,glitch,acid,light,orbits,spectrum};
  const instances=[];
  function attach(app,id){
    const item=catalog.find(item=>item.id===id);if(!item?.accent)return null;
    app.classList.add('designed');app.style.setProperty('--accent',item.accent);
    const artwork=document.createElement('div');artwork.className='artwork';
    const canvas=document.createElement('canvas');canvas.className='style-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',item.name);
    artwork.append(canvas);app.querySelector('.display').prepend(artwork);artwork.append(app.querySelector('.readout'));
    const m={id,name:item.name,el:app,section:app.parentElement,canvas,ctx:canvas.getContext('2d'),w:0,h:0,mode:'clock',options:{accent:item.accent,motion:true,glow:40}};
    instances.push(m);
    canvas.addEventListener('pointermove',event=>{const b=canvas.getBoundingClientRect();m.pointer={x:(event.clientX-b.left)/m.scale,y:(event.clientY-b.top)/m.scale};});
    canvas.addEventListener('pointerleave',()=>{m.pointer=null;});
    return {update(state){m.state=state;m.mode=state.clock?'clock':state.mode;app.classList.toggle('clock-mode',state.clock);}};
  }
  function draw(m){
    if(m.section.hidden||!m.state)return;
    const box=m.canvas.getBoundingClientRect();if(box.width<1||box.height<1)return;
    const scale=Math.min(box.width/800,box.height/310),density=Math.min(devicePixelRatio||1,2,Math.sqrt(8000000/(box.width*box.height)));
    const cw=Math.max(1,Math.round(box.width*density)),ch=Math.max(1,Math.round(box.height*density));
    if(m.canvas.width!==cw||m.canvas.height!==ch||m.scale!==scale){m.canvas.width=cw;m.canvas.height=ch;m.scale=scale;m.w=box.width/scale;m.h=box.height/scale;m.lastParticleText='';}
    m.ctx.setTransform(density*scale,0,0,density*scale,0,0);m.ctx.clearRect(0,0,m.w,m.h);
    const state=m.state,now=state.clock?new Date():state.now,ms=state.clock?(now.getHours()*3600+now.getMinutes()*60+now.getSeconds())*1000+now.getMilliseconds():state.value;
    const n=Math.floor(Math.max(0,ms)/1000),hours=Math.floor(n/3600),minutes=Math.floor(n/60)%60,seconds=n%60;
    const t={hours,minutes,seconds,hh:pad(hours),mm:pad(minutes),ss:pad(seconds),sub:ms%1000/1000};t.string=`${t.hh}:${t.mm}:${t.ss}`;
    if(m.canvas.dataset.time!==t.string){m.canvas.dataset.time=t.string;m.canvas.setAttribute('aria-label',`${m.name} ${t.string}`);}
    painters[m.id](m,t);
  }
  let previous=0;
  function frame(now){if(!root.isConnected)return;if(now-previous>=33){instances.forEach(draw);previous=now;}requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
  window.dayanStyles={catalog,attach};
})();
