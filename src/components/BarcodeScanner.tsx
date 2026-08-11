import { useEffect, useRef, useState } from "react";
import { ScanLine, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  /** يُستدعى فور اكتشاف أي باركود بالنص الخام. */
  onDetected: (raw: string) => void;
};

const FORMATS = ["data_matrix", "qr_code", "ean_13", "code_128"];

type DetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const detectedRef = useRef(onDetected);
  const closeRef = useRef(onClose);
  detectedRef.current = onDetected;
  closeRef.current = onClose;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let zxingControls: { stop: () => void } | undefined;
    doneRef.current = false;
    setError(null);
    setReady(false);
    setClosing(false);

    const stopStream = () => {
      stream?.getTracks().forEach((t) => t.stop());
      zxingControls?.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const succeed = (raw: string) => {
      if (doneRef.current || !raw) return;
      doneRef.current = true;
      cancelAnimationFrame(raf);
      stopStream();
      try {
        navigator.vibrate?.(40);
      } catch {
        /* تجاهل */
      }
      detectedRef.current(raw);
      setClosing(true);
      fadeTimer = setTimeout(() => closeRef.current(), 140);
    };

    const startZxing = async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      if (!videoRef.current) return;
      zxingControls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (result) succeed(result.getText());
        },
      );
      setReady(true);
    };

    const start = async () => {
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike })
        .BarcodeDetector;

      if (!Detector) {
        try {
          await startZxing();
        } catch {
          setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق.");
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق.");
        return;
      }
      if (doneRef.current) {
        stopStream();
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      try {
        await track?.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        } as unknown as MediaTrackConstraints);
      } catch {
        /* اختياري حسب الجهاز */
      }
      setReady(true);

      const detector = new Detector({ formats: FORMATS });
      let busy = false;
      const loop = () => {
        if (doneRef.current) return;
        raf = requestAnimationFrame(loop);
        if (busy || !video.videoWidth) return;
        busy = true;
        detector
          .detect(video)
          .then((codes) => {
            const raw = codes?.[0]?.rawValue;
            if (raw) succeed(raw);
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      };
      raf = requestAnimationFrame(loop);
    };

    void start();

    return () => {
      doneRef.current = true;
      cancelAnimationFrame(raf);
      if (fadeTimer) clearTimeout(fadeTimer);
      stopStream();
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
          <ScanLine className="size-5" /> مسح الباركود
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
        <div className="pointer-events-none absolute inset-x-10 top-1/2 h-48 -translate-y-1/2 rounded-2xl border-2 border-primary/70" />
      </div>
      {error && <p className="p-4 text-center text-sm text-background/90">{error}</p>}
    </div>
  );
}
