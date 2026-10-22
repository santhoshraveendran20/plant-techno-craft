import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Printer, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, COLORS, LineChart, countTick } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { ErrorAlert, Loading, StatCard } from "@/components/common";
import { ProductFormDialog, StockBadge } from "@/pages/ProductsPage";

const TYPE_LABEL = {
  opening: "Opening stock", purchase: "Stock-in", sale: "Sale", return: "Sales return", adjustment: "Adjustment", count: "Stock count",
};

export function MovementLink({ m }) {
  if (m.ref_type === "bill") return <Link to={`/bills/${m.ref_id}`} className="hover:underline">{m.ref_label}</Link>;
  if (m.ref_type === "count") return <Link to={`/stock/counts/${m.ref_id}`} className="hover:underline">{m.ref_label}</Link>;
  return <span>{m.ref_label || "—"}</span>;
}

const weekStart = (iso) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
};

/** Stock level after each movement, and units sold per week (from the latest movements). */
function StockCharts({ movements, unit, reorderLevel }) {
  const chronological = movements.slice().reverse();
  const levelLabels = chronological.map((m) => formatDate(m.created_at, { year: undefined }));
  const thisWeek = weekStart(new Date().toISOString());
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - 7 * (7 - i));
    return d;
  });
  const sold = weeks.map(() => 0);
  for (const m of movements) {
    if (m.movement_type !== "sale") continue;
    const idx = weeks.findIndex((w) => w.getTime() === weekStart(m.created_at).getTime());
    if (idx >= 0) sold[idx] += m.qty_out;
  }
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock level</CardTitle>
          <CardDescription>Balance after each of the last {movements.length} movements · reorder level {formatNumber(reorderLevel)} {unit}</CardDescription>
        </CardHeader>
        <CardContent>
          <LineChart
            height={220}
            stepped
            fill
            labels={levelLabels}
            valueFormatter={countTick}
            tooltipFormatter={(v) => `${formatNumber(v)} ${unit}`}
            series={[
              { label: "In stock", data: chronological.map((m) => m.balance_after) },
              { label: "Reorder level", data: chronological.map(() => reorderLevel), color: COLORS.muted },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Units sold per week</CardTitle>
          <CardDescription>Last 8 weeks (week starting Monday)</CardDescription>
        </CardHeader>
        <CardContent>
          <BarChart
            height={220}
            label="Sold"
            labels={weeks.map((w) => formatDate(w, { year: undefined }))}
            data={sold}
            valueFormatter={countTick}
            tooltipFormatter={(v) => `${formatNumber(v)} ${unit}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const product = useFetch(`/api/products/${id}`);
  const moves = useFetch(`/api/products/${id}/movements`);
  const cats = useFetch(isOwner ? "/api/categories" : null);
  const [editing, setEditing] = useState(false);
  const p = product.data;

  if (product.loading && !p) return <Loading />;
  if (product.error) return <ErrorAlert message={product.error} />;
  if (!p) return null;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-1" onClick={() => navigate(-1)}>
            <ArrowLeft /> Back
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <StockBadge status={p.stock_status} />
            {!p.is_active && <Badge variant="secondary">Inactive</Badge>}
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{p.barcode || "No barcode"} · {p.category || "Uncategorised"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.barcode && (
            <Button variant="outline" asChild>
              <a href={`/labels?ids=${p.id}&copies=12`} target="_blank" rel="noreferrer">
                <Printer /> Print labels
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={`/stock/adjustments?product=${p.id}`}>
              <SlidersHorizontal /> Adjust stock
            </Link>
          </Button>
          {isOwner && (
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In stock" value={`${formatNumber(p.stock_qty)} ${p.unit}`} hint={`Reorder at ${formatNumber(p.reorder_level)}`} tone={p.stock_status === "ok" ? "good" : "bad"} />
        <StatCard label="Selling price" value={formatINR(p.selling_price)} />
        {isOwner && <StatCard label="Cost price" value={formatINR(p.cost_price)} hint={p.selling_price ? `Margin ${(((p.selling_price - p.cost_price) / p.selling_price) * 100).toFixed(1)}%` : undefined} />}
        {isOwner && <StatCard label="Stock value (cost)" value={formatINR(Math.max(0, p.stock_qty) * p.cost_price)} />}
      </div>

      {moves.data && moves.data.length > 0 && <StockCharts movements={moves.data} unit={p.unit} reorderLevel={p.reorder_level} />}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stock movement history</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ResponsiveTable
              rows={moves.data || []}
              inset
              empty={<p className="py-8 text-center text-sm text-muted-foreground">No stock movements yet</p>}
              columns={[
                { key: "date", header: "Date", className: "whitespace-nowrap text-muted-foreground", cell: (m) => formatDateTime(m.created_at) },
                {
                  key: "type", header: "Type", primary: true,
                  cell: (m) => (
                    <>
                      <span className="font-medium md:font-normal">{TYPE_LABEL[m.movement_type] || m.movement_type}</span>
                      {m.reason && <span className="block text-xs text-muted-foreground">{m.reason}</span>}
                    </>
                  ),
                },
                {
                  key: "change", header: "In / out", align: "right", aside: true,
                  cell: (m) =>
                    m.qty_in ? (
                      <span className="tabular font-semibold text-emerald-700">+{formatNumber(m.qty_in)}</span>
                    ) : (
                      <span className="tabular font-semibold text-red-700">−{formatNumber(m.qty_out)}</span>
                    ),
                },
                { key: "balance", header: "Balance", align: "right", className: "tabular font-medium", cell: (m) => formatNumber(m.balance_after) },
                {
                  key: "ref", header: "Reference", className: "text-sm",
                  cell: (m) => (
                    <>
                      <MovementLink m={m} />
                      {m.user && <span className="block text-xs text-muted-foreground">{m.user}</span>}
                    </>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Batches & expiry</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {p.batches.length === 0 && <p className="text-muted-foreground">{p.track_expiry ? "No batches with expiry recorded yet." : "Expiry tracking is off for this product."}</p>}
            {p.batches.map((b, i) => {
              const days = Math.round((new Date(`${b.expiry_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
              return (
                <div key={`${b.batch_no}-${i}`} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>
                    <span className="font-mono">{b.batch_no || "—"}</span>
                    <span className="block text-xs text-muted-foreground">Qty {formatNumber(b.qty)}</span>
                  </span>
                  <Badge variant={days < 0 ? "destructive" : days <= 30 ? "warning" : "secondary"}>
                    {days < 0 ? "Expired" : "Expires"} {formatDate(b.expiry_date)}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      {isOwner && (
        <ProductFormDialog
          open={editing}
          onOpenChange={setEditing}
          product={p}
          categories={cats.data || []}
          onSaved={() => {
            product.reload();
            moves.reload();
          }}
        />
      )}
    </div>
  );
}
