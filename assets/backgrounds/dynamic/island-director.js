(function (host) {
  const shots = [{mode:'follow',seconds:240},{mode:'side',seconds:240},{mode:'orbit',seconds:300},{mode:'aerial',seconds:180}];
  const messages = {
    morning:['早上好呀，带着好心情开始今天吧。','新的一天，愿你做事顺心，心情明亮。'],
    noon:['午休一会儿，让下午更有精神。','喝口水，歇歇眼睛，下午继续从容出发。'],
    evening:['辛苦一天啦，留点时间和家人吃顿晚饭吧。','今天过得怎么样？下班后也照顾一下自己。'],
    night:['夜深了，早点休息，明天再精神满满地出发。','给今天画个句号吧，充足的睡眠也很重要。']
  };
  function localHour(date) { return date.getHours()+date.getMinutes()/60+date.getSeconds()/3600+date.getMilliseconds()/3600000; }
  function period(date) { const h=localHour(date); return h>=8&&h<10?'morning':h>=12&&h<14?'noon':h>=17&&h<19?'evening':h>=22||h<2?'night':null; }
  function shot(date) {
    let seconds=date.getHours()*3600+date.getMinutes()*60+date.getSeconds()+date.getMilliseconds()/1000; const cycle=shots.reduce((sum,s)=>sum+s.seconds,0); seconds%=cycle;
    for(const entry of shots){if(seconds<entry.seconds)return {mode:entry.mode,phase:seconds/entry.seconds};seconds-=entry.seconds;}
  }
  function greeting(date) { const slot=period(date); return slot ? messages[slot][Math.floor(date.getTime()/960000)%messages[slot].length] : ''; }
  host.DayanIslandDirector={localHour,period,shot,greeting,shots};
})(typeof window==='undefined'?globalThis:window);

