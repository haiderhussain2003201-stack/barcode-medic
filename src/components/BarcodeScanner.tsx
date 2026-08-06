import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Loader2, ScanBarcode, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
};

export function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let controls: IScannerControls | undefined;
    let cancelled = false;
    setError(null);
    setReady(false);

    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (result) => {
          if (result && !cancelled) {
            cancelled = true;
            controls?.stop();
            onDetected(result.getText());
          }
        },
      )
      .then((c) => {
        controls = c;
        if (cancelled) c.stop();
        else setReady(true);
      })
      .catch(() => setError("تعذّر فتح الكاميرا. تأكد من منح الإذن للتطبيق."));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, onDetected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/95 backdrop-blur">
      <div className="flex items-center justify-between p-4 text-background">
        <span className="flex items-center gap-2 font-semibold">
          <ScanBarcode className="size-5" /> امسح الباركود
        </span>
        <Button variant="secondary" size="icon" onClick={onClose} aria-label="إغلاق">
          <X className="size-4" />
        </Button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-4/5 rounded-2xl border-2 border-primary shadow-float" />
        </div>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-background">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
      </div>
      <p className="p-4 text-center text-sm text-background/80">
        {error ?? "وجّه الكاميرا نحو الباركود على العلبة"}
      </p>
    </div>
  );
}
