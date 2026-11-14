const HOURS = Object.freeze([9, 14, 17]);

function latestSlot(now) {
  const date = new Date(now);
  for (const hour of [...HOURS].reverse()) {
    const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
    if (at <= date) return slot(at, hour);
  }
  return slot(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 17), 17);
}

function slot(at, hour) {
  return { at: at.getTime(), key: `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}/${hour}` };
}

function createUpdateSchedule({ onCheck, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = false, timer, previous;
  const seen = new Set();
  const tick = () => {
    if (!active) return;
    clearTimer(timer);
    const current = now(), due = latestSlot(current);
    // Coalesce missed slots after sleep into one request; never prompt in a burst.
    const check = due.at > previous && !seen.has(due.key);
    previous = current;
    if (check) {
      seen.add(due.key);
      if (seen.size > 24) seen.delete(seen.values().next().value);
    }
    const date = new Date(current);
    const next = HOURS.map(hour => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime()).find(at => at > current)
      || new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, HOURS[0]).getTime();
    timer = setTimer(tick, Math.max(1, Math.min(60000, next - current)));
    timer?.unref?.();
    if (check) onCheck(due);
  };
  return {
    start() { if (!active) { active = true; previous = now(); tick(); } },
    tick,
    stop() { active = false; clearTimer(timer); }
  };
}

module.exports = { createUpdateSchedule, HOURS };
