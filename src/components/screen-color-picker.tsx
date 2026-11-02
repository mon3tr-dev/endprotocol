import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

interface ScreenCaptureResult {
  width: number;
  height: number;
  data: string;
}

interface ScreenColorPickerProps {
  onPick: (hex: string) => void;
  onCancel: () => void;
}

const MAGNIFIER = 220;
const ZOOM = 6;

export default function ScreenColorPicker({ onPick, onCancel }: ScreenColorPickerProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const magRef = useRef<HTMLDivElement>(null);
  const magCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<{ sx: number; sy: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<ScreenCaptureResult | null>(null);
  const [hoverColor, setHoverColor] = useState<{ hex: string; r: number; g: number; b: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ScreenCaptureResult>("capture_screen")
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("error");
          setError(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    const canvas = displayRef.current;
    if (!canvas) return;
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setStatus("error");
      setError("canvas not supported");
      return;
    }
    try {
      const binary = atob(data.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const imageData = new ImageData(
        new Uint8ClampedArray(bytes.buffer),
        data.width,
        data.height,
      );
      ctx.putImageData(imageData, 0, 0);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  }, [data]);

  const handleCancel = useCallback(() => {
    void invoke("finish_screen_pick");
    onCancel();
  }, [onCancel]);

  const renderMagnifier = useCallback((sx: number, sy: number) => {
    const canvas = displayRef.current;
    const mag = magRef.current;
    const mcv = magCanvasRef.current;
    const pointer = pointerRef.current;
    if (!canvas || !mag || !mcv) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cx = rect.left + (sx / canvas.width) * rect.width;
    const cy = rect.top + (sy / canvas.height) * rect.height;

    if (pointer) {
      pointer.style.left = `${cx}px`;
      pointer.style.top = `${cy}px`;
    }

    const px = canvas
      .getContext("2d")
      ?.getImageData(
        Math.min(canvas.width - 1, Math.max(0, Math.round(sx))),
        Math.min(canvas.height - 1, Math.max(0, Math.round(sy))),
        1,
        1,
      )?.data;
    if (px) {
      const toHex = (n: number) => n.toString(16).padStart(2, "0");
      setHoverColor({
        hex: `#${toHex(px[0])}${toHex(px[1])}${toHex(px[2])}`,
        r: px[0],
        g: px[1],
        b: px[2],
      });
    }

    // 放大镜边缘一旦碰到屏幕右/下边界，立即切换到另一侧
    const off = 18;
    let mx = cx + off + MAGNIFIER;
    let my = cy + off + MAGNIFIER;
    if (mx + MAGNIFIER >= window.innerWidth - 2) mx = cx - off - MAGNIFIER;
    if (my + MAGNIFIER >= window.innerHeight - 2) my = cy - off - MAGNIFIER;
    mag.style.left = `${mx}px`;
    mag.style.top = `${my}px`;

    const mctx = mcv.getContext("2d");
    if (!mctx) return;
    mctx.clearRect(0, 0, MAGNIFIER, MAGNIFIER);
    mctx.imageSmoothingEnabled = true;
    const srcSize = MAGNIFIER / ZOOM;
    mctx.drawImage(
      canvas,
      sx - srcSize / 2,
      sy - srcSize / 2,
      srcSize,
      srcSize,
      0,
      0,
      MAGNIFIER,
      MAGNIFIER,
    );
    mctx.strokeStyle = "rgba(255,255,255,0.9)";
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.moveTo(MAGNIFIER / 2 - 9, MAGNIFIER / 2);
    mctx.lineTo(MAGNIFIER / 2 + 9, MAGNIFIER / 2);
    mctx.moveTo(MAGNIFIER / 2, MAGNIFIER / 2 - 9);
    mctx.lineTo(MAGNIFIER / 2, MAGNIFIER / 2 + 9);
    mctx.stroke();
  }, []);

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (status !== "ready") return;
      const canvas = displayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const sx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const sy = ((e.clientY - rect.top) / rect.height) * canvas.height;
      currentRef.current = { sx, sy };
      renderMagnifier(sx, sy);
    },
    [status, renderMagnifier],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
        return;
      }
      if (status !== "ready") return;
      const dirs: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const d = dirs[e.key];
      if (!d) return;
      e.preventDefault();
      const canvas = displayRef.current;
      if (!canvas) return;
      const cur = currentRef.current ?? { sx: canvas.width / 2, sy: canvas.height / 2 };
      const sx = Math.min(canvas.width - 1, Math.max(0, cur.sx + d[0]));
      const sy = Math.min(canvas.height - 1, Math.max(0, cur.sy + d[1]));
      currentRef.current = { sx, sy };
      renderMagnifier(sx, sy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, renderMagnifier, handleCancel]);

  const handlePick = useCallback(
    (e: React.MouseEvent) => {
      // 阻止事件冒泡到 document，避免底层取色弹窗被「点击外部」逻辑误关
      e.stopPropagation();
      if (e.button !== 0) return;
      if (status !== "ready") return;
      const canvas = displayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const sx = Math.max(
        0,
        Math.min(canvas.width - 1, Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width)),
      );
      const sy = Math.max(
        0,
        Math.min(canvas.height - 1, Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height)),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const px = ctx.getImageData(sx, sy, 1, 1).data;
      const toHex = (n: number) => n.toString(16).padStart(2, "0");
      void invoke("finish_screen_pick");
      onPick(`#${toHex(px[0])}${toHex(px[1])}${toHex(px[2])}`);
    },
    [status, onPick],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] cursor-crosshair select-none"
      onMouseMove={handleMove}
      onMouseDown={handlePick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      }}
    >
      {data && (
        <canvas
          ref={displayRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: "auto" }}
        />
      )}

      <div
        ref={magRef}
        className="fixed pointer-events-none rounded-full overflow-hidden"
        style={{
          width: MAGNIFIER,
          height: MAGNIFIER,
          left: -9999,
          top: -9999,
          border: "3px solid #ffffff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}
      >
        <canvas ref={magCanvasRef} width={MAGNIFIER} height={MAGNIFIER} className="w-full h-full" />
      </div>

      <div
        ref={pointerRef}
        className="fixed pointer-events-none rounded-full"
        style={{
          width: 4,
          height: 4,
          left: -9999,
          top: -9999,
          transform: "translate(-50%, -50%)",
          backgroundColor: "#ffffff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.8)",
        }}
      />

      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[10001] pointer-events-none">
        <div className="lg-regular rounded-xl px-4 py-2.5 text-sm text-foreground flex items-center gap-3">
          <div
            className="w-9 h-9 shrink-0 rounded-lg ring-1 ring-black/25 shadow-inner"
            style={{ backgroundColor: hoverColor?.hex ?? "#ffffff" }}
          />
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-sm font-medium">
              {hoverColor ? hoverColor.hex.toUpperCase() : "--"}
            </span>
            <span className="font-mono text-xs text-muted">
              {hoverColor
                ? `rgb(${String(hoverColor.r).padStart(3, "0")}, ${String(hoverColor.g).padStart(3, "0")}, ${String(hoverColor.b).padStart(3, "0")})`
                : "--"}
            </span>
          </div>
          <span className="text-xs text-muted ml-2">
            {status === "loading" && "Capturing screen..."}
            {status === "ready" && "Click to pick - Arrow keys for fine tune - Right click or Esc to cancel"}
            {status === "error" && `Screen capture failed: ${error}`}
          </span>
        </div>
      </div>

      {status === "error" && (
        <button
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
          onClick={handleCancel}
        >
          Close
        </button>
      )}
    </div>,
    document.body,
  );
}
