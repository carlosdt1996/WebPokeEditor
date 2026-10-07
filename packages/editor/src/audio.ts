/** Audio sintetizado con WebAudio (sin archivos externos). Se activa tras el primer gesto del usuario. */

type Sfx = "step" | "bump" | "select" | "encounter" | "hit" | "super" | "weak" | "faint" | "levelup" | "catch" | "heal" | "miss" | "warp" | "talk";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let musicTimer = 0;
let musicOn = false;

function ac() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.18;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", when = 0, slideTo?: number, vol = 1) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export function sfx(name: Sfx) {
  switch (name) {
    case "step": tone(120, 0.04, "triangle", 0, 90, 0.5); break;
    case "bump": tone(90, 0.08, "square", 0, 60, 0.6); break;
    case "select": tone(660, 0.05); tone(880, 0.06, "square", 0.05); break;
    case "talk": tone(520, 0.04, "square", 0, undefined, 0.5); break;
    case "encounter": [0, 1, 2, 3, 4, 5].forEach((i) => tone(300 + (i % 2) * 300, 0.07, "sawtooth", i * 0.07)); break;
    case "hit": tone(200, 0.12, "sawtooth", 0, 80); break;
    case "super": tone(260, 0.1, "sawtooth", 0, 90); tone(520, 0.14, "square", 0.08, 120); break;
    case "weak": tone(150, 0.14, "triangle", 0, 100, 0.6); break;
    case "miss": tone(400, 0.12, "sine", 0, 200, 0.5); break;
    case "faint": tone(440, 0.5, "triangle", 0, 70); break;
    case "levelup": [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", i * 0.1)); break;
    case "catch": [392, 523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", i * 0.12)); break;
    case "heal": [523, 659, 784].forEach((f, i) => tone(f, 0.18, "sine", i * 0.14)); break;
    case "warp": tone(300, 0.2, "sine", 0, 900, 0.7); break;
  }
}

const MELODY = [523, 0, 659, 784, 659, 0, 523, 392, 440, 0, 523, 659, 587, 0, 392, 0];
const BASS = [131, 131, 196, 196, 175, 175, 196, 196];
export function startMusic() {
  if (musicOn || !ac()) return;
  musicOn = true;
  let step = 0;
  musicTimer = window.setInterval(() => {
    const f = MELODY[step % MELODY.length];
    if (f) tone(f, 0.2, "triangle", 0, undefined, 0.5);
    if (step % 2 === 0) tone(BASS[(step / 2) % BASS.length], 0.38, "square", 0, undefined, 0.22);
    step++;
  }, 240);
}
export function stopMusic() { clearInterval(musicTimer); musicOn = false; }
export function setMuted(m: boolean) { muted = m; if (master) master.gain.value = m ? 0 : 0.18; }
export const isMuted = () => muted;
