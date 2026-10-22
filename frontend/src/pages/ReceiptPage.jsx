import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { formatDateTime, formatINR, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorAlert, Loading } from "@/components/common";
import { BrandMark } from "@/components/brand";

/** 58 / 80 mm thermal receipt (FR-08). Opens the print dialog with ?print=1. */
export default function ReceiptPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { settings } = useAuth();
  const { data: bill, error } = useFetch(`/api/bills/${id}`);
  const width = settings?.receipt_width_mm === 58 ? 58 : 80;

  useEffect(() => {
    if (bill && settings && params.get("print") === "1") {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [bill, settings, params]);

  if (error) return <ErrorAlert message={error} className="m-6" />;
  if (!bill || !settings) return <Loading />;

  const upi = bill.payments.filter((p) => p.mode === "upi" && p.gateway_status === "success" && p.kind === "payment");
  const cash = bill.payments.filter((p) => p.mode === "cash" && p.kind === "payment");
  const sum = (rows) => rows.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: ${width}mm auto; margin: 3mm; } }`}</style>
      <div className="no-print mx-auto mb-4 flex justify-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
        <Button variant="outline" onClick={() => window.close()}>
          Close
        </Button>
      </div>
      <div
        className="mx-auto bg-white p-3 font-mono text-[11px] leading-snug text-black shadow print:p-0 print:shadow-none"
        style={{ width: `${width}mm` }}
      >
        <div className="text-center">
          <BrandMark className="mx-auto mb-1 h-12 w-12 grayscale" />
          <p className="text-[13px] font-bold">{settings.shop_name}</p>
          {settings.shop_tagline && <p className="text-[9px] uppercase tracking-widest">{settings.shop_tagline}</p>}
          {settings.shop_address && <p>{settings.shop_address}</p>}
          {settings.shop_phone && <p>Ph: {settings.shop_phone}</p>}
          {settings.shop_gstin && <p>GSTIN: {settings.shop_gstin}</p>}
        </div>
        <div className="my-2 border-t border-dashed border-black" />
        <p>Bill: {bill.bill_no}</p>
        <p>Date: {formatDateTime(bill.completed_at || bill.created_at)}</p>
        {bill.customer && <p>Customer: {bill.customer.name} ({bill.customer.mobile})</p>}
        <div className="my-2 border-t border-dashed border-black" />
        {bill.items.map((i) => (
          <div key={i.id} className="mb-1">
            <p>{i.product_name}</p>
            <div className="flex justify-between">
              <span>
                {formatNumber(i.qty)} x {i.unit_price.toFixed(2)}
              </span>
              <span>{i.line_total.toFixed(2)}</span>
            </div>
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{bill.subtotal.toFixed(2)}</span>
        </div>
        {bill.discount > 0 && (
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{bill.discount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-[13px] font-bold">
          <span>TOTAL</span>
          <span>{formatINR(bill.total)}</span>
        </div>
        {sum(upi) > 0 && (
          <div className="flex justify-between">
            <span>Paid UPI{upi[0]?.utr ? ` (UTR ${upi[0].utr})` : ""}</span>
            <span>{sum(upi).toFixed(2)}</span>
          </div>
        )}
        {sum(cash) > 0 && (
          <div className="flex justify-between">
            <span>Paid cash</span>
            <span>{sum(cash).toFixed(2)}</span>
          </div>
        )}
        {bill.due_amount > 0 && (
          <div className="flex justify-between font-bold">
            <span>Balance due</span>
            <span>{bill.due_amount.toFixed(2)}</span>
          </div>
        )}
        <div className="my-2 border-t border-dashed border-black" />
        <p className="text-center">{settings.receipt_footer}</p>
      </div>
    </div>
  );
}
