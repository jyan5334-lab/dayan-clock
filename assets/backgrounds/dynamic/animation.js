(() => {
  const scenes = {
    'pelican-bike': { file: 'pelican_bike.html', title: '鹈鹕骑自行车' },
    'pelican-seaside': { file: 'pelican_bike_seaside.html', title: '鹈鹕的海边日落骑行' }
  };
  const scene = scenes[new URLSearchParams(location.search).get('scene')] || scenes['pelican-bike'];
  const frame = document.querySelector('iframe');
  let sourceSize;
  const fitScene = () => {
    if (!sourceSize) return;
    const scale = Math.max(document.documentElement.clientWidth / sourceSize.width, document.documentElement.clientHeight / sourceSize.height);
    frame.style.width = `${sourceSize.width * scale}px`;
    frame.style.height = `${sourceSize.height * scale}px`;
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
      body > svg { display:block;width:100%!important;height:100%!important;max-width:none!important;border-radius:0!important;box-shadow:none!important; }
    `;
    doc.head.append(style);
    // Cover the host viewport outside the original document so its animation stays untouched.
    const viewBox = svg.viewBox.baseVal;
    sourceSize = { width: viewBox.width, height: viewBox.height };
    fitScene();
    document.documentElement.dataset.ready = 'true';
  });
  frame.src = `originals/${scene.file}`;
})();
