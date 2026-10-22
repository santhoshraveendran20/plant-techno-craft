import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCheck, ScanBarcode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { playError } from "@/lib/sound";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResponsiveTable } from "@/components/data-table";
import { BarcodeScannerDialog } from "@/components/BarcodeScanner";
import { ConfirmDialog, ErrorAlert, Loading, ProductSearch, StatCard } from "@/components/common";

export default function StockCountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const { data: count, setData, loading, error } = useFetch(`/api/stock/counts/${id}`);
  const products = useFetch("/api/products");
  const [scan, setScan] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);

  const post = async (body) => {
    try {
      const r = await api.post(`/api/stock/counts/${id}/items`, body);
      setData(r.data);
    } catch (e) {
      playError();
      toast.error(e.response?.status === 404 ? `Unknown barcode ${body.barcode || ""}` : errorMessage(e));
    }
  };

  const action = async (path, message) => {
    try {
      const r = await api.post(`/api/stock/counts/${id}/${path}`);
      setData(r.data);
      toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (itemId) => {
    try {
      const r = await api.delete(`/api/stock/counts/${id}/items/${itemId}`);
      setData(r.data);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (loading && !count) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  if (!count) return null;
  const editable = count.status === "open";

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-1" onClick={() => navigate("/stock/counts")}>
            <ArrowLeft /> All counts
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Stock count #{count.id}</h1>
            <Badge variant={count.status === "open" ? "info" : count.status === "posted" ? "success" : "secondary"}>{count.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Started {formatDateTime(count.created_at)}
            {count.posted_at && ` · posted ${formatDateTime(count.posted_at)}`}
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <ConfirmDialog
              trigger={<Button variant="outline">Cancel count</Button>}
              title="Cancel this count?"
              description="Nothing is posted to stock."
              confirmLabel="Cancel count"
              variant="destructive"
              onConfirm={() => action("cancel", "Count cancelled")}
            />
            {isOwner && (
              <ConfirmDialog
                trigger={
                  <Button disabled={!count.items.length}>
                    <CheckCheck /> Post differences
                  </Button>
                }
                title="Post the differences to stock?"
                description={`${count.mismatches} products differ from the system count. Each difference is recorded as a 'count' stock movement.`}
                confirmLabel="Post to stock"
                onConfirm={() => action("post", "Stock updated from the physical count")}
              />
            )}
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Items counted" value={count.items.length} />
        <StatCard label="Mismatches" value={count.mismatches} tone={count.mismatches ? "warn" : "good"} />
        <StatCard label="Accuracy" value={count.accuracy_pct !== null ? `${count.accuracy_pct}%` : "—"} hint="Target 98% or better" tone={count.accuracy_pct >= 98 ? "good" : "warn"} />
      </div>

      {editable && (
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row">
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (scan.trim()) post({ barcode: scan.trim(), increment: 1 });
                setScan("");
              }}
            >
              <div className="relative flex-1">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan each item (+1 per scan)" className="pl-9 font-mono" autoFocus />
              </div>
              <Button type="button" variant="outline" onClick={() => setCameraOpen(true)}>
                <Camera /> Camera
              </Button>
            </form>
            <ProductSearch products={products.data || []} onPick={(p) => post({ product_id: p.id, increment: 1 })} className="flex-1" placeholder="Add item without barcode" />
          </CardContent>
        </Card>
      )}

      <Card>
        <ResponsiveTable
          rows={count.items}
          empty={<p className="py-10 text-center text-sm text-muted-foreground">Scan items on the shelf to start counting</p>}
          columns={[
            {
              key: "product", header: "Product", primary: true,
              cell: (i) => (
                <>
                  <span className="font-medium">{i.product_name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{i.barcode || "no barcode"}</span>
                </>
              ),
            },
            { key: "system", header: "System", align: "right", className: "tabular", cell: (i) => formatNumber(i.system_qty) },
            {
              key: "counted", header: "Counted", align: "right", className: "w-32",
              cell: (i) =>
                editable ? (
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={i.counted_qty}
                    key={`${i.id}-${i.counted_qty}`}
                    onBlur={(e) => Number(e.target.value) !== i.counted_qty && post({ product_id: i.product_id, counted_qty: Number(e.target.value || 0) })}
                    className="h-8 w-24 text-right md:ml-auto"
                    aria-label={`Counted quantity of ${i.product_name}`}
                  />
                ) : (
                  <span className="tabular">{formatNumber(i.counted_qty)}</span>
                ),
            },
            {
              key: "difference", header: "Difference", align: "right", aside: true,
              cell: (i) => (
                <span className={`tabular font-semibold ${i.difference < 0 ? "text-red-700" : i.difference > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                  {i.difference > 0 ? "+" : ""}
                  {formatNumber(i.difference)}
                </span>
              ),
            },
            ...(editable
              ? [
                  {
                    key: "actions", header: "Remove", actions: true, align: "right",
                    cell: (i) => (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(i.id)} aria-label={`Remove ${i.product_name}`}>
                        <Trash2 />
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <BarcodeScannerDialog open={cameraOpen} onOpenChange={setCameraOpen} continuous title="Count items" onDetected={(code) => post({ barcode: code, increment: 1 })} />
    </div>
  );
}
