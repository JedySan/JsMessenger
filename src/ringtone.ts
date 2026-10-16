// Мелодия входящего звонка и гудки исходящего — синтезируются WebAudio, без звуковых файлов.

let ctx: AudioContext | null = null;
let timer: number | undefined;
let playing: "ring" | "ringback" | null = null;

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Мягкая нота с плавной атакой и затуханием. */
function tone(freq: number, start: number, dur: number, gain: number) {
  const a = audio();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = a.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Входящий: короткая восходящая трель раз в 2,5 секунды. */
function ringOnce() {
  const notes = [659.25, 783.99, 987.77, 783.99]; // E5 G5 B5 G5
  notes.forEach((f, i) => tone(f, i * 0.16, 0.5, 0.16));
  notes.forEach((f, i) => tone(f, 0.9 + i * 0.16, 0.5, 0.16));
}

/** Исходящий: длинный гудок 425 Гц (как в телефонной сети), раз в 4 секунды. */
function ringbackOnce() {
  tone(425, 0, 1.0, 0.08);
}

export function startRingtone(kind: "ring" | "ringback" = "ring") {
  if (playing === kind) return;
  stopRingtone();
  playing = kind;
  const once = kind === "ring" ? ringOnce : ringbackOnce;
  try {
    once();
  } catch (e) {
    console.warn("ringtone", e);
  }
  timer = window.setInterval(() => {
    try {
      once();
    } catch {
      /* нет звука — не страшно */
    }
  }, kind === "ring" ? 2500 : 4000);
}

export function stopRingtone() {
  playing = null;
  window.clearInterval(timer);
  timer = undefined;
}
