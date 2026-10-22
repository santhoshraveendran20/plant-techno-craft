import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFetch } from "@/hooks/useFetch";
import { daysAgoISO, formatDate, formatINR, formatNumber, todayISO } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, COLORS, ChartEmpty, DonutWithLegend, GroupedBarChart, barsHeight, countTick,
} from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { ErrorAlert, Loading, PageHeader, StatCard } from "@/components/common";
import { ExportButtons } from "@/pages/BillsPage";
import { StockBadge } from "@/pages/ProductsPage";

const CLASS = {
  fast: { label: "Fast", variant: "success", color: COLORS.series1 },
  slow: { label: "Slow", variant: "warning", color: COLORS.series3 },
  dead: { label: "Dead (no sale 60d)", variant: "destructive", color: COLORS.series4 },
  no_stock: { label: "No stock / no sales", variant: "secondary", color: COLORS.series2 },
};

function ChartCard({ title, description, children, className }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StockTab() {
  const { data, loading, error } = useFetch("/api/reports/stock");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert message={error} />;

  const byCategory = {};
  for (const r of data.rows) {
    const key = r.category || "Uncategorised";
    byCategory[key] = byCategory[key] || { cost: 0, sell: 0 };
    byCategory[key].cost += r.cost_value;
    byCategory[key].sell += r.selling_value;
  }
  const cats = Object.entries(byCategory).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Stock value at cost" value={formatINR(data.totals.cost_value)} />
        <StatCard label="Value at selling price" value={formatINR(data.totals.selling_value)} />
        <StatCard label="Potential margin" value={formatINR(data.totals.potential_margin)} tone="good" />
        <StatCard label="Low / out of stock" value={`${data.totals.low} / ${data.totals.out}`} tone={data.totals.out ? "bad" : "default"} />
      </div>
      <ChartCard title="Stock value by category" description="What the shelf is worth at cost and at selling price" className="mb-4">
        {cats.length ? (
          <GroupedBarChart
            horizontal
            height={barsHeight(cats.length, 40)}
            labels={cats.map(([c]) => c)}
            series={[
              { label: "At cost", data: cats.map(([, v]) => Math.round(v.cost)) },
              { label: "At selling price", data: cats.map(([, v]) => Math.round(v.sell)) },
            ]}
          />
        ) : (
          <ChartEmpty>No stock</ChartEmpty>
        )}
      </ChartCard>
      <Card>
        <div className="flex justify-end gap-2 border-b p-3">
          <ExportButtons kind="stock" params={{}} />
        </div>
        <ResponsiveTable
          rows={data.rows}
          footer={{
            product: "Total",
            cost_value: <span className="tabular">{formatINR(data.totals.cost_value)}</span>,
            selling_value: <span className="tabular">{formatINR(data.totals.selling_value)}</span>,
          }}
          columns={[
            {
              key: "product", header: "Product", primary: true,
              cell: (r) => (
                <>
                  <Link to={`/products/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  <span className="block text-xs text-muted-foreground">{r.category || "—"}</span>
                </>
              ),
            },
            { key: "stock", header: "Stock", align: "right", className: "tabular", cell: (r) => `${formatNumber(r.stock_qty)} ${r.unit}` },
            { key: "cost", header: "Cost", align: "right", hide: "xl", className: "tabular", cell: (r) => formatINR(r.cost_price) },
            { key: "price", header: "Price", align: "right", hide: "xl", className: "tabular", cell: (r) => formatINR(r.selling_price) },
            { key: "cost_value", header: "Value (cost)", align: "right", className: "tabular", cell: (r) => formatINR(r.cost_value) },
            { key: "selling_value", header: "Value (selling)", align: "right", className: "tabular", cell: (r) => formatINR(r.selling_value) },
            { key: "status", header: "Status", aside: true, cell: (r) => <StockBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}

function SalesTab() {
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const { data, loading, error } = useFetch("/api/reports/sales-by-product", { date_from: from, date_to: to });
  const top = (data?.rows || []).slice(0, 10);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-[150px]" aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-[150px]" aria-label="To date" />
        </div>
        <div className="flex gap-2">
          <ExportButtons kind="sales" params={{ date_from: from, date_to: to }} />
        </div>
      </div>
      <ErrorAlert message={error} className="mb-3" />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Revenue" value={formatINR(data.totals.revenue)} />
              <StatCard label="Cost of goods" value={formatINR(data.totals.cost)} />
              <StatCard label="Gross margin" value={formatINR(data.totals.margin)} tone="good" />
              <StatCard label="Margin %" value={`${data.totals.margin_pct}%`} />
            </div>
            <ChartCard title="Revenue and gross margin" description="Top 10 products by revenue in this period" className="mb-4">
              {top.length ? (
                <GroupedBarChart
                  horizontal
                  height={barsHeight(top.length, 40)}
                  labels={top.map((r) => r.name)}
                  series={[
                    { label: "Revenue", data: top.map((r) => r.revenue) },
                    { label: "Gross margin", data: top.map((r) => r.margin) },
                  ]}
                />
              ) : (
                <ChartEmpty>No sales in this period</ChartEmpty>
              )}
            </ChartCard>
            <Card>
              <ResponsiveTable
                rows={data.rows}
                rowKey={(r) => r.product_id}
                footer={{
                  name: "Total",
                  revenue: <span className="tabular">{formatINR(data.totals.revenue)}</span>,
                  margin: <span className="tabular">{formatINR(data.totals.margin)}</span>,
                  margin_pct: `${data.totals.margin_pct}%`,
                }}
                columns={[
                  { key: "name", header: "Product", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
                  { key: "qty", header: "Qty sold", align: "right", className: "tabular", cell: (r) => formatNumber(r.qty) },
                  { key: "revenue", header: "Revenue", align: "right", aside: true, cell: (r) => <span className="tabular">{formatINR(r.revenue)}</span> },
                  { key: "cost", header: "Cost", align: "right", hide: "xl", className: "tabular text-muted-foreground", cell: (r) => formatINR(r.cost) },
                  { key: "margin", header: "Gross margin", align: "right", className: "tabular font-medium", cell: (r) => formatINR(r.margin) },
                  { key: "margin_pct", header: "Margin %", align: "right", className: "tabular", cell: (r) => `${r.margin_pct}%` },
                ]}
              />
            </Card>
          </>
        )
      )}
    </>
  );
}

function ClassTab() {
  const { data, loading, error } = useFetch("/api/reports/movement-class");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  const keys = Object.keys(CLASS);
  const value = (k) => data.rows.filter((r) => r.class === k).reduce((s, r) => s + r.stock_value, 0);
  return (
    <>
      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <ChartCard title="Products by movement" description="Fast = top 20% by quantity sold in 30 days">
          <DonutWithLegend
            wide
            height={180}
            formatValue={(v) => `${formatNumber(v)} products`}
            centerLabel="Products"
            centerValue={data.rows.length}
            items={keys.map((k) => ({ label: CLASS[k].label, value: data.counts[k] || 0, color: CLASS[k].color }))}
          />
        </ChartCard>
        <ChartCard title="Money tied up in stock" description="Stock value at cost for each movement class">
          <BarChart
            height={200}
            label="Stock value"
            labels={keys.map((k) => CLASS[k].label)}
            data={keys.map(value)}
            colors={keys.map((k) => CLASS[k].color)}
          />
        </ChartCard>
      </div>
      <Card>
        <ResponsiveTable
          rows={data.rows}
          columns={[
            { key: "name", header: "Product", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
            { key: "qty", header: "Sold (30 days)", align: "right", className: "tabular", cell: (r) => formatNumber(r.qty_30d) },
            {
              key: "last", header: "Last sale", className: "text-muted-foreground",
              cell: (r) => (r.last_sale ? `${formatDate(r.last_sale)} (${r.days_since_sale}d)` : "Never"),
            },
            { key: "stock", header: "Stock", align: "right", hide: "xl", className: "tabular", cell: (r) => formatNumber(r.stock_qty) },
            { key: "value", header: "Stock value", align: "right", className: "tabular", cell: (r) => formatINR(r.stock_value) },
            { key: "class", header: "Class", aside: true, cell: (r) => <Badge variant={CLASS[r.class]?.variant}>{CLASS[r.class]?.label}</Badge> },
          ]}
        />
      </Card>
    </>
  );
}

function ReorderTab() {
  const { data, loading, error } = useFetch("/api/reports/reorder");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  const urgent = data.filter((r) => r.days_left !== null).slice(0, 12);
  return (
    <>
      <ChartCard title="Days of stock left" description="At the last 30 days' selling rate — lowest first" className="mb-4">
        {urgent.length ? (
          <BarChart
            horizontal
            height={barsHeight(urgent.length, 26)}
            label="Days left"
            labels={urgent.map((r) => r.name)}
            data={urgent.map((r) => r.days_left)}
            color={COLORS.series2}
            valueFormatter={countTick}
            tooltipFormatter={(v, i) => `${v} days · order ${urgent[i].suggested_qty} ${urgent[i].unit}`}
          />
        ) : (
          <ChartEmpty height={160}>No product is running out at the current selling rate</ChartEmpty>
        )}
      </ChartCard>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Suggested reorder</CardTitle>
          <CardDescription>Enough to cover the reorder window plus the reorder level, from the last 30 days' average daily sales.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <ResponsiveTable
            rows={data}
            inset
            empty={<p className="py-8 text-center text-sm text-muted-foreground">Nothing needs reordering</p>}
            columns={[
              { key: "name", header: "Product", primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: "stock", header: "Stock", align: "right", className: "tabular", cell: (r) => `${formatNumber(r.stock_qty)} ${r.unit}` },
              { key: "reorder", header: "Reorder level", align: "right", hide: "xl", className: "tabular", cell: (r) => formatNumber(r.reorder_level) },
              { key: "avg", header: "Avg / day", align: "right", className: "tabular", cell: (r) => r.avg_daily_sales },
              { key: "days", header: "Days left", align: "right", className: "tabular", cell: (r) => (r.days_left === null ? "—" : r.days_left) },
              { key: "qty", header: "Order qty", align: "right", aside: true, cell: (r) => <span className="tabular font-semibold">{r.suggested_qty}</span> },
              { key: "cost", header: "Est. cost", align: "right", className: "tabular", cell: (r) => formatINR(r.suggested_qty * r.cost_price) },
            ]}
          />
        </CardContent>
      </Card>
    </>
  );
}

function ExpiryTab() {
  const { data, loading, error } = useFetch("/api/reports/expiry");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  return (
    <Card>
      <ResponsiveTable
        rows={data}
        rowKey={(r, i) => `${r.product_id}-${r.batch_no}-${i}`}
        empty={<p className="py-8 text-center text-sm text-muted-foreground">No batches expiring soon</p>}
        columns={[
          { key: "name", header: "Product", primary: true, cell: (r) => <Link to={`/products/${r.product_id}`} className="font-medium hover:underline">{r.name}</Link> },
          { key: "batch", header: "Batch", cell: (r) => <span className="font-mono text-xs">{r.batch_no || "—"}</span> },
          { key: "expiry", header: "Expiry", cell: (r) => formatDate(r.expiry_date) },
          { key: "batch_qty", header: "Batch qty", align: "right", hide: "xl", className: "tabular", cell: (r) => formatNumber(r.batch_qty) },
          { key: "stock", header: "In stock", align: "right", className: "tabular", cell: (r) => formatNumber(r.stock_qty) },
          {
            key: "status", header: "Status", aside: true,
            cell: (r) => (
              <Badge variant={r.status === "expired" ? "destructive" : "warning"}>
                {r.status === "expired" ? `Expired ${-r.days_to_expiry}d ago` : `In ${r.days_to_expiry} days`}
              </Badge>
            ),
          },
        ]}
      />
    </Card>
  );
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "stock";
  return (
    <div>
      <PageHeader title="Reports" description="Stock value, sales and margin per product, fast / slow / dead stock, reorder and expiry." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="stock">Stock value</TabsTrigger>
          <TabsTrigger value="sales">Sales & margin</TabsTrigger>
          <TabsTrigger value="class">Fast / slow</TabsTrigger>
          <TabsTrigger value="reorder">Reorder</TabsTrigger>
          <TabsTrigger value="expiry">Expiry</TabsTrigger>
        </TabsList>
        <TabsContent value="stock"><StockTab /></TabsContent>
        <TabsContent value="sales"><SalesTab /></TabsContent>
        <TabsContent value="class"><ClassTab /></TabsContent>
        <TabsContent value="reorder"><ReorderTab /></TabsContent>
        <TabsContent value="expiry"><ExpiryTab /></TabsContent>
      </Tabs>
    </div>
  );
}
