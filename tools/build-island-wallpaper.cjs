'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'assets/backgrounds/dynamic');
const deps=process.env.DAYAN_ISLAND_BUILD_DEPS;
if(!deps)throw new Error('Set DAYAN_ISLAND_BUILD_DEPS to a build-only install with three@0.170.0 and esbuild@0.25.12. Runtime needs no npm/CDN.');
const buildRequire=createRequire(path.join(path.resolve(deps),'package.json'));
const esbuild=buildRequire('esbuild');
const threePackage=JSON.parse(fs.readFileSync(path.join(deps,'node_modules/three/package.json'),'utf8'));
if(threePackage.version!=='0.170.0')throw new Error('Original artwork requires Three.js r170');
const source=fs.readFileSync(path.join(dir,'originals/pelican_island_3d.html'),'utf8');
let code=source.match(/<script type="text\/x-app-module" id="app-src">([\s\S]*?)<\/script>/)[1];
function replace(pattern,value){if(!code.match(pattern))throw new Error('Source marker missing: '+pattern);code=code.replace(pattern,value);}
replace(/import \{ OrbitControls \}[^\n]+\n/,'');
replace(/window\.__appStarted = true;[\s\S]*?statusEl.textContent = [^;]+;/,'window.__appStarted = true;');
// Keep the original artwork's resolution and let the runtime degrade only
// after sustained frame pressure. The old area-based cap pushed ordinary
// desktop displays below 1x and made the scene visibly soft.
replace(/let pixelRatio = [^;]+;/,
  'const pixelRatioCap = () => { const pixels = innerWidth * innerHeight; const cap = pixels >= 10000000 ? 1.25 : pixels >= 6000000 ? 1.5 : 2; return Math.min(window.devicePixelRatio || 1, cap); };\nlet pixelRatio = pixelRatioCap();');
// Aerial views span a large island. High precision depth plus MSAA prevents
// distant foliage, windows and shoreline surfaces from changing depth winner.
replace(/const renderer = new THREE\.WebGLRenderer\(\{ antialias: false, powerPreference: 'high-performance' \}\);/,
  "const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });");
replace(/const composerRT = new THREE\.WebGLRenderTarget\(16, 16, \{ type: THREE\.HalfFloatType, samples: 4 \}\);/,
  'const composerRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 2 });');
replace(/const camera = new THREE\.PerspectiveCamera\(48, innerWidth \/ innerHeight, 0\.05, 4000\);/,
  'const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.35, 3200);');
replace(/const controls = new OrbitControls[\s\S]*?controls.zoomSpeed = 0.9;/,'');
replace(/left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 160/,
  'left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 220');
replace(/  if \(envRT\) envRT.dispose\(\);\s*envRT = pmrem.fromScene\(envScene, 0, 1, 2000\);\s*scene.environment = envRT.texture;/,
  '  const nextEnvironment = pmrem.fromScene(envScene, 0, 1, 2000);\n    const previousEnvironment = envRT; envRT = nextEnvironment;\n    scene.environment = envRT.texture;\n    if (previousEnvironment) previousEnvironment.dispose();');
// PMREM generation is synchronous; runtime requests it only at idle startup or context recovery.
replace(/if \(force \|\| \(Math\.abs\(e - envLastE\) > 1\.2 && now - envLastT > 350\)\) \{/,
  'if (force) {');
replace(/scene\.environment = envRT\.texture;\n    if \(previousEnvironment\) previousEnvironment\.dispose\(\);/,
  'scene.environment = envRT.texture;\n    environmentReady = true;\n    if (previousEnvironment) previousEnvironment.dispose();');
replace(/const audio = \{ ctx:[\s\S]*$/,
  fs.readFileSync(path.join(dir,'island-runtime.js'),'utf8'));
replace(/for \(const arr of cells\.values\(\)\) group\.add\(instanced\(geo, mat, arr, opts\)\);/,
  'for (const arr of cells.values()) { const mesh = instanced(geo, mat, arr, opts); if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius += cell * 0.65; group.add(mesh); }');
replace(/  renderer.setSize\(innerWidth, innerHeight\);\s*composer.setSize\(innerWidth, innerHeight\);/,
  '  pixelRatio = Math.min(pixelRatio, pixelRatioCap()); renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio);\n  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);');
fs.mkdirSync(path.join(dir,'derived'),{recursive:true});
esbuild.buildSync({stdin:{contents:code,resolveDir:deps,sourcefile:'pelican-island-adapted.js'},bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof',outfile:path.join(dir,'derived/island.bundle.js')});
fs.copyFileSync(path.join(deps,'node_modules/three/LICENSE'),path.join(dir,'derived/THREE-LICENSE.txt'));
const receipt={originalSha256:crypto.createHash('sha256').update(source).digest('hex'),three:'0.170.0',esbuild:'0.25.12',offline:true};
fs.writeFileSync(path.join(dir,'derived/island-build.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));

