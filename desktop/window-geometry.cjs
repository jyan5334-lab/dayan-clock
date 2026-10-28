const BASE_WIDTH = 800;
const BASE_HEIGHT = 568;
const MIN_WIDTH = 480;
const RATIO = BASE_WIDTH / BASE_HEIGHT;
const corners = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

function constrainWidth(width, maxWidth) {
  return Math.round(Math.max(Math.min(MIN_WIDTH, maxWidth), Math.min(width, maxWidth)));
}

function fitBounds(bounds, area) {
  const width = constrainWidth(Number(bounds?.width) || BASE_WIDTH, Math.min(1600, area.width, area.height * RATIO));
  const height = Math.round(width / RATIO);
  const x = Number.isFinite(bounds?.x) ? bounds.x : area.x + (area.width - width) / 2;
  const y = Number.isFinite(bounds?.y) ? bounds.y : area.y + (area.height - height) / 2;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    width, height
  };
}

function resizeFromCorner(start, corner, dx, dy, area) {
  if (!corners.has(corner) || !Number.isFinite(dx) || !Number.isFinite(dy)) return start;
  const left = corner.endsWith('left'), top = corner.startsWith('top');
  const anchorX = left ? start.x + start.width : start.x;
  const anchorY = top ? start.y + start.height : start.y;
  const changeX = (left ? -dx : dx) / BASE_WIDTH;
  const changeY = (top ? -dy : dy) / BASE_HEIGHT;
  const change = Math.abs(changeX) > Math.abs(changeY) ? changeX : changeY;
  const availableX = left ? anchorX - area.x : area.x + area.width - anchorX;
  const availableY = top ? anchorY - area.y : area.y + area.height - anchorY;
  const width = constrainWidth(start.width + change * BASE_WIDTH, Math.min(1600, availableX, availableY * RATIO));
  const height = Math.round(width / RATIO);
  return { x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height };
}

module.exports = { BASE_WIDTH, BASE_HEIGHT, MIN_WIDTH, RATIO, corners, fitBounds, resizeFromCorner };
