import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, Keyboard } from "lucide-react";
import { playBeep } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorAlert } from "@/components/common";

const FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.QR_CODE,
];

/** Phone / webcam barcode scanner (FR-02). USB scanners type into the normal scan box instead. */
export function BarcodeScannerDialog({ open, onOpenChange, onDetected, continuous = false, title = "Scan barcode" }) {
  const regionId = useRef(`scan-${Math.random().toString(36).slice(2, 10)}`).current;
  const callback = useRef(onDetected);
  const close = useRef(onOpenChange);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState("");
  const [last, setLast] = useState(null);

  useEffect(() => {
    callback.current = onDetected;
    close.current = onOpenChange;
  }, [onDetected, onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setLast(null);
    let scanner = null;
    let cancelled = false;
    let lastCode = null;
    let lastAt = 0;

    const start = async () => {
      await new Promise((r) => setTimeout(r, 80)); // let the dialog mount its content
      if (cancelled || !document.getElementById(regionId)) return;
      if (!window.isSecureContext) {
        setError("Camera needs HTTPS (or localhost). Use a USB scanner or type the code below.");
        return;
      }
      try {
        scanner = new Html5Qrcode(regionId, { formatsToSupport: FORMATS, verbose: false });
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.85, 340)), height: Math.floor(Math.min(h * 0.6, 170)) }),
          },
          (text) => {
            const now = Date.now();
            if (text === lastCode && now - lastAt < 1800) return;
            lastCode = text;
            lastAt = now;
            playBeep();
            setLast(text);
            callback.current?.(text);
            if (!continuous) close.current?.(false);
          },
          () => {}
        );
        if (cancelled) await scanner.stop().catch(() => {});
      } catch (e) {
        if (!cancelled) setError(`Could not start the camera: ${e?.message || e}. Allow camera access or type the code.`);
      }
    };
    start();

    return () => {
      cancelled = true;
      if (scanner) {
        const s = scanner;
        Promise.resolve(s.isScanning ? s.stop() : null)
          .catch(() => {})
          .finally(() => {
            try {
              s.clear();
            } catch {
              /* already cleared */
            }
          });
      }
    };
  }, [open, continuous, regionId]);

  const submitManual = (e) => {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    callback.current?.(code);
    setManual("");
    if (!continuous) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>Point the camera at the barcode (EAN-13, Code-128 or shop label).</DialogDescription>
        </DialogHeader>
        <div id={regionId} className="min-h-[220px] overflow-hidden rounded-lg bg-black/90" />
        <ErrorAlert message={error} />
        {continuous && last && <p className="text-sm text-muted-foreground">Last scanned: <span className="font-mono">{last}</span></p>}
        <form onSubmit={submitManual} className="flex gap-2">
          <div className="relative flex-1">
            <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Type barcode" className="pl-9" inputMode="numeric" />
          </div>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
