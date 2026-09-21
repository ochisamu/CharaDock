// SPDX-License-Identifier: Apache-2.0
// Local display metadata only: never feeds conversation context or memory.
function selectNowPlaying(result) {
  if (!result?.ok || !Array.isArray(result.players)) return null;
  const players = result.players.filter(p => p && ['Playing', 'Paused'].includes(p.status));
  const playing = players.filter(p => p.status === 'Playing');
  const choices = playing.length ? playing : players;
  if (choices.length !== 1) return null;
  const p = choices[0];
  if (typeof p.title !== 'string' || !p.title.trim()) return null;
  const clean = s => Array.from(String(s || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
  return { title: clean(p.title), artist: clean(p.artist), status: p.status };
}

function createNowPlayingMonitor({ read, onChange, intervalMs = 5000, schedule = setTimeout, cancel = clearTimeout }) {
  let key = '', generation = 0, timer = null, current = null, running = false;
  function publish(value) {
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    current = value;
    onChange(value);
  }
  async function poll() {
    timer = null;
    if (!key || running) return;
    running = true;
    const epoch = generation;
    let value = null;
    try { value = selectNowPlaying(await read()); } catch { /* clear stale metadata */ }
    running = false;
    if (epoch === generation && key) publish(value);
    if (key) {
      timer = schedule(poll, epoch === generation ? intervalMs : 0);
      timer?.unref?.();
    }
  }
  return {
    setConnection(nextKey) {
      nextKey = String(nextKey || '');
      if (nextKey === key) return;
      key = nextKey;
      generation++;
      cancel(timer);
      timer = null;
      publish(null);
      if (key && !running) void poll();
    },
    snapshot: () => current ? { ...current } : null,
    stop() { this.setConnection(''); },
  };
}
module.exports = { selectNowPlaying, createNowPlayingMonitor };
