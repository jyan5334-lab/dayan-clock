(() => {
  const scenes = {
    'pelican-bike': { file: 'pelican_bike.html', title: '鹈鹕骑自行车' },
    'pelican-seaside': { file: 'pelican_bike_seaside.html', title: '鹈鹕的海边日落骑行' }
  };
  const scene = scenes[new URLSearchParams(location.search).get('scene')] || scenes['pelican-bike'];
  const frame = document.querySelector('iframe');
  frame.title = scene.title;
  document.title = scene.title;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc?.querySelector('body > svg')) return;
    // Keep the source SVG and animation scripts intact; adapt only the demo page shell.
    const style = doc.createElement('style');
    style.textContent = `
      html,body { width:100%;height:100%;margin:0!important;overflow:hidden!important; }
      body { display:block!important; }
      body > h1,body > .sub,body > .ctrl { display:none!important; }
      body > svg { display:block;width:100%!important;height:100%!important;max-width:none!important;border-radius:0!important;box-shadow:none!important; }
    `;
    doc.head.append(style);
    document.documentElement.dataset.ready = 'true';
  });
  frame.src = `originals/${scene.file}`;
})();
