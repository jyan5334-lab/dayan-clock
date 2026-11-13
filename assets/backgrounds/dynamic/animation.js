(() => {
  const scenes = {
    'pelican-bike': { file: 'pelican_bike.html', title: '鹈鹕骑自行车' },
    'pelican-seaside': { file: 'pelican_bike_seaside.html', title: '鹈鹕的海边日落骑行' }
  };
  const scene = scenes[new URLSearchParams(location.search).get('scene')] || scenes['pelican-bike'];
  const frame = document.querySelector('iframe');
  let sourceSize, sceneStyle, extendScene;
  const fitScene = () => {
    if (!sourceSize) return;
    const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / sourceSize.width, height / sourceSize.height);
    const worldWidth = width / scale, worldHeight = height / scale;
    Object.assign(sceneStyle, { width: `${sourceSize.width * scale}px`, height: `${sourceSize.height * scale}px`, left: `${(width - sourceSize.width * scale) / 2}px`, top: `${height - sourceSize.height * scale}px` });
    const x = (sourceSize.width - worldWidth) / 2, y = sourceSize.height - worldHeight;
    extendScene({ x, y, width: worldWidth, height: worldHeight, right: x + worldWidth, bottom: y + worldHeight });
  };
  new ResizeObserver(fitScene).observe(document.documentElement);
  frame.title = scene.title;
  document.title = scene.title;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    const svg = doc?.querySelector('body > svg');
    if (!svg) return;
    // Keep the source SVG and animation scripts intact; adapt only the demo page shell.
    const style = doc.createElement('style');
    style.textContent = `
      html,body { width:100%;height:100%;margin:0!important;overflow:hidden!important; }
      body { display:block!important; }
      body > h1,body > .sub,body > .ctrl { display:none!important; }
      [data-scene-extension] > svg { display:block;width:100%!important;height:100%!important;max-width:none!important;border-radius:0!important;box-shadow:none!important; }
      body > svg { position:absolute;display:block;max-width:none!important;border-radius:0!important;box-shadow:none!important; }
    `;
    doc.head.append(style);
    // Contain the entire original scene and extend scenery around it without cropping artwork.
    const viewBox = svg.viewBox.baseVal;
    sourceSize = { width: viewBox.width, height: viewBox.height };
    sceneStyle = style.sheet.cssRules[style.sheet.cssRules.length - 1].style;
    extendScene = window.createSceneExtension(doc, svg, scene.file.includes('seaside'));
    fitScene();
    document.documentElement.dataset.ready = 'true';
  });
  frame.src = `originals/${scene.file}`;
})();
