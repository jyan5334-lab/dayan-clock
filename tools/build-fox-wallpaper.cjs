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
#cv { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; max-width:none!important; border:0!important; border-radius:0!important; box-shadow:none!important; object-fit:contain!important; background:linear-gradient(180deg,#0d0b1e 0%,#282047 54%,#342747 100%); image-rendering:pixelated; }
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

const withStyle = source
  .replace('</style>', `${wallpaperStyle}</style>`)
  .replace('function drawHUD() {', 'function drawHUD() {\n  return;');
const marker = '<script>\n(() => {';
if (!withStyle.includes(marker)) throw new Error('fox quest source script marker not found');
const output = withStyle.replace(marker, `${textSuppressor}${marker}`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(JSON.stringify({ source: sourcePath, output: outputPath, bytes: Buffer.byteLength(output) }));
