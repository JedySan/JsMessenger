// Редактор картинки перед отправкой: обрезать, повернуть, нарисовать поверх.
// Рабочая картинка — один <canvas> в натуральном размере; каждое действие сначала кладёт снимок в «Отменить».
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Check, Crop, Pencil, RotateCcw, RotateCw, Undo2, X } from "lucide-react";
import { tr } from "../i18n";

type Tool = "draw" | "crop";
type Rect = { x: number; y: number; w: number; h: number }; // в долях картинки 0..1

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];
const SIZES = [1, 2.5, 5];
const MAX_UNDO = 10;

/** Можно ли редактировать этот файл (анимацию GIF редактор бы потерял). */
export function isEditableImage(f: File): boolean {
  return /^image\/(png|jpe?g|webp|bmp)$/i.test(f.type);
}

export default function ImageEditor({ file, onDone, onCancel }: { file: File; onDone: (f: File) => void; onCancel: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [undo, setUndo] = useState<HTMLCanvasElement[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setLayout] = useState(0); // перерисовать рамку обрезки при смене размера окна
  const drawing = useRef<{ last: [number, number] } | null>(null);
  const dragging = useRef<{ mode: string; start: [number, number]; rect: Rect } | null>(null);

  // загрузить картинку в холст
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = cv.current!;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      setReady(true);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [file]);

  useEffect(() => {
    const f = () => setLayout((x) => x + 1);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const snapshot = () => {
    const c = cv.current!;
    const s = document.createElement("canvas");
    s.width = c.width;
    s.height = c.height;
    s.getContext("2d")!.drawImage(c, 0, 0);
    setUndo((u) => [...u.slice(-(MAX_UNDO - 1)), s]);
  };
  const restore = () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    const c = cv.current!;
    c.width = prev.width;
    c.height = prev.height;
    c.getContext("2d")!.drawImage(prev, 0, 0);
    setUndo((u) => u.slice(0, -1));
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
  };

  /** Точка указателя в пикселях картинки. */
  const toImage = (e: RPointerEvent): [number, number] => {
    const c = cv.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const toFrac = (e: RPointerEvent): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  // ---------- рисование ----------
  const lineWidth = () => {
    const c = cv.current!;
    return Math.max(2, Math.round(Math.max(c.width, c.height) / 300)) * size;
  };
  const penDown = (e: RPointerEvent) => {
    if (tool !== "draw" || !ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
    const p = toImage(e);
    drawing.current = { last: p };
    const ctx = cv.current!.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p[0], p[1], lineWidth() / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  const penMove = (e: RPointerEvent) => {
    const d = drawing.current;
    if (!d) return;
    const p = toImage(e);
    const ctx = cv.current!.getContext("2d")!;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(d.last[0], d.last[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    d.last = p;
  };
  const penUp = () => {
    drawing.current = null;
  };

  // ---------- обрезка: рамку тянут за углы и стороны, двигают за середину ----------
  const cropDown = (mode: string) => (e: RPointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { mode, start: toFrac(e), rect: crop };
  };
  const cropMove = (e: RPointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const [fx, fy] = toFrac(e);
    const dx = fx - d.start[0];
    const dy = fy - d.start[1];
    const MIN = 0.05;
    let { x, y, w, h } = d.rect;
    if (d.mode === "move") {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      if (d.mode.includes("w")) {
        const nx = Math.min(x + w - MIN, Math.max(0, x + dx));
        w += x - nx;
        x = nx;
      }
      if (d.mode.includes("e")) w = Math.min(1 - x, Math.max(MIN, w + dx));
      if (d.mode.includes("n")) {
        const ny = Math.min(y + h - MIN, Math.max(0, y + dy));
        h += y - ny;
        y = ny;
      }
      if (d.mode.includes("s")) h = Math.min(1 - y, Math.max(MIN, h + dy));
    }
    setCrop({ x, y, w, h });
  };
  const cropUp = () => {
    dragging.current = null;
  };
  const cropped = crop.w < 0.999 || crop.h < 0.999 || crop.x > 0.001 || crop.y > 0.001;
  const applyCrop = () => {
    if (!cropped) return;
    const c = cv.current!;
    snapshot();
    const sx = Math.round(crop.x * c.width);
    const sy = Math.round(crop.y * c.height);
    const sw = Math.max(1, Math.round(crop.w * c.width));
    const sh = Math.max(1, Math.round(crop.h * c.height));
    const tmp = document.createElement("canvas");
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext("2d")!.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
    c.width = sw;
    c.height = sh;
    c.getContext("2d")!.drawImage(tmp, 0, 0);
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
  };

  const rotate = (dir: 1 | -1) => {
    if (tool === "crop") applyCrop();
    const c = cv.current!;
    snapshot();
    const tmp = document.createElement("canvas");
    tmp.width = c.height;
    tmp.height = c.width;
    const t = tmp.getContext("2d")!;
    t.translate(tmp.width / 2, tmp.height / 2);
    t.rotate((dir * Math.PI) / 2);
    t.drawImage(c, -c.width / 2, -c.height / 2);
    c.width = tmp.width;
    c.height = tmp.height;
    c.getContext("2d")!.drawImage(tmp, 0, 0);
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
  };

  const switchTool = (t: Tool) => {
    if (tool === "crop" && t !== "crop") applyCrop();
    setTool(t);
  };

  const done = async () => {
    if (tool === "crop") applyCrop();
    setBusy(true);
    // JPEG остаётся JPEG (меньше весит), остальное — PNG
    const jpeg = /jpe?g/i.test(file.type);
    const type = jpeg ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((res) => cv.current!.toBlob(res, type, 0.92));
    setBusy(false);
    if (!blob) return onCancel();
    const name = jpeg ? file.name : file.name.replace(/\.[^.]+$/, "") + ".png";
    onDone(new File([blob], name, { type, lastModified: Date.now() }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        restore();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="img-editor" role="dialog" aria-label={tr("Редактор картинки")} onClick={(e) => e.stopPropagation()}>
      <div className="img-editor-top">
        <button className="icon-btn" onClick={onCancel} aria-label={tr("Отмена")} title={tr("Отмена")}>
          <X size={20} />
        </button>
        <span className="img-editor-title">{tool === "crop" ? tr("Обрезка") : tr("Рисование")}</span>
        <button className="primary small" onClick={() => void done()} disabled={!ready || busy}>
          <Check size={16} /> {tr("Готово")}
        </button>
      </div>

      <div className="img-editor-stage" ref={stage}>
        <div className="img-editor-canvas">
          <canvas
            ref={cv}
            className={tool === "draw" ? "drawing" : ""}
            onPointerDown={penDown}
            onPointerMove={penMove}
            onPointerUp={penUp}
            onPointerCancel={penUp}
          />
          {tool === "crop" && ready && (
            <div className="crop-layer" onPointerMove={cropMove} onPointerUp={cropUp} onPointerCancel={cropUp}>
              <div
                className="crop-box"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={cropDown("move")}
              >
                {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((m) => (
                  <span key={m} className={"crop-h h-" + m} onPointerDown={cropDown(m)} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="img-editor-tools">
        <div className="seg">
          <button className={tool === "draw" ? "on" : ""} onClick={() => switchTool("draw")} title={tr("Рисовать")} aria-label={tr("Рисовать")}>
            <Pencil size={18} />
          </button>
          <button className={tool === "crop" ? "on" : ""} onClick={() => switchTool("crop")} title={tr("Обрезать")} aria-label={tr("Обрезать")}>
            <Crop size={18} />
          </button>
        </div>
        {tool === "draw" ? (
          <div className="img-editor-pen">
            {COLORS.map((c) => (
              <button key={c} className={"swatch" + (c === color ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
            <span className="sep" />
            {SIZES.map((s) => (
              <button key={s} className={"pen-size" + (s === size ? " on" : "")} onClick={() => setSize(s)} aria-label={tr("Толщина {0}", s)}>
                <span style={{ width: 4 + s * 3, height: 4 + s * 3, background: color }} />
              </button>
            ))}
          </div>
        ) : (
          <div className="img-editor-pen">
            <button className="icon-btn" onClick={() => rotate(-1)} title={tr("Повернуть влево")} aria-label={tr("Повернуть влево")}>
              <RotateCcw size={18} />
            </button>
            <button className="icon-btn" onClick={() => rotate(1)} title={tr("Повернуть вправо")} aria-label={tr("Повернуть вправо")}>
              <RotateCw size={18} />
            </button>
            <button className="ghost small" onClick={applyCrop} disabled={!cropped}>
              {tr("Обрезать")}
            </button>
          </div>
        )}
        <button className="icon-btn" onClick={restore} disabled={!undo.length} title={tr("Отменить")} aria-label={tr("Отменить")}>
          <Undo2 size={18} />
        </button>
      </div>
    </div>
  );
}
