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

const SCAN_INTERVAL = 700;
const SLOW_HINT_AFTER = 15_000;

export function PhotoCapture({ open, title, hint, onClose, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stoppedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    stoppedRef.current = false;
    setError(null);
    setReady(false);
    setBusy(false);
    setSlow(false);

    const grabFrame = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      const width = Math.min(video.videoWidth, 960);
      const scale = width / video.videoWidth;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
    };

    const loop = async () => {
      if (stoppedRef.current) return;
      const frame = grabFrame();
      if (frame) {
        setBusy(true);
        let done = false;
        try {
          done = await onScan(frame);
        } catch {
          done = false;
        }
        setBusy(false);
        if (done || stoppedRef.current) {
          stoppedRef.current = true;
          try {
            navigator.vibrate?.(60);
          } catch {
            /* ignore */
          }
          return;
        }
      }
      timer = setTimeout(() => void loop(), SCAN_INTERVAL);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then((s) => {
        if (stoppedRef.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setReady(true);
        slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_AFTER);
        timer = setTimeout(() => void loop(), 400);
      })
      .catch(() => setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق."));

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      if (slowTimer) clearTimeout(slowTimer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onScan]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-foreground/95 backdrop-blur">
      <div className="flex items-center justify-between p-4 text-background">
        <span className="flex items-center gap-2 font-semibold">
          <Camera className="size-5" /> {title}
        </span>
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="إغلاق">
          <X className="size-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-4/5 rounded-2xl border-2 border-dashed border-primary" />
        </div>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/40 text-background">
            <Loader2 className="size-7 animate-spin" />
          </div>
        )}
        {ready && (
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-background/20">
            <div className={busy ? "h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] bg-primary" : "h-full w-full bg-primary/40"} />
          </div>
        )}
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
