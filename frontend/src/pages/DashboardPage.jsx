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
import { BarChart, COLORS, DonutWithLegend, TrendChart } from "@/components/charts";
import { EmptyState, ErrorAlert, PageHeader, StatCard } from "@/components/common";
import { t, tx } from "@/i18n";

/** % change vs yesterday, or vs the previous period with `vsPrevious`. */
function Change({ pct, vsPrevious = false }) {
  if (pct === null || pct === undefined) {
    return <span className="text-muted-foreground">{vsPrevious ? t("No sales to compare with previous period") : t("No sales to compare with yesterday")}</span>;
  }
  const up = pct >= 0;
  const signed = `${up ? "+" : ""}${pct}%`;
  return (
    <span className={cn("inline-flex items-center gap-1", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {vsPrevious ? t("{pct} vs previous period", { pct: signed }) : t("{pct} vs yesterday", { pct: signed })}
    </span>
  );
}

function modeItems(split) {
  return [
    { label: t("UPI"), value: split?.upi || 0, color: COLORS.series1 },
    { label: t("Cash"), value: split?.cash || 0, color: COLORS.series2 },
    { label: t("Credit"), value: split?.credit || 0, color: COLORS.series3 },
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
  const tr = trend.data;
  const ins = insights.data;
  const refreshing = summary.loading || trend.loading || insights.loading;
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
        title={t("Dashboard")}
        description={t("Sales, collections and dues · {date}", { date: formatDate(new Date(), { weekday: "long" }) })}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} /> {refreshing ? t("Refreshing…") : t("Refresh")}
          </Button>
        }
      />
      <ErrorAlert message={summary.error || trend.error || insights.error} className="mb-4" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 xl:grid-cols-5">
        {!s ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className={i === 0 ? "col-span-2 h-[110px] rounded-xl sm:col-span-3 xl:col-span-1" : i === 1 ? "h-[110px] rounded-xl sm:col-span-3 xl:col-span-1" : "h-[110px] rounded-xl sm:col-span-2 xl:col-span-1"} />)
        ) : (
          <>
            <StatCard label={t("Today's sales")} icon={IndianRupee} value={formatINR(s.sales)} hint={<Change pct={s.sales_change_pct} />} className="col-span-2 sm:col-span-3 xl:col-span-1" />
            <StatCard
              label={t("Collected today")}
              icon={Banknote}
              className="sm:col-span-3 xl:col-span-1"
              value={formatINR(s.collected)}
              hint={t("UPI {upi} · Cash {cash}", { upi: formatINR(s.collected_upi, { compact: true }), cash: formatINR(s.collected_cash, { compact: true }) })}
            />
            <StatCard label={t("Credit given today")} icon={HandCoins} value={formatINR(s.credit_given_today)} hint={t("{n} bills today", { n: s.bill_count })} tone="warn" className="sm:col-span-2 xl:col-span-1" />
            <StatCard
              label={t("Outstanding dues")}
              icon={Users}
              className="sm:col-span-2 xl:col-span-1"
              value={formatINR(s.outstanding_due)}
              hint={t("{n} customers owe money", { n: s.customers_with_due })}
              tone={s.outstanding_due > 0 ? "bad" : "good"}
            />
            <StatCard label={t("Average bill")} icon={ReceiptText} value={formatINR(s.avg_bill_value)} hint={s.pending_upi ? t("{n} QR awaiting payment", { n: s.pending_upi }) : t("No QR waiting")} className="sm:col-span-2 xl:col-span-1" />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{t("Sales trend")}</CardTitle>
              <CardDescription className="mt-1.5">
                {tr ? (
                  <>
                    {tx("{amount} this period", { amount: <span className="tabular font-medium text-foreground">{formatINR(tr.totals.current)}</span> })} ·{" "}
                    <Change pct={tr.totals.change_pct} vsPrevious />
                  </>
                ) : (
                  t("Loading…")
                )}
              </CardDescription>
            </div>
            <Tabs value={granularity} onValueChange={setGranularity}>
              <TabsList>
                <TabsTrigger value="day">{t("Daily")}</TabsTrigger>
                <TabsTrigger value="week">{t("Weekly")}</TabsTrigger>
                <TabsTrigger value="month">{t("Monthly")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {tr ? <TrendChart labels={tr.labels} current={tr.current} previous={tr.previous} previousLabels={tr.previous_labels} /> : <Skeleton className="h-[280px]" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{t("Sales by payment mode")}</CardTitle>
              <CardDescription className="mt-1.5">{t("How bills were settled")}</CardDescription>
            </div>
            <Tabs value={modeTab} onValueChange={setModeTab}>
              <TabsList>
                <TabsTrigger value="today">{t("Today")}</TabsTrigger>
                <TabsTrigger value="period">{t("{n}d", { n: days })}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {modeTab === "today" && s && (
              <DonutWithLegend wide className="xl:flex-col xl:gap-5" items={modeItems(s.sales_by_mode)} centerLabel={t("Today")} centerValue={formatINR(s.sales, { compact: true })} />
            )}
            {modeTab === "period" && ins && (
              <DonutWithLegend wide className="xl:flex-col xl:gap-5" items={modeItems(ins.sales_by_mode)} centerLabel={t("{n} days", { n: days })} centerValue={formatINR(ins.sales, { compact: true })} />
            )}
            {((modeTab === "today" && !s) || (modeTab === "period" && !ins)) && <Skeleton className="h-[200px]" />}
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Insights")}</h2>
          <p className="text-sm text-muted-foreground">
            {ins
              ? t("{sales} from {n} bills · average bill {avg}", { sales: formatINR(ins.sales), n: formatNumber(ins.bill_count), avg: formatINR(ins.avg_bill_value) })
              : t("Loading…")}
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t("Last 7 days")}</SelectItem>
            <SelectItem value="30">{t("Last 30 days")}</SelectItem>
            <SelectItem value="90">{t("Last 90 days")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Top products")}</CardTitle>
            <CardDescription>{t("By sales value")}</CardDescription>
          </CardHeader>
          <CardContent>
            {ins ? (
              ins.top_products.length ? (
                <BarChart
                  horizontal
                  height={300}
                  label={t("Sales")}
                  labels={ins.top_products.map((p) => p.name)}
                  data={ins.top_products.map((p) => p.revenue)}
                />
              ) : (
                <EmptyState title={t("No sales in this period")} />
              )
            ) : (
              <Skeleton className="h-[300px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Top customers")}</CardTitle>
            <CardDescription>{t("Regulars by amount spent")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {ins ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">{t("Customer")}</TableHead>
                    <TableHead className="text-right">{t("Bills")}</TableHead>
                    <TableHead className="pr-5 text-right">{t("Spent")}</TableHead>
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
                        {t("No customer bills in this period")}
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
            <CardTitle>{t("Peak hours")}</CardTitle>
            <CardDescription>{t("Number of bills by hour of day")}</CardDescription>
          </CardHeader>
          <CardContent>
            {hours ? (
              <BarChart
                height={240}
                label={t("Bills")}
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
              <CardTitle>{t("Dues ageing")}</CardTitle>
              <CardDescription className="mt-1.5">{t("Unpaid bill amounts by age")}</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/dues">{t("Collect dues")}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {ins ? (
              <>
                <BarChart
                  height={190}
                  label={t("Due")}
                  labels={ins.dues_ageing.labels.map((l) => t("{n} days", { n: l }))}
                  data={ins.dues_ageing.amounts}
                  sequential
                />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  {ins.dues_ageing.labels.map((l, i) => (
                    <div key={l} className="rounded-md bg-muted/60 px-2 py-1.5">
                      <p className="text-muted-foreground">{t("{n} days", { n: l })}</p>
                      <p className="tabular text-sm font-semibold">{formatINR(ins.dues_ageing.amounts[i])}</p>
                      <p className="text-muted-foreground">{t("{n} bills", { n: ins.dues_ageing.counts[i] })}</p>
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
                <PackageX className="h-4 w-4 text-red-600 dark:text-red-400" /> {t("Low & out of stock")}
              </CardTitle>
              <CardDescription className="mt-1.5">{t("At or below the reorder level")}</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/reports?tab=reorder">{t("Reorder list")}</Link>
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
                          <AlertTriangle className="h-3 w-3" /> {p.status === "out" ? t("Out of stock") : t("Low")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!ins.low_stock.length && (
                    <TableRow>
                      <TableCell className="py-8 text-center text-muted-foreground">{t("Stock levels are healthy")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Slow-moving stock")}</CardTitle>
            <CardDescription>{t("In stock but not sold in 30+ days")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {ins && (
              <Table>
                <TableBody>
                  {ins.slow_moving.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-5 font-medium">{p.name}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {p.days_since_sale === null ? t("Never sold") : t("{n} days since sale", { n: p.days_since_sale })}
                      </TableCell>
                      <TableCell className="tabular pr-5 text-right">{formatINR(p.stock_value)}</TableCell>
                    </TableRow>
                  ))}
                  {!ins.slow_moving.length && (
                    <TableRow>
                      <TableCell className="py-8 text-center text-muted-foreground">{t("Everything in stock sold in the last 30 days")}</TableCell>
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
