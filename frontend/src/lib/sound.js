let ctx = null;

function tone(freq, start, duration, gain = 0.15) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function ensure() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Browsers only allow audio after the user has interacted with the page.
    if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return true;
  } catch {
    return false;
  }
}

/** Payment received: bright rising chime (FR-11). */
export function playSuccess() {
  if (!ensure()) return;
  tone(880, 0, 0.18);
  tone(1175, 0.15, 0.18);
  tone(1568, 0.3, 0.35);
}

export function playError() {
  if (!ensure()) return;
  tone(330, 0, 0.25, 0.12);
  tone(247, 0.22, 0.35, 0.12);
}

export function playBeep() {
  if (!ensure()) return;
  tone(1320, 0, 0.08, 0.08);
}
