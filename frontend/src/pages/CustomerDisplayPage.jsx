import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Volume2 } from "lucide-react";
import { api } from "@/lib/api";
import { playBeep, playSuccess } from "@/lib/sound";
import { formatINR } from "@/lib/utils";
import { UpiQr, formatCountdown } from "@/components/UpiQrPanel";
import { BRAND, BrandMark } from "@/components/brand";

/** Second screen facing the customer (FR-10): shows the live QR and a big confirmation when paid. */
export default function CustomerDisplayPage() {
  const [state, setState] = useState({ shop_name: "", request: null });
  const [left, setLeft] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const lastPaid = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.get("/api/upi/active");
        if (!alive) return;
        setState(r.data);
        if (r.data.request) setLeft(r.data.request.seconds_left);
        if (r.data.request?.status === "paid" && lastPaid.current !== r.data.request.id) {
          lastPaid.current = r.data.request.id;
          playSuccess();
        }
      } catch {
        /* keep showing the last state */
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const req = state.request;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-brand-deep p-6 text-white">
      {!soundOn && (
        <button
          type="button"
          onClick={() => {
            setSoundOn(true);
            playBeep();
          }}
          className="fixed right-4 top-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/90 hover:bg-white/20"
        >
          <Volume2 className="h-4 w-4" /> Tap to enable sound
        </button>
      )}
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="rounded-2xl bg-brand-paper p-2 shadow-lg">
          <BrandMark className="h-16 w-16" />
        </span>
        <div>
          <p className="text-2xl font-semibold">{state.shop_name || BRAND.name}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-brand-gold">{state.shop_tagline ?? BRAND.tagline}</p>
        </div>
      </div>
      {!req && (
        <div className="text-center text-white/70">
          <p className="text-3xl font-medium text-white">Welcome!</p>
          <p className="mt-2">Your payment QR will appear here.</p>
        </div>
      )}
      {req && req.status === "paid" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-32 w-32 animate-pop-in text-lime-400" />
          <p className="text-4xl font-semibold">Payment received</p>
          <p className="tabular text-2xl text-white/85">{formatINR(req.received_amount)}</p>
          <p className="text-white/70">Thank you{req.customer_name ? `, ${req.customer_name.split(" ")[0]}` : ""}!</p>
        </div>
      )}
      {req && req.status !== "paid" && (
        <div className="flex flex-col items-center gap-5 text-center">
          <p className="text-white/70">{req.bill_no ? `Bill ${req.bill_no}` : "Due payment"}</p>
          <p className="tabular text-6xl font-semibold tracking-tight">{formatINR(req.amount - req.received_amount)}</p>
          <UpiQr request={req} size={300} className="p-4" />
          <p className="text-lg">Scan with any UPI app — GPay, PhonePe, Paytm, BHIM</p>
          <p className="flex items-center gap-2 text-white/70">
            <Clock className="h-4 w-4" /> QR valid for <span className="tabular text-white">{formatCountdown(left)}</span>
          </p>
          {req.status === "failed" && <p className="rounded-md bg-red-500/20 px-4 py-2 text-red-200">Payment failed — please try again</p>}
          {req.status === "partially_paid" && (
            <p className="rounded-md bg-amber-500/20 px-4 py-2 text-amber-200">Received {formatINR(req.received_amount)} — please pay the balance</p>
          )}
        </div>
      )}
    </div>
  );
}
