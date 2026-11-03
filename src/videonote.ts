// «Кружочки» — короткие видеосообщения, как в Telegram. Снимаем фронтальной камерой, обрезаем в квадрат
// на canvas и пишем MediaRecorder'ом. В Matrix это обычное m.video с пометкой jsm.video_note: другие
// клиенты покажут его как видео, мы — кружком.
export const MAX_NOTE_SECONDS = 60;
export const NOTE_SIZE = 400;
export const NOTE_FLAG = "jsm.video_note";

export const isVideoNote = (c: Record<string, any>) => !!c?.[NOTE_FLAG];

/** Формат записи: MP4 играют все (Safari/iPhone тоже), WebM — запасной. */
function pickMime(): string {
  const list = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=avc1,opus",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return list.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export const canRecordVideoNote = () =>
  typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!pickMime();

export interface NoteResult {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export class VideoNoteRecorder {
  private camera: MediaStream | null = null;
  private canvas = document.createElement("canvas");
  private video = document.createElement("video");
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private raf = 0;
  private startedAt = 0;
  private facing: "user" | "environment" = "user";
  readonly mime = pickMime();
  /** что показывать в кружке предпросмотра */
  preview: MediaStream | null = null;

  async start(): Promise<void> {
    this.canvas.width = this.canvas.height = NOTE_SIZE;
    await this.openCamera();
    const g = this.canvas.getContext("2d")!;
    const draw = () => {
      const v = this.video;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (w && h) {
        const side = Math.min(w, h);
        g.drawImage(v, (w - side) / 2, (h - side) / 2, side, side, 0, 0, NOTE_SIZE, NOTE_SIZE);
      }
      this.raf = requestAnimationFrame(draw);
    };
    draw();
    const out = this.canvas.captureStream(30);
    this.camera!.getAudioTracks().forEach((t) => out.addTrack(t));
    this.preview = this.camera;
    this.rec = new MediaRecorder(out, { mimeType: this.mime, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 });
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(500);
    this.startedAt = performance.now();
  }

  private async openCamera() {
    this.camera?.getVideoTracks().forEach((t) => t.stop());
    const audio = this.camera?.getAudioTracks()[0];
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 640 } },
      audio: audio ? false : { echoCancellation: true, noiseSuppression: true },
    });
    if (audio) s.addTrack(audio);
    this.camera = s;
    this.preview = s;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = s;
    await this.video.play().catch(() => {});
  }

  /** Переключить переднюю/заднюю камеру (телефон). */
  async flip() {
    this.facing = this.facing === "user" ? "environment" : "user";
    await this.openCamera();
  }
  get mirrored() {
    return this.facing === "user";
  }
  get seconds() {
    return (performance.now() - this.startedAt) / 1000;
  }

  stop(): Promise<NoteResult> {
    const durationMs = Math.round(performance.now() - this.startedAt);
    return new Promise((resolve, reject) => {
      const rec = this.rec;
      if (!rec) return reject(new Error("not recording"));
      rec.onstop = () => {
        const mime = (this.mime || "video/webm").split(";")[0];
        resolve({ blob: new Blob(this.chunks, { type: mime }), mime, durationMs });
        this.cleanup();
      };
      rec.stop();
    });
  }

  cancel() {
    try {
      if (this.rec?.state !== "inactive") this.rec?.stop();
    } catch {
      /* уже остановлен */
    }
    this.cleanup();
  }

  private cleanup() {
    cancelAnimationFrame(this.raf);
    this.camera?.getTracks().forEach((t) => t.stop());
    this.camera = null;
    this.preview = null;
    this.rec = null;
  }
}
