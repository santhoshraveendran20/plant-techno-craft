import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import { Printer } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert, Loading } from "@/components/common";

function BarcodeSvg({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    const isEan = /^\d{13}$/.test(value);
    try {
      JsBarcode(ref.current, value, { format: isEan ? "EAN13" : "CODE128", height: 38, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
    } catch {
      JsBarcode(ref.current, value, { format: "CODE128", height: 38, width: 1.4, fontSize: 11, margin: 0 });
    }
  }, [value]);
  return <svg ref={ref} className="max-w-full" />;
}

/** FR-03: printable barcode labels (A4 sheet, 3 columns). */
export default function LabelsPage() {
  const [params] = useSearchParams();
  const { settings } = useAuth();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const [copies, setCopies] = useState(Number(params.get("copies") || 1));
  const ids = (params.get("ids") || "").split(",").map(Number).filter(Boolean);

  useEffect(() => {
    if (!ids.length) {
      setProducts([]);
      return;
    }
    Promise.all(ids.map((id) => api.get(`/api/products/${id}`).then((r) => r.data)))
      .then(setProducts)
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  if (error) return <ErrorAlert message={error} className="m-6" />;
  if (!products) return <Loading />;
  const withCode = products.filter((p) => p.barcode);
  const missing = products.filter((p) => !p.barcode);
  const labels = withCode.flatMap((p) => Array.from({ length: Math.max(1, Math.min(copies, 100)) }, (_, i) => ({ ...p, key: `${p.id}-${i}` })));

  return (
    <div className="min-h-screen bg-muted/40 p-4 print:bg-white print:p-0">
      <style>{"@media print { @page { size: A4; margin: 8mm; } }"}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Barcode labels</h1>
          <p className="text-sm text-muted-foreground">{labels.length} labels for {withCode.length} products</p>
          {missing.length > 0 && <p className="text-sm text-amber-700">Skipped (no barcode): {missing.map((p) => p.name).join(", ")}</p>}
        </div>
        <div className="flex items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="copies">Copies each</Label>
            <Input id="copies" type="number" min="1" max="100" value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} className="w-24" />
          </div>
          <Button onClick={() => window.print()} disabled={!labels.length}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      <div className="mx-auto grid max-w-[210mm] grid-cols-2 gap-2 bg-white p-2 sm:grid-cols-3 print:max-w-none print:grid-cols-3 print:p-0">
        {labels.map((p) => (
          <div key={p.key} className="flex flex-col items-center justify-center rounded border border-dashed p-2 text-center" style={{ breakInside: "avoid" }}>
            <p className="w-full truncate text-[10px] text-zinc-500">{settings?.shop_name}</p>
            <p className="w-full truncate text-xs font-semibold">{p.name}</p>
            <BarcodeSvg value={p.barcode} />
            <p className="text-sm font-bold">{formatINR(p.selling_price)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
