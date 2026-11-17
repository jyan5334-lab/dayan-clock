const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/backgrounds/dynamic/originals/fox_quest.html');
const outputPath = path.join(root, 'assets/backgrounds/dynamic/derived/fox_quest_wallpaper.html');
const source = fs.readFileSync(sourcePath, 'utf8');

const wallpaperStyle = `
html, body { width:100%; height:100%; margin:0!important; overflow:hidden!important; background:#0d0b1e; }
#wrap { width:100%; height:100%; display:block; position:relative; }
#bar { display:none!important; }
#cv { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; max-width:none!important; border:0!important; border-radius:0!important; box-shadow:none!important; object-fit:fill!important; background:linear-gradient(180deg,#0d0b1e 0%,#282047 54%,#342747 100%); image-rendering:pixelated; }
`;

const textSuppressor = `
<script>
(() => {
  const context = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
  if (context) {
    context.fillText = () => {};
    context.strokeText = () => {};
  }
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
})();
</script>
`;

const responsiveFit = `let SC = 1, sceneX = 0, sceneY = 0, viewLeft = 0, viewRight = W, paintX = 0, paintY = 0;
function fit() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(innerWidth * dpr));
  cv.height = Math.max(1, Math.round(innerHeight * dpr));
  SC = Math.min(cv.width / W, cv.height / H);
  sceneX = (cv.width - W * SC) / 2;
  sceneY = cv.height - H * SC;
  viewLeft = -sceneX / SC;
  viewRight = (cv.width - sceneX) / SC;
  cv.dataset.scene = JSON.stringify({ x: sceneX / dpr, y: sceneY / dpr, width: W * SC / dpr, height: H * SC / dpr });
}
window.addEventListener('resize', () => { fit(); draw(); }); fit();`;

const extendedGround = `
  // Continue the original terrain palette and pixel texture outside the game
  // viewport. The game, camera, actors and physics retain their original bounds.
  for (let x = Math.floor(viewLeft / T) * T; x < viewRight; x += T) {
    if (x >= 0 && x < W) continue;
    for (let r = GY; r < ROWS; r++) {
      const n = hash(Math.floor(x / T) + Math.floor(cam / T), r), y = r * T;
      R(x, y, T, T, '#3a2647');
      R(x + n % 12, y + 5 + (n >> 4) % 8, 2, 2, '#2e1d3a');
      R(x + (n >> 8) % 13, y + 4 + (n >> 12) % 9, 2, 1, '#4d3460');
      if (r === GY) { R(x, y, T, 4, '#2fbf8f'); R(x, y, T, 1, '#7ef0c0'); R(x, y + 4, T, 1, '#1c8a6a'); }
    }
  }
`;

const withStyle = source
  .replace('</style>', `${wallpaperStyle}</style>`)
  .replace(/let SC = 1;[\s\S]*?window.addEventListener\('resize', fit\); fit\(\);/, responsiveFit)
  .replace('ctx.setTransform(SC, 0, 0, SC, 0, 0);', 'ctx.setTransform(SC, 0, 0, SC, sceneX, sceneY); paintX = sceneX; paintY = sceneY;')
  .replace('ctx.translate(-cam + shx, shy);', 'ctx.translate(-cam + shx, shy); paintX = sceneX + (-cam + shx) * SC; paintY = sceneY + shy * SC;')
  .replace("const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };", `const R = (x, y, w, h, c) => {
  ctx.fillStyle = c;
  // Share device-pixel boundaries between adjoining pixel-art tiles.
  const left = Math.round(x * SC + paintX), top = Math.round(y * SC + paintY);
  ctx.fillRect((left - paintX) / SC, (top - paintY) / SC,
    (Math.round((x + w) * SC + paintX) - left) / SC,
    (Math.round((y + h) * SC + paintY) - top) / SC);
};`)
  .replace('function drawBG(cam) {', `function drawBG(cam) {
  R(viewLeft, -sceneY / SC, viewRight - viewLeft, sceneY / SC + H, SKY[0]);
  for (let y = -16; y > -sceneY / SC; y -= 24) for (let x = Math.floor(viewLeft / 35) * 35; x < viewRight; x += 35) {
    const n = hash(x, y); ctx.globalAlpha = .4 + .3 * Math.sin(S.t / 50 + n % 10);
    R(x + n % 25, y + n % 15, 1, 1, '#fff');
  }
  ctx.globalAlpha = 1;`)
  .replace('R(0, i * bh, W, bh + 1, SKY[i]);', 'R(viewLeft, i * bh, viewRight - viewLeft, bh + 1, SKY[i]);')
  .replace('R(0, SKY.length * bh, W, H, SKY[SKY.length - 1]);', 'R(viewLeft, SKY.length * bh, viewRight - viewLeft, H, SKY[SKY.length - 1]);')
  .replace('let x = 0; x < W; x += 4', 'let x = Math.floor(viewLeft / 4) * 4; x < viewRight; x += 4')
  .replace('let x = 0; x < W; x += 2', 'let x = Math.floor(viewLeft / 2) * 2; x < viewRight; x += 2')
  .replace('Math.floor(off / 46) - 1; k <= Math.floor((off + W) / 46)', 'Math.floor((off + viewLeft) / 46) - 1; k <= Math.floor((off + viewRight) / 46)')
  .replace('  drawBG(cam);', `  drawBG(cam);${extendedGround}`)
  .replace('function drawHUD() {', 'function drawHUD() {\n  return;');
const marker = '<script>\n(() => {';
if (!withStyle.includes(marker)) throw new Error('fox quest source script marker not found');
const output = withStyle.replace(marker, `${textSuppressor}${marker}`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(JSON.stringify({ source: sourcePath, output: outputPath, bytes: Buffer.byteLength(output) }));
