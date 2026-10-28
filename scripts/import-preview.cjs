const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2];
if (!source) throw new Error('Provide the existing DAYAN clock preview source path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(source, 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const data = JSON.parse(html.match(/<script type="application\/json" id="timer-background-data">([\s\S]*?)<\/script>/)?.[1]);
if (!css || !script || data.length !== 10) throw new Error('Incomplete timer source');
fs.writeFileSync(path.join(root, 'renderer/timer.css'), css.trim() + '\n');
const desktopScript = script
  .replace("JSON.parse(document.getElementById('timer-background-data').textContent)", 'window.timerBackgrounds')
  .replace('const models=[];', 'const models=[];let sharedState;')
  .replace("const s={mode:'up',clock:true,background:backgrounds[i%backgrounds.length]?.id||'original',target:300000,elapsed:0,running:false,anchor:0};", "const s=sharedState||(sharedState={mode:'up',clock:true,background:backgrounds[1]?.id||'original',target:300000,elapsed:0,running:false,anchor:0});")
  .replace("if(state?.version===2)restore(state.simpleTimers?.[i]);", "if(state?.version===2)restore(state.simpleTimers?.[0]);")
  .replace("const now=new Date();", "const now=new Date();if(!s.running&&document.activeElement!==q('.minutes')&&document.activeElement!==q('.seconds')){q('.minutes').value=Math.floor(s.target/60000);q('.seconds').value=Math.floor(s.target/1000)%60;}")
  .replace('models.forEach(m=>{if(m.s.running||m.s.clock)m.render();});', 'if(sharedState.running||sharedState.clock)models.forEach(m=>m.render());')
  .replace('  refresh();\n  const ticker=', "  root.addEventListener('dayan:refresh',()=>models.forEach(model=>model.render()));\n  root.addEventListener('dayan:checkpoint',save);\n  refresh();\n  const ticker=");
if (!desktopScript.includes('let sharedState;') || !desktopScript.includes("root.addEventListener('dayan:checkpoint'")) throw new Error('Desktop timer integration failed');
fs.writeFileSync(path.join(root, 'renderer/timer.js'), desktopScript.trim() + '\n');
fs.mkdirSync(path.join(root, 'assets/backgrounds'), { recursive: true });
for (const item of data) {
  const encoded = item.src.match(/^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/);
  if (!encoded || !/^[a-z-]+$/.test(item.id)) throw new Error('Unexpected background asset');
  fs.writeFileSync(path.join(root, 'assets/backgrounds', item.id + '.webp'), Buffer.from(encoded[1], 'base64'));
  item.src = 'assets/backgrounds/' + item.id + '.webp';
}
fs.writeFileSync(path.join(root, 'renderer/backgrounds.js'), 'window.timerBackgrounds = ' + JSON.stringify(data, null, 2) + '.map(item => ({ ...item, src: new URL(item.src, document.baseURI).href }));\n');
console.log('Imported timer, 5 styles and 10 local backgrounds.');
