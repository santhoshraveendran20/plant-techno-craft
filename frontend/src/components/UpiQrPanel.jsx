import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Loader2, RefreshCw, Smartphone, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { playError, playSuccess } from "@/lib/sound";
import { cn, formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UpiStatusBadge } from "@/components/common";

const LIVE = ["active", "partially_paid", "failed"];

export function formatCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function UpiQr({ request, size = 220, className }) {
  if (request?.image_url) {
    return <img src={request.image_url} alt="UPI QR code" width={size} height={size} className={cn("rounded-lg bg-white", className)} />;
  }
  if (!request?.payload) return null;
  return (
    <div className={cn("inline-flex rounded-xl border bg-white p-3", className)}>
      <QRCodeSVG value={request.payload} size={size} level="M" marginSize={0} />
    </div>
  );
}

/**
 * Dynamic QR for one bill / due payment. Polls status every 3 s (fallback for late webhooks),
 * plays a sound and calls onPaid when the gateway confirms (FR-10, FR-11, FR-13).
 */
export function UpiQrPanel({ request: initial, onPaid, onUpdate, onNewQr, allowSimulate, className }) {
  const [req, setReq] = useState(initial);
  const [secondsLeft, setSecondsLeft] = useState(initial?.seconds_left ?? 0);
  const [busy, setBusy] = useState(false);
  const [payerVpa, setPayerVpa] = useState("customer@okaxis");
  const prevStatus = useRef(initial?.status);
  const paidNotified = useRef(false);
  const callbacks = useRef({ onPaid, onUpdate });
  callbacks.current = { onPaid, onUpdate };

  useEffect(() => {
    setReq(initial);
    setSecondsLeft(initial?.seconds_left ?? 0);
    prevStatus.current = initial?.status;
    paidNotified.current = initial?.status === "paid";
  }, [initial]);

  const apply = useCallback(
    (data) => {
      setReq(data);
      setSecondsLeft(data.seconds_left);
      callbacks.current.onUpdate?.(data);
      const before = prevStatus.current;
      prevStatus.current = data.status;
      if (data.status === "paid" && !paidNotified.current) {
        paidNotified.current = true;
        playSuccess();
        toast.success(`Payment received: ${formatINR(data.received_amount)}`, { description: data.bill_no ? `Bill ${data.bill_no} is paid` : undefined });
        callbacks.current.onPaid?.(data);
      } else if (data.status !== before && data.status === "failed") {
        playError();
        toast.error("UPI payment failed", { description: data.closed_reason || "Ask the customer to retry or use a new QR" });
      } else if (data.status !== before && data.status === "partially_paid") {
        playError();
        toast.warning("Amount mismatch", { description: data.closed_reason });
      }
    },
    []
  );

  // Poll the server (which also polls the gateway) every 3 seconds while the QR is live.
  useEffect(() => {
    if (!req?.id || !LIVE.includes(req.status)) return undefined;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const res = await api.get(`/api/upi/requests/${req.id}`);
        if (alive) apply(res.data);
      } catch {
        /* keep polling; network blips are expected at the counter */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [req?.id, req?.status, apply]);

  useEffect(() => {
    if (!LIVE.includes(req?.status)) return undefined;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [req?.status]);

  const simulate = async (outcome, extra = {}) => {
    setBusy(true);
    try {
      const res = await api.post(`/api/upi/requests/${req.id}/simulate`, {
        outcome,
        payer_vpa: payerVpa || null,
        payer_name: "UPI Customer",
        ...extra,
      });
      apply(res.data.request);
      if (extra.deliver_webhook === false) toast.info("Webhook dropped - the 3-second status poll will pick it up");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/api/upi/requests/${req.id}/cancel`);
      apply({ ...req, ...res.data });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!req) return null;
  const left = Math.max(0, req.amount - req.received_amount);
  const expired = req.status === "active" && secondsLeft <= 0;

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="flex w-full items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{req.bill_no ? `Bill ${req.bill_no}` : "Due payment"}</p>
          <p className="tabular text-3xl font-semibold">{formatINR(req.amount)}</p>
        </div>
        <UpiStatusBadge status={expired ? "expired" : req.status} />
      </div>

      {req.status === "paid" ? (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-emerald-50 py-10 text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-16 w-16 animate-pop-in text-emerald-600" />
          <p className="text-lg font-semibold">Payment received</p>
          <p className="tabular text-sm">{formatINR(req.received_amount)} confirmed by the gateway</p>
        </div>
      ) : (
        <div className="relative">
          <UpiQr request={req} size={220} className={cn((expired || ["expired", "cancelled"].includes(req.status)) && "opacity-25 blur-[1px]")} />
          {(expired || ["expired", "cancelled"].includes(req.status)) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-md bg-background px-3 py-1 text-sm font-medium shadow">
                {req.status === "cancelled" ? "QR cancelled" : "QR expired"}
              </span>
            </div>
          )}
        </div>
      )}

      {LIVE.includes(req.status) && !expired && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Waiting for payment · <Clock className="h-4 w-4" />
          <span className="tabular font-medium text-foreground">{formatCountdown(secondsLeft)}</span>
        </div>
      )}
      {req.status === "failed" && (
        <p className="flex items-center gap-2 text-sm text-red-700">
          <XCircle className="h-4 w-4" /> {req.closed_reason || "Payment failed"}. Customer can retry, or create a new QR.
        </p>
      )}
      {req.status === "partially_paid" && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" /> Received {formatINR(req.received_amount)} — {formatINR(left)} still to collect.
        </p>
      )}
      {req.payload && LIVE.includes(req.status) && (
        <a href={req.payload} className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline sm:hidden">
          <Smartphone className="h-3.5 w-3.5" /> Open in UPI app
        </a>
      )}

      {req.status !== "paid" && (
        <div className="flex flex-wrap justify-center gap-2">
          {onNewQr && (req.status !== "active" || expired) && (
            <Button size="sm" variant="outline" onClick={onNewQr} disabled={busy}>
              <RefreshCw /> New QR
            </Button>
          )}
          {LIVE.includes(req.status) && !expired && (
            <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
              Cancel QR
            </Button>
          )}
        </div>
      )}

      {allowSimulate && LIVE.includes(req.status) && !expired && (
        <div className="w-full rounded-lg border border-dashed p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" /> Test mode — simulate the customer's UPI app
          </p>
          <Input value={payerVpa} onChange={(e) => setPayerVpa(e.target.value)} placeholder="Payer UPI ID" className="mb-2 h-8 text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="success" disabled={busy} onClick={() => simulate("success")}>
              Pays {formatINR(left)}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("success", { amount: Math.max(1, Math.round(left * 0.5)) })}>
              Pays less
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("failed")}>
              Payment fails
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => simulate("success", { deliver_webhook: false })}>
              Webhook lost
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
