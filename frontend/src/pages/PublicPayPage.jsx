import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Clock, FlaskConical, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorAlert } from "@/components/common";
import { UpiQr, formatCountdown } from "@/components/UpiQrPanel";
import { BRAND, BrandMark } from "@/components/brand";

/** Public UPI payment link page for remote due payment (FR-14). No login needed. */
export default function PublicPayPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/public/pay/${token}`);
      setData(r.data);
      setLeft(r.data.seconds_left);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "This payment link is not valid"));
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data || !["active", "partially_paid", "failed"].includes(data.status)) return undefined;
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [data, load]);

  const simulate = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/public/pay/${token}/simulate`, { outcome: "success", payer_vpa: "customer@okaxis", payer_name: "UPI Customer" });
      setData(r.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const due = data ? Math.max(0, data.amount - data.received_amount) : 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-paper p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <BrandMark className="h-14 w-14" />
            <p className="font-semibold text-brand-deep">{data?.shop_name || BRAND.name}</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-leaf">{data?.shop_tagline ?? BRAND.tagline}</p>
          </div>
          <ErrorAlert message={error} className="text-left" />
          {!data && !error && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
          {data && data.status === "paid" && (
            <>
              <CheckCircle2 className="h-20 w-20 animate-pop-in text-emerald-600" />
              <p className="text-xl font-semibold">Payment received</p>
              <p className="text-muted-foreground">
                {formatINR(data.received_amount)} paid to {data.shop_name}. Thank you{data.customer_name ? `, ${data.customer_name}` : ""}!
              </p>
            </>
          )}
          {data && ["expired", "cancelled"].includes(data.status) && (
            <p className="py-6 text-muted-foreground">This payment link has {data.status === "expired" ? "expired" : "been cancelled"}. Please ask the shop for a new one.</p>
          )}
          {data && ["active", "partially_paid", "failed"].includes(data.status) && (
            <>
              <div>
                <p className="text-sm text-muted-foreground">
                  {data.customer_name ? `Hi ${data.customer_name}, ` : ""}
                  {data.bill_no ? `bill ${data.bill_no}` : "your pending amount"}
                </p>
                <p className="tabular text-4xl font-semibold tracking-tight">{formatINR(due)}</p>
              </div>
              <UpiQr request={data} size={220} />
              {data.payload && (
                <Button asChild size="lg" className="w-full">
                  <a href={data.payload}>
                    <Smartphone /> Pay with a UPI app
                  </a>
                </Button>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Link valid for {left > 86400 ? `${Math.floor(left / 86400)} days` : formatCountdown(left)}
              </p>
              {data.status === "failed" && <p className="text-sm text-red-700">The last attempt failed. Please try again.</p>}
              {data.gateway_is_mock && (
                <Button variant="outline" size="sm" onClick={simulate} disabled={busy}>
                  <FlaskConical /> Test mode: simulate payment
                </Button>
              )}
            </>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Paid through a licensed payment gateway
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
