import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Banknote, HandCoins, IndianRupee, PackageX, ReceiptText, RefreshCw, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { useFetch } from "@/hooks/useFetch";
import { cn, formatDate, formatINR, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, COLORS, DonutWithLegend, SEQUENTIAL, TrendChart } from "@/components/charts";
import { EmptyState, ErrorAlert, PageHeader, StatCard } from "@/components/common";

function Change({ pct, suffix = "vs yesterday" }) {
  if (pct === null || pct === undefined) return <span className="text-muted-foreground">No sales to compare {suffix.replace("vs ", "with ")}</span>;
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1", up ? "text-emerald-600" : "text-red-600")}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? "+" : ""}
      {pct}% {suffix}
    </span>
  );
}

function modeItems(split) {
  return [
    { label: "UPI", value: split?.upi || 0, color: COLORS.series1 },
    { label: "Cash", value: split?.cash || 0, color: COLORS.series2 },
    { label: "Credit", value: split?.credit || 0, color: COLORS.series3 },
  ];
}

export default function DashboardPage() {
  const [granularity, setGranularity] = useState("day");
  const [days, setDays] = useState("30");
  const [modeTab, setModeTab] = useState("today");
  const summary = useFetch("/api/dashboard/summary");
  const trend = useFetch("/api/dashboard/trend", { granularity });
  const insights = useFetch("/api/dashboard/insights", { days: Number(days) });

  const s = summary.data;
  const t = trend.data;
  const ins = insights.data;
  const refresh = () => {
    summary.reload();
    trend.reload();
    insights.reload();
  };

  const hours = ins?.peak_hours;
  const hourIdx = hours ? hours.labels.map((_, i) => i).filter((i) => i >= 7 && i <= 22) : [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Sales, collections and dues · ${formatDate(new Date(), { weekday: "long" })}`}
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <ErrorAlert message={summary.error || trend.error || insights.error} className="mb-4" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 xl:grid-cols-5">
        {!s ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={i === 0 ? "col-span-2 h-[110px] rounded-xl sm:col-span-3 xl:col-span-1" : i === 1 ? "h-[110px] rounded-xl sm:col-span-3 xl:col-span-1" : "h-[110px] rounded-xl sm:col-span-2 xl:col-span-1"} />)
        ) : (
          <>
            <StatCard label="Today's sales" icon={IndianRupee} value={formatINR(s.sales)} hint={<Change pct={s.sales_change_pct} />} className="col-span-2 sm:col-span-3 xl:col-span-1" />
            <StatCard
              label="Collected today"
              icon={Banknote}
              className="sm:col-span-3 xl:col-span-1"
              value={formatINR(s.collected)}
              hint={`UPI ${formatINR(s.collected_upi, { compact: true })} · Cash ${formatINR(s.collected_cash, { compact: true })}`}
            />
            <StatCard label="Credit given today" icon={HandCoins} value={formatINR(s.credit_given_today)} hint={`${s.bill_count} bills today`} tone="warn" className="sm:col-span-2 xl:col-span-1" />
            <StatCard
              label="Outstanding dues"
              icon={Users}
              className="sm:col-span-2 xl:col-span-1"
              value={formatINR(s.outstanding_due)}
              hint={`${s.customers_with_due} customers owe money`}
              tone={s.outstanding_due > 0 ? "bad" : "good"}
            />
            <StatCard label="Average bill" icon={ReceiptText} value={formatINR(s.avg_bill_value)} hint={s.pending_upi ? `${s.pending_upi} QR awaiting payment` : "No QR waiting"} className="sm:col-span-2 xl:col-span-1" />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Sales trend</CardTitle>
              <CardDescription className="mt-1.5">
                {t ? (
                  <>
                    <span className="tabular font-medium text-foreground">{formatINR(t.totals.current)}</span> this period ·{" "}
                    <Change pct={t.totals.change_pct} suffix="vs previous period" />
                  </>
                ) : (
                  "Loading…"
                )}
              </CardDescription>
            </div>
            <Tabs value={granularity} onValueChange={setGranularity}>
              <TabsList>
                <TabsTrigger value="day">Daily</TabsTrigger>
                <TabsTrigger value="week">Weekly</TabsTrigger>
                <TabsTrigger value="month">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {t ? <TrendChart labels={t.labels} current={t.current} previous={t.previous} previousLabels={t.previous_labels} /> : <Skeleton className="h-[280px]" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Sales by payment mode</CardTitle>
              <CardDescription className="mt-1.5">How bills were settled</CardDescription>
            </div>
            <Tabs value={modeTab} onValueChange={setModeTab}>
              <TabsList>
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="period">{days}d</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {modeTab === "today" && s && (
              <DonutWithLegend wide className="xl:flex-col xl:gap-5" items={modeItems(s.sales_by_mode)} centerLabel="Today" centerValue={formatINR(s.sales, { compact: true })} />
            )}
            {modeTab === "period" && ins && (
              <DonutWithLegend wide className="xl:flex-col xl:gap-5" items={modeItems(ins.sales_by_mode)} centerLabel={`${days} days`} centerValue={formatINR(ins.sales, { compact: true })} />
            )}
            {((modeTab === "today" && !s) || (modeTab === "period" && !ins)) && <Skeleton className="h-[200px]" />}
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Insights</h2>
          <p className="text-sm text-muted-foreground">
            {ins ? `${formatINR(ins.sales)} from ${formatNumber(ins.bill_count)} bills · average bill ${formatINR(ins.avg_bill_value)}` : "Loading…"}
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <CardDescription>By sales value</CardDescription>
          </CardHeader>
          <CardContent>
            {ins ? (
              ins.top_products.length ? (
                <BarChart
                  horizontal
                  height={300}
                  label="Sales"
                  labels={ins.top_products.map((p) => p.name)}
                  data={ins.top_products.map((p) => p.revenue)}
                />
              ) : (
                <EmptyState title="No sales in this period" />
              )
            ) : (
              <Skeleton className="h-[300px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top customers</CardTitle>
            <CardDescription>Regulars by amount spent</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {ins ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Customer</TableHead>
                    <TableHead className="text-right">Bills</TableHead>
                    <TableHead className="pr-5 text-right">Spent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ins.top_customers.map((c) => (
                    <TableRow key={c.customer_id}>
                      <TableCell className="pl-5">
                        <Link to={`/customers/${c.customer_id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{c.mobile}</span>
                      </TableCell>
                      <TableCell className="tabular text-right">{c.bills}</TableCell>
                      <TableCell className="tabular pr-5 text-right font-medium">{formatINR(c.spent)}</TableCell>
                    </TableRow>
                  ))}
                  {!ins.top_customers.length && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        No customer bills in this period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            ) : (
              <Skeleton className="mx-5 h-[300px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Peak hours</CardTitle>
            <CardDescription>Number of bills by hour of day</CardDescription>
          </CardHeader>
          <CardContent>
            {hours ? (
              <BarChart
                height={240}
                label="Bills"
                labels={hourIdx.map((i) => hours.labels[i])}
                data={hourIdx.map((i) => hours.bills[i])}
                valueFormatter={(v) => v}
                tooltipFormatter={(v, i) => `${v} · ${formatINR(hours.sales[hourIdx[i]])} sales`}
              />
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Dues ageing</CardTitle>
              <CardDescription className="mt-1.5">Unpaid bill amounts by age</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/dues">Collect dues</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {ins ? (
              <>
                <BarChart
                  height={190}
                  label="Due"
                  labels={ins.dues_ageing.labels.map((l) => `${l} days`)}
                  data={ins.dues_ageing.amounts}
                  colors={SEQUENTIAL}
                />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {ins.dues_ageing.labels.map((l, i) => (
                    <div key={l} className="rounded-md bg-muted/60 px-2 py-1.5">
                      <p className="text-muted-foreground">{l} days</p>
                      <p className="tabular text-sm font-semibold">{formatINR(ins.dues_ageing.amounts[i])}</p>
                      <p className="text-muted-foreground">{ins.dues_ageing.counts[i]} bills</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PackageX className="h-4 w-4 text-red-600" /> Low & out of stock
              </CardTitle>
              <CardDescription className="mt-1.5">At or below the reorder level</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/reports?tab=reorder">Reorder list</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {ins && (
              <Table>
                <TableBody>
                  {ins.low_stock.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-5">
                        <Link to={`/products/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {p.stock_qty} / {p.reorder_level} {p.unit}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Badge variant={p.status === "out" ? "destructive" : "warning"}>
                          <AlertTriangle className="h-3 w-3" /> {p.status === "out" ? "Out of stock" : "Low"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!ins.low_stock.length && (
                    <TableRow>
                      <TableCell className="py-8 text-center text-muted-foreground">Stock levels are healthy</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Slow-moving stock</CardTitle>
            <CardDescription>In stock but not sold in 30+ days</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {ins && (
              <Table>
                <TableBody>
                  {ins.slow_moving.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-5 font-medium">{p.name}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {p.days_since_sale === null ? "Never sold" : `${p.days_since_sale} days since sale`}
                      </TableCell>
                      <TableCell className="tabular pr-5 text-right">{formatINR(p.stock_value)}</TableCell>
                    </TableRow>
                  ))}
                  {!ins.slow_moving.length && (
                    <TableRow>
                      <TableCell className="py-8 text-center text-muted-foreground">Everything in stock sold in the last 30 days</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
