// Голосовые сообщения: запись в Ogg Opus (как у Element и Element X — их понимают все клиенты Matrix),
// «волна» для отображения и запасное декодирование Ogg там, где WebView не умеет его играть (старый Safari).
// Кодек — opus-recorder (WebAssembly), воркеры лежат в public/opus.
import Recorder from "opus-recorder";

const ENCODER = "/opus/encoderWorker.min.js";
const DECODER = "/opus/decoderWorker.min.js";
/** Столько столбиков «волны» уходит в сообщение (Element хранит так же, значения 0…1024) */
const WAVE_BARS = 64;
export const MAX_VOICE_SECONDS = 15 * 60;

export interface VoiceResult {
  blob: Blob;
  durationMs: number;
  /** 0…1024 — для org.matrix.msc1767.audio.waveform */
  waveform: number[];
}

export class VoiceRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private rec: any = null;
  private analyser: AnalyserNode | null = null;
  private timer = 0;
  private startedAt = 0;
  private done: Promise<Blob> | null = null;
  /** громкость каждые 100 мс, 0…1 */
  readonly levels: number[] = [];
  onTick?: (seconds: number, level: number) => void;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AC: typeof AudioContext = window.AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new AC();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.rec = new Recorder({
      sourceNode: source,
      encoderPath: ENCODER,
      encoderApplication: 2048, // голос
      encoderSampleRate: 48000,
      numberOfChannels: 1,
      streamPages: false,
    });
    this.done = new Promise<Blob>((resolve) => {
      this.rec.ondataavailable = (data: Uint8Array) => resolve(new Blob([data as BlobPart], { type: "audio/ogg" }));
    });
    await this.rec.start();
    this.startedAt = performance.now();
    const buf = new Float32Array(this.analyser.fftSize);
    this.timer = window.setInterval(() => {
      this.analyser!.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      // громкость в «человеческой» шкале: тихая речь тоже заметна
      const level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.6);
      this.levels.push(level);
      const sec = (performance.now() - this.startedAt) / 1000;
      this.onTick?.(sec, level);
    }, 100);
  }

  private cleanup() {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }

  /** Остановить и получить запись. */
  async stop(): Promise<VoiceResult> {
    const durationMs = Math.round(performance.now() - this.startedAt);
    this.rec.stop();
    const blob = await this.done!;
    this.rec.close?.();
    this.cleanup();
    return { blob, durationMs, waveform: shrinkWave(this.levels, WAVE_BARS).map((v) => Math.round(v * 1024)) };
  }

  /** Отменить запись — ничего не отправлять. */
  cancel() {
    try {
      this.rec?.stop();
      this.rec?.close?.();
    } catch {
      /* уже остановлен */
    }
    this.cleanup();
  }
}

/** Сжать ряд громкостей до n столбиков (максимум в каждой группе — так пики не теряются). */
export function shrinkWave(levels: number[], n: number): number[] {
  if (!levels.length) return new Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    let m = 0;
    for (let j = a; j < b && j < levels.length; j++) m = Math.max(m, levels[j]);
    out.push(m);
  }
  return out;
}

/** «Волна» из сообщения: 0…1024 → 0…1, приведённая к n столбикам. */
export function waveFromContent(content: Record<string, any>, n: number): number[] {
  const w = content["org.matrix.msc1767.audio"]?.waveform ?? content["org.matrix.msc3245.voice"]?.waveform;
  if (!Array.isArray(w) || !w.length) return new Array(n).fill(0.25);
  const max = Math.max(1, ...w.map((x: unknown) => Number(x) || 0));
  // у некоторых клиентов шкала не 1024 — нормируем по максимуму
  const norm = w.map((x: unknown) => (Number(x) || 0) / Math.max(max, 1024 * 0.5));
  return shrinkWave(norm, n).map((v) => Math.min(1, Math.max(0.06, v)));
}

export function isVoice(content: Record<string, any>): boolean {
  return !!content["org.matrix.msc3245.voice"] || (content.msgtype === "m.audio" && !!content["org.matrix.msc1767.audio"]);
}

// ---------- проигрывание Ogg там, где WebView его не умеет ----------
export function canPlayOgg(): boolean {
  const a = document.createElement("audio");
  return !!a.canPlayType('audio/ogg; codecs="opus"');
}

/** Ogg Opus → WAV (через декодер opus-recorder). */
export function oggToWav(ogg: ArrayBuffer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(DECODER);
    const chunks: Float32Array[] = [];
    worker.onmessage = (e) => {
      if (e.data === null) {
        worker.terminate();
        resolve(wavFromPcm(chunks, 48000));
        return;
      }
      if (Array.isArray(e.data)) chunks.push(new Float32Array(e.data[0]));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "decoder"));
    };
    worker.postMessage({ command: "init", decoderSampleRate: 48000, outputBufferSampleRate: 48000 });
    const pages = new Uint8Array(ogg);
    worker.postMessage({ command: "decode", pages }, [pages.buffer]);
    worker.postMessage({ command: "done" });
  });
}

function wavFromPcm(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + total * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, total * 2, true);
  let o = 44;
  for (const c of chunks)
    for (const s of c) {
      v.setInt16(o, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
      o += 2;
    }
  return new Blob([buf], { type: "audio/wav" });
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
