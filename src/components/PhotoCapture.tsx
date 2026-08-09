import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  /** يُستدعى لكل لقطة أثناء المسح التلقائي؛ يعيد true عند نجاح التعرّف. */
  onScan: (dataUrl: string) => Promise<boolean>;
};

const SCAN_INTERVAL = 300;
const MAX_IN_FLIGHT = 3;

export function PhotoCapture({ open, title, onClose, onScan }: Props) {
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
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    stoppedRef.current = false;
    inFlightRef.current = 0;
    setError(null);
    setReady(false);
    setClosing(false);

    const getCanvas = () => {
      if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
      return canvasRef.current;
    };

    const grabFrame = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      const sw = video.videoWidth;
      const sh = video.videoHeight;
      const width = Math.min(sw, 1024);
      const scale = width / sw;
      const canvas = getCanvas();
      canvas.width = width;
      canvas.height = Math.round(sh * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
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
        timer = setTimeout(tick, 200);
      })
      .catch(() => setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق."));

    const blockGesture = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("gesturechange", blockGesture);

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
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
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-background">
            <Loader2 className="size-7 animate-spin" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-background/20">
          <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] bg-primary" />
        </div>
      </div>
      {error && <p className="p-4 text-center text-sm text-background/90">{error}</p>}
    </div>
  );
}
