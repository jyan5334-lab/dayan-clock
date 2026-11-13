(() => {
  const NS = 'http://www.w3.org/2000/svg';
  window.createSceneExtension = (doc, original, seaside) => {
    const element = (tag, attributes, parent) => {
      const node = doc.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      parent?.append(node);
      return node;
    };
    const host = doc.createElement('div');
    host.dataset.sceneExtension = 'true';
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    original.before(host);
    const backdrop = element('svg', { width: '100%', height: '100%', 'aria-hidden': 'true' }, host);
    const defs = element('defs', {}, backdrop);
    const gradient = (id, y, height) => {
      const copy = original.querySelector(`#${id}`).cloneNode(true);
      copy.id = `extension-${id}`;
      for (const [key, value] of Object.entries({ gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: y, y2: y + height })) copy.setAttribute(key, value);
      defs.append(copy);
      return `url(#${copy.id})`;
    };
    const sky = element('rect', { fill: gradient('sky', 0, 500), 'data-extension-sky': '' }, backdrop);
    const sizing = [], repeaters = [], mirrors = [];
    const band = (y, height, fill) => {
      const node = element('rect', { y, height, fill }, backdrop);
      sizing.push(bounds => {
        node.setAttribute('x', bounds.x); node.setAttribute('width', bounds.width);
        node.setAttribute('height', y + height === 500 ? Math.max(height, bounds.bottom - y) : height);
      });
      return node;
    };
    const repeat = (id, period, clipped = false) => {
      const group = element('g', { 'data-extension-feature': id }, backdrop);
      const clipId = `extension-clip-${id}`;
      const clip = clipped ? element('rect', { x: 0, width: period }, element('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' }, defs)) : null;
      repeaters.push(bounds => {
        group.replaceChildren();
        if (clip) { clip.setAttribute('y', bounds.y); clip.setAttribute('height', bounds.height); }
        for (let index = Math.floor(bounds.x / period) - 1; index <= Math.ceil(bounds.right / period) + 1; index++) {
          const parent = clipped ? element('g', { transform: `translate(${index * period} 0)`, 'clip-path': `url(#${clipId})` }, group) : group;
          element('use', { href: `#${id}`, ...(clipped ? {} : { x: index * period }) }, parent);
        }
      });
    };
    // Extend dashed lines in their original coordinate system to preserve motion and phase.
    const lines = source => {
      const group = element('g', {}, backdrop);
      for (const attribute of source.attributes) if (attribute.name !== 'id') group.setAttribute(attribute.name, attribute.value);
      for (const line of source.tagName === 'line' ? [source] : source.querySelectorAll('line')) {
        const copy = line.cloneNode(true); copy.removeAttribute('id'); group.append(copy);
        mirrors.push({ source: line, copy });
        sizing.push(bounds => {
          const pattern = (line.getAttribute('stroke-dasharray') || '').split(/[ ,]+/).map(Number);
          const period = pattern.reduce((sum, value) => sum + value, 0) || 1;
          copy.setAttribute('x1', Math.floor(bounds.x / period) * period); copy.setAttribute('x2', bounds.right);
        });
      }
    };
    if (seaside) {
      repeat('stars', 800);
      repeat('island', 800, true);
      band(300, 130, gradient('sea', 300, 130));
      element('use', { href: '#glow' }, backdrop);
      lines(original.querySelector('#waves'));
      repeat('gulls', 900);
      repeat('palms', 1120);
      repeat('rail', 600, true);
      band(430, 70, '#8a5a44'); band(430, 5, '#a8735a');
      for (const y of [455, 478]) {
        const line = element('line', { y1: y, y2: y, stroke: '#6e4535', 'stroke-width': 2 }, backdrop);
        sizing.push(bounds => { line.setAttribute('x1', bounds.x); line.setAttribute('x2', bounds.right); });
      }
      repeat('planks', 800, true);
    } else {
      repeat('clouds', 1000);
      repeat('hills', 800, true); repeat('hills2', 800, true);
      band(450, 50, '#9c8063'); lines(original.querySelector('#road'));
    }
    // SVG use instances follow the original animated nodes; only extended lines need mirroring.
    if (mirrors.length) {
      const copies = new Map(mirrors.map(item => [item.source, item.copy]));
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.attributeName === 'x1' || record.attributeName === 'x2') continue;
          copies.get(record.target).setAttribute(record.attributeName, record.target.getAttribute(record.attributeName));
        }
      });
      for (const { source } of mirrors) observer.observe(source, { attributes: true });
    }
    return bounds => {
      backdrop.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
      for (const [key, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })) sky.setAttribute(key, value);
      for (const fit of [...sizing, ...repeaters]) fit(bounds);
    };
  };
})();
