(() => {
  const root=document.getElementById('simple-timers');
  const variants=['stage','broadcast','flip','orbit','terminal'];
  const backgrounds=window.timerBackgrounds;
  const segmentMap=['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg'];
  const matrixMap=['01110100011001110101110011000101110','00100011000010000100001000010001110','01110100010000100010001000100011111','11110000010000101110000010000111110','00010001100101010010111110001000010','11111100001000011110000010000111110','01110100001000011110100011000101110','11111000010001000100010000100001000','01110100011000101110100011000101110','01110100011000101111000010000101110'];
  function electronicDigits(text,kind){
    const glyphs=Array.from(text).map(char=>{
      if(char===':')return kind==='stage'?'<span class="led-colon"></span>':`<span class="matrix-colon">${Array.from({length:7},(_,j)=>`<i class="pixel ${j===2||j===4?'on':''}"></i>`).join('')}</span>`;
      if(kind==='stage')return `<span class="led-digit">${Array.from('abcdefg').map(segment=>`<i class="seg ${segment} ${segmentMap[Number(char)].includes(segment)?'lit':''}"></i>`).join('')}</span>`;
      return `<span class="matrix-digit">${Array.from(matrixMap[Number(char)]).map(on=>`<i class="pixel ${on==='1'?'on':''}"></i>`).join('')}</span>`;
    }).join('');
    return `<span class="literal">${text}</span><span class="glyphs" aria-hidden="true">${glyphs}</span>`;
  }
  const models=[];let sharedState;
  let lastSave='';
  const pad=n=>String(n).padStart(2,'0');
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const refresh=()=>{if(globalThis.lucide)globalThis.lucide.createIcons({attrs:{width:16,height:16}});};
  const current=s=>s.elapsed+(s.running?performance.now()-s.anchor:0);
  function format(ms) {
    const n=Math.max(0,Math.floor(ms/1000));
    return (n>=3600?pad(Math.floor(n/3600))+':':'')+pad(Math.floor(n/60)%60)+':'+pad(n%60);
  }
  function save() {
    const simpleTimers=models.map(({s})=>({mode:s.mode,clock:s.clock,background:s.background,target:s.target,elapsed:Math.min(current(s),s.mode==='down'?s.target:Infinity)}));
    const state={version:2,simpleTimers};lastSave=JSON.stringify(state);
    window.openai?.setWidgetState?.({modelContent:{样式:['霓虹矩阵','液态铬金','机械黑曜','量子光环','赛博终端'],功能:'正计时、倒计时、秒表、年月日时钟',背景:backgrounds.map(b=>b.label)},privateContent:state})?.catch(()=>{});
  }
  Array.from(root.children).forEach((section,i)=>{
    const s=sharedState||(sharedState={mode:'up',clock:true,background:backgrounds[1]?.id||'original',target:300000,elapsed:0,running:false,anchor:0});
    const ring=variants[i]==='orbit'?'<svg class="ring" viewBox="0 0 240 240" aria-label="时间进度" role="img"><circle class="ticks" cx="120" cy="120" r="117"/><circle class="track" cx="120" cy="120" r="110"/><circle class="inner-track" cx="120" cy="120" r="98"/><circle class="arc" cx="120" cy="120" r="110"/></svg><span class="marker" aria-hidden="true"></span>':'';
    section.innerHTML=`<div class="timer ${variants[i]}" aria-label="${section.dataset.variant}"><header><div class="brand">${icon('timer')}<span>计时器</span></div><div class="modes" role="group" aria-label="显示模式"><button class="cursor-interaction" type="button" data-mode="up">正计时</button><button class="cursor-interaction" type="button" data-mode="down">倒计时</button><button class="cursor-interaction" type="button" data-mode="watch">秒表</button><button class="cursor-interaction" type="button" data-mode="clock">时钟</button></div></header><div class="display">${ring}<div class="readout" role="timer" aria-label="时间"><span class="digits">00:00</span><span class="fraction" hidden>.00</span></div><time class="date" hidden></time><span class="status" aria-live="polite">准备就绪</span></div><div class="settings"><label hidden><input type="number" class="minutes" min="0" max="5999" step="1" value="5" aria-label="分钟"> 分</label><label hidden><input type="number" class="seconds" min="0" max="59" step="1" value="0" aria-label="秒"> 秒</label></div><div class="actions"><button type="button" class="action primary cursor-interaction" data-action="toggle">${icon('play')}<span>开始</span></button><button type="button" class="action reset cursor-interaction" data-action="reset" aria-label="重置" data-tooltip="重置">${icon('rotate-ccw')}</button></div><div class="error" role="alert"></div><div class="background-tools"><button type="button" class="background-toggle cursor-interaction" data-background-toggle aria-label="选择背景" data-tooltip="选择背景" aria-expanded="false" aria-controls="background-picker-${i}">${icon('image')}</button></div><div class="background-picker" id="background-picker-${i}" role="dialog" aria-label="背景选择" hidden><div class="picker-heading"><span>背景</span><button type="button" class="picker-close cursor-interaction" data-background-close aria-label="关闭背景选择">${icon('x')}</button></div><div class="background-grid">${backgrounds.map(b=>`<button type="button" class="background-choice cursor-interaction" data-background="${b.id}" aria-label="${b.label}" aria-pressed="false"><img src="${b.src}" alt="" loading="lazy"><span>${b.label}</span></button>`).join('')}</div><button type="button" class="original-background cursor-interaction" data-background="original" aria-pressed="false">${icon('rotate-ccw')}<span>原始背景</span></button></div></div>`;
    const app=section.querySelector('.timer'),q=sel=>app.querySelector(sel);
    app.insertAdjacentHTML('afterbegin','<div class="wallpaper-media" aria-hidden="true"></div>');
    q('.date').insertAdjacentHTML('afterend','<div class="almanac" hidden aria-label="今日黄历"><div class="almanac-main"><span class="almanac-lunar"></span><span class="almanac-day"></span></div><div class="almanac-note"></div><div class="almanac-row"><span class="almanac-label good">宜</span><span data-almanac-yi></span></div><div class="almanac-row"><span class="almanac-label avoid">忌</span><span data-almanac-ji></span></div></div>');
    q('.brand span').textContent='DAYAN时钟';
    ['clock','watch','down','up'].forEach(mode=>q('.modes').append(q(`[data-mode="${mode}"]`)));
    let lastDisplay='',lastAction='',lastStatus='',lastBackground=null;
    function closeBackgrounds(){q('.background-picker').hidden=true;q('.background-toggle').setAttribute('aria-expanded','false');}
    function render() {
      const now=new Date();if(!s.running&&document.activeElement!==q('.minutes')&&document.activeElement!==q('.seconds')){q('.minutes').value=Math.floor(s.target/60000);q('.seconds').value=Math.floor(s.target/1000)%60;}
      if(lastBackground!==s.background){
        const background=backgrounds.find(b=>b.id===s.background);
        app.classList.toggle('has-background',Boolean(background));
        app.style.setProperty('--wallpaper',background&&background.kind!=='video'?`url("${background.src}")`:'none');
        const media=q('.wallpaper-media');
        media.replaceChildren();
        if(background?.kind==='video'){
          const video=document.createElement('video');video.src=background.src;video.autoplay=true;video.loop=true;video.muted=true;video.playsInline=true;media.append(video);app.classList.add('has-motion-background');
        }else app.classList.remove('has-motion-background');
        app.querySelectorAll('[data-background]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.background===s.background)));
        lastBackground=s.background;
      }
      let total=current(s);
      if(s.running&&s.mode==='down'&&total>=s.target) {s.elapsed=s.target;s.running=false;total=s.target;save();}
      const value=s.mode==='down'?Math.max(0,s.target-total):total;
      const text=s.clock?`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`:format(value);
      q('.readout').classList.toggle('hours',text.length>5);
      q('.readout').setAttribute('aria-label',s.clock?'电脑本地时间':'时间');
      if(lastDisplay!==text) {
        if(variants[i]==='stage'||variants[i]==='terminal') q('.digits').innerHTML=electronicDigits(text,variants[i]);
        else if(variants[i]==='flip') {
          let position=0;
          q('.digits').innerHTML=text.split(':').map(part=>{
            const unit=part.split('').map(n=>{const changed=lastDisplay!==''&&lastDisplay[position]!==n;position++;return `<span class="digit ${changed?'changed':''}"><span class="face">${n}</span></span>`;}).join('');position++;return `<span class="unit">${unit}</span>`;
          }).join('<span class="colon">:</span>');
        } else q('.digits').textContent=text;
        lastDisplay=text;
      }
      q('.fraction').hidden=s.clock||s.mode!=='watch';q('.fraction').textContent='.'+pad(Math.floor(value/10)%100);
      const ended=s.mode==='down'&&total>=s.target;
      app.classList.toggle('ended',ended&&!s.clock);
      q('.date').hidden=!s.clock;
      if(s.clock){
        const year=now.getFullYear(),month=pad(now.getMonth()+1),day=pad(now.getDate());
        q('.date').textContent=`${year}年 ${month}月 ${day}日`;
        q('.date').setAttribute('datetime',`${year}-${month}-${day}`);
        const almanac=window.dayanAlmanac?.(now);
        q('.almanac').hidden=!almanac;
        if(almanac){
          q('.almanac-lunar').textContent=almanac.lunar;
          q('.almanac-day').textContent=almanac.day;
          q('.almanac-note').textContent=almanac.festival;
          q('[data-almanac-yi]').textContent=almanac.yi.join(' · ');
          q('[data-almanac-ji]').textContent=almanac.ji.join(' · ');
        }
      }
      q('.almanac').hidden=!s.clock;
      const status=s.clock?'':ended?'时间到':s.running?'计时中':total>0?'已暂停':'准备就绪';
      q('.status').hidden=s.clock;
      if(lastStatus!==status){q('.status').textContent=status;lastStatus=status;}
      const actionKey=`${s.running}:${total>0}`;
      if(lastAction!==actionKey){q('[data-action="toggle"]').innerHTML=icon(s.running?'pause':'play')+`<span>${s.running?'暂停':total>0?'继续':'开始'}</span>`;lastAction=actionKey;refresh();}
      q('[data-action="toggle"]').disabled=ended;
      app.classList.toggle('running',s.running&&!s.clock);
      app.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===(s.clock?'clock':s.mode))));
      app.querySelectorAll('.settings label').forEach(label=>label.hidden=s.clock||s.mode!=='down');
      app.querySelectorAll('[data-action]').forEach(button=>button.hidden=s.clock);
      app.querySelectorAll('input').forEach(input=>input.disabled=s.running);
      if(q('.arc')){
        const progress=s.clock?(now.getSeconds()+now.getMilliseconds()/1000)/60:s.mode==='down'?Math.max(0,1-total/s.target):(total%60000)/60000;
        q('.arc').style.strokeDashoffset=String(691.15*(1-progress));
        q('.marker').style.setProperty('--angle',`${progress*360}deg`);
      }
    }
    function restore(item){
      if(!item||!['up','down','watch'].includes(item.mode)||!Number.isFinite(item.elapsed)||item.elapsed<0||!Number.isFinite(item.target)||item.target<1000||item.target>359999000)return;
      Object.assign(s,item,{clock:item.clock===true,background:backgrounds.some(b=>b.id===item.background)||item.background==='original'?item.background:s.background,running:false,anchor:0});q('.minutes').value=Math.floor(s.target/60000);q('.seconds').value=Math.floor(s.target/1000)%60;render();
    }
    function reset(){s.elapsed=0;s.running=false;s.anchor=0;q('.error').textContent='';}
    app.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||b.disabled)return;
      if(b.hasAttribute('data-background-toggle')){
        const picker=q('.background-picker'),opening=picker.hidden;
        picker.hidden=!opening;q('.background-toggle').setAttribute('aria-expanded',String(opening));
        if(opening)q('[data-background]')?.focus();return;
      }
      if(b.hasAttribute('data-background-close')){closeBackgrounds();q('.background-toggle').focus();return;}
      if(b.dataset.background){s.background=b.dataset.background;closeBackgrounds();render();save();return;}
      if(b.dataset.mode==='clock'){s.clock=true;q('.error').textContent='';}
      else if(b.dataset.mode){if(b.dataset.mode!==s.mode){reset();s.mode=b.dataset.mode;}s.clock=false;}
      if(b.dataset.action==='reset')reset();
      if(b.dataset.action==='toggle'){
        if(s.running){s.elapsed=current(s);s.running=false;}
        else{s.anchor=performance.now();s.running=true;}
      }
      render();save();
    });
    app.addEventListener('keydown',event=>{if(event.key==='Escape'&&!q('.background-picker').hidden){closeBackgrounds();q('.background-toggle').focus();}});
    app.addEventListener('click',event=>{if(!event.target.closest('.background-picker,.background-tools'))closeBackgrounds();});
    app.querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{
      const minutes=Number(q('.minutes').value),seconds=Number(q('.seconds').value);
      if(!Number.isInteger(minutes)||!Number.isInteger(seconds)||minutes<0||minutes>5999||seconds<0||seconds>59||(minutes===0&&seconds===0)){
        q('.minutes').value=Math.floor(s.target/60000);q('.seconds').value=Math.floor(s.target/1000)%60;q('.error').textContent='请输入大于 0 的时间';return;
      }
      s.target=(minutes*60+seconds)*1000;reset();render();save();
    }));
    models.push({s,render,restore});
    const state=window.openai?.widgetState?.privateContent;
    if(state?.version===2)restore(state.simpleTimers?.[0]);
    s.clock=true;render();
    if(globalThis.Tweak){
      const appearance={accent:['#75fff0','#e53546','#efd29b','#79f1e4','#c3ff85'][i]};
      new globalThis.Tweak({container:app,onChange:()=>app.style.setProperty('--accent',appearance.accent)}).addColorPicker(appearance,'accent',{label:'强调色',reference:'--accent'});
    }
  });
  root.addEventListener('dayan:refresh',()=>models.forEach(model=>model.render()));
  root.addEventListener('dayan:checkpoint',save);
  refresh();
  const ticker=setInterval(()=>{if(!root.isConnected){clearInterval(ticker);return;}if(sharedState.running||sharedState.clock)models.forEach(m=>m.render());},40);
  window.addEventListener('openai:set_globals',event=>{
    const state=event.detail?.globals?.widgetState?.privateContent;
    if(state?.version!==2||JSON.stringify(state)===lastSave)return;
    models.forEach((m,i)=>m.restore(state.simpleTimers?.[i]));
  });
})();
