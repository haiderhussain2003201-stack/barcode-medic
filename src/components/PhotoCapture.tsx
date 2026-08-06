import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  title: string;
  hint: string;
  busy?: boolean;
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
};

export function PhotoCapture({ open, title, hint, busy, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    setError(null);
    setReady(false);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch(() => setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق."));

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const width = Math.min(video.videoWidth || 1280, 1280);
    const scale = width / (video.videoWidth || width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((video.videoHeight || 720) * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.85));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/95 backdrop-blur">
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
        {(!ready || busy) && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-foreground/40 text-background">
            <Loader2 className="size-7 animate-spin" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4 text-center">
        <p className="text-sm text-background/80">{error ?? hint}</p>
        <Button size="lg" className="w-full" onClick={capture} disabled={!ready || busy}>
          {busy ? "جارٍ القراءة..." : "التقاط الصورة"}
        </Button>
      </div>
    </div>
  );
}
