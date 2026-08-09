import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  hint: string;
  onClose: () => void;
  /** يُستدعى لكل لقطة أثناء المسح التلقائي؛ يعيد true عند نجاح التعرّف. */
  onScan: (dataUrl: string) => Promise<boolean>;
};

const SCAN_INTERVAL = 400;
const MAX_IN_FLIGHT = 2;
const SLOW_HINT_AFTER = 15_000;
const CROP_W = 0.86;
const CROP_H = 0.3;
const SHARPNESS_MIN = 8;

export function PhotoCapture({ open, title, hint, onClose, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(0);
  const scanRef = useRef(onScan);
  const closeRef = useRef(onClose);
  scanRef.current = onScan;
  closeRef.current = onClose;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    stoppedRef.current = false;
    inFlightRef.current = 0;
    setError(null);
    setReady(false);
    setSlow(false);
    setClosing(false);

    const getCanvas = () => {
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      return canvasRef.current;
    };

    /** حدّة تقريبية: متوسط فرق السطوع بين البكسلات المتجاورة. */
    const sharpness = (data: Uint8ClampedArray, w: number, h: number) => {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < h; y += 4) {
        for (let x = 4; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const j = (y * w + x - 4) * 4;
          const a = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
          const b = (data[j]! + data[j + 1]! + data[j + 2]!) / 3;
          sum += Math.abs(a - b);
          n++;
        }
      }
      return n ? sum / n : 0;
    };

    const grabFrame = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      const sw = Math.round(video.videoWidth * CROP_W);
      const sh = Math.round(video.videoHeight * CROP_H);
      const sx = Math.round((video.videoWidth - sw) / 2);
      const sy = Math.round((video.videoHeight - sh) / 2);
      const width = Math.min(sw, 768);
      const scale = width / sw;
      const canvas = getCanvas();
      canvas.width = width;
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      try {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (sharpness(img.data, canvas.width, canvas.height) < SHARPNESS_MIN) return null;
      } catch {
        /* ignore */
      }
      return canvas.toDataURL("image/jpeg", 0.6);
    };

    const finish = () => {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      try {
        navigator.vibrate?.(50);
      } catch {
        /* ignore */
      }
      setClosing(true);
      fadeTimer = setTimeout(() => closeRef.current(), 160);
    };

    const tick = () => {
      if (stoppedRef.current) return;
      if (inFlightRef.current < MAX_IN_FLIGHT) {
        const frame = grabFrame();
        if (frame) {
          inFlightRef.current++;
          void scanRef
            .current(frame)
            .then((done) => {
              if (done) finish();
            })
            .catch(() => undefined)
            .finally(() => {
              inFlightRef.current--;
            });
        }
      }
      timer = setTimeout(tick, SCAN_INTERVAL);
    };

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          frameRate: { ideal: 30 },
        },
      })
      .then(async (s) => {
        if (stoppedRef.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const track = s.getVideoTracks()[0];
        try {
          await track?.applyConstraints({
            advanced: [{ focusMode: "continuous" }, { zoom: 1 }],
          } as unknown as MediaTrackConstraints);
        } catch {
          /* غير مدعوم على بعض الأجهزة */
        }
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setReady(true);
        slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_AFTER);
        timer = setTimeout(tick, 300);
      })
      .catch(() => setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق."));

    const blockGesture = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("gesturechange", blockGesture);

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      if (slowTimer) clearTimeout(slowTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex touch-none flex-col bg-foreground/95 backdrop-blur transition-opacity duration-150"
      style={{ opacity: closing ? 0 : 1 }}
    >
      <div className="flex items-center justify-between p-4 text-background">
        <span className="flex items-center gap-2 font-semibold">
          <Camera className="size-5" /> {title}
        </span>
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="إغلاق">
          <X className="size-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="size-full object-cover transition-opacity duration-200"
          style={{ opacity: ready ? 1 : 0 }}
          muted
          playsInline
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-4/5 rounded-2xl border-2 border-dashed border-primary" />
        </div>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-background">
            <Loader2 className="size-7 animate-spin" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-background/20">
          <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] bg-primary" />
        </div>
      </div>
      <div className="space-y-2 p-4 text-center">
        <p className="text-sm text-background/90">
          {error ?? (slow ? "قرّب الكاميرا وثبّتها على النص" : hint)}
        </p>
        <p className="flex items-center justify-center gap-2 text-xs text-background/70">
          <Loader2 className="size-3 animate-spin" /> جارٍ القراءة تلقائيًا...
        </p>
      </div>
    </div>
  );
}
