import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Download, Import, Landmark, RotateCcw, Scale } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateTime, formatINR, todayISO } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { GroupedBarChart } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorAlert, Field, Loading, PageHeader, StatCard } from "@/components/common";
import { t } from "@/i18n";

const STATUS = {
  matched: { label: "Matched", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  gaps: { label: "Gaps found", variant: "destructive" },
  no_activity: { label: "No UPI", variant: "secondary" },
};
const ITEM_STATUS = {
  matched: { label: "Matched", variant: "success" },
  missing_in_app: { label: "Missing in app", variant: "destructive" },
  amount_mismatch: { label: "Amount differs", variant: "warning" },
};

function BankCreditDialog({ settlement, onOpenChange, onDone }) {
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState(null);
  useEffect(() => {
    if (settlement) {
      setAmount(String(settlement.net));
      setRef(settlement.bank_utr || "");
      setDate(settlement.settlement_date);
      setError(null);
    }
  }, [settlement]);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/api/recon/settlements/${settlement.id}/bank-credit`, { amount: Number(amount), reference: ref || null, credit_date: date });
      toast.success(t("Bank credit recorded"));
      onDone(r.data);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={Boolean(settlement)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Confirm bank credit")}</DialogTitle>
          <DialogDescription>
            {t("Enter the amount you see in the bank statement for settlement {id}.", { id: settlement?.gateway_settlement_id ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label={t("Amount credited ₹")} hint={settlement ? t("Expected net: {amount}", { amount: formatINR(settlement.net) }) : undefined}>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Credit date")}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t("Bank UTR")}>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit">{t("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WebhookLog() {
  const { data, loading, reload } = useFetch("/api/recon/webhooks", { limit: 100 });
  const retry = async (e) => {
    try {
      await api.post(`/api/recon/webhooks/${e.id}/retry`);
      toast.success(t("Webhook processed"));
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (loading && !data) return <Loading />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Webhook log")}</CardTitle>
        <CardDescription>{t("Every gateway callback, its signature check and processing result. Failed events can be retried.")}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ResponsiveTable
          rows={data || []}
          inset
          empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("No webhooks received yet")}</p>}
          columns={[
            { key: "received", header: t("Received"), className: "whitespace-nowrap text-muted-foreground", cell: (e) => formatDateTime(e.received_at) },
            {
              key: "event", header: t("Event"), primary: true,
              cell: (e) => (
                <>
                  <span className="font-mono text-xs">{e.event_type}</span>
                  <span className="block break-all font-mono text-[11px] text-muted-foreground">{e.event_id || "—"}</span>
                </>
              ),
            },
            { key: "signature", header: t("Signature"), cell: (e) => (e.signature_valid ? <Badge variant="success">{t("Valid")}</Badge> : <Badge variant="destructive">{t("Invalid")}</Badge>) },
            {
              key: "result", header: t("Result"), aside: true, className: "max-w-[320px] text-sm",
              cell: (e) => (
                <>
                  {e.processed ? <Badge variant="success">{t("Processed")}</Badge> : <Badge variant="warning">{t("Not processed")}</Badge>}
                  {e.error && <span className="mt-1 block max-w-[220px] truncate text-xs text-red-700 dark:text-red-400" title={e.error}>{e.error}</span>}
                </>
              ),
            },
            {
              key: "actions", header: t("Retry"), actions: true, align: "right",
              cell: (e) =>
                !e.processed && e.signature_valid ? (
                  <Button size="sm" variant="outline" onClick={() => retry(e)}>
                    <RotateCcw /> {t("Retry")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export default function ReconciliationPage() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  });
  const summary = useFetch("/api/recon/summary", { days: 14 });
  const report = useFetch("/api/recon", { for_date: date });
  const [busy, setBusy] = useState(false);
  const [crediting, setCrediting] = useState(null);
  const r = report.data;
  const chrono = (summary.data || []).slice().reverse();

  const apply = (data) => {
    report.setData(data);
    summary.reload();
  };

  const fetchSettlement = async () => {
    setBusy(true);
    try {
      const res = await api.post("/api/recon/fetch", null, { params: { for_date: date } });
      apply(res.data);
      toast.success(res.data.settlements.length ? t("Settlement report fetched and matched") : t("The gateway has no settlement for this date"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const importItem = async (itemId) => {
    try {
      const res = await api.post(`/api/recon/items/${itemId}/import`);
      apply(res.data);
      toast.success(t("Missed payment imported and matched"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const status = STATUS[r?.status] || STATUS.no_activity;

  return (
    <div>
      <PageHeader
        title={t("Reconciliation")}
        description={t("Daily match of app UPI payments vs the gateway settlement report vs the bank credit (T+1).")}
      />
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">{t("Daily match")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("Webhook log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Last 14 days")}</CardTitle>
              <CardDescription>{t("App UPI payments vs gateway settlement vs bank credit. Tap a day to open its match.")}</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.data ? (
                <GroupedBarChart
                  height={240}
                  labels={chrono.map((d) => formatDate(d.date, { year: undefined }))}
                  series={[
                    { label: t("App UPI"), data: chrono.map((d) => d.app_upi) },
                    { label: t("Gateway gross"), data: chrono.map((d) => d.gateway_gross) },
                    { label: t("Bank credit"), data: chrono.map((d) => d.bank_credit) },
                  ]}
                  onSelect={(i) => setDate(chrono[i].date)}
                />
              ) : (
                <Skeleton className="h-[240px]" />
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
            <Card className="hidden self-start xl:block">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("Status by day")}</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                {summary.loading && !summary.data ? (
                  <Loading />
                ) : (
                  <Table>
                    <TableBody>
                      {(summary.data || []).map((d) => {
                        const st = STATUS[d.status];
                        return (
                          <TableRow key={d.date} className={cn("cursor-pointer", d.date === date && "bg-muted")} onClick={() => setDate(d.date)}>
                            <TableCell className="pl-5">
                              <span className="font-medium">{formatDate(d.date, { year: undefined })}</span>
                              <span className="block text-xs text-muted-foreground tabular">{formatINR(d.app_upi)}</span>
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <Badge variant={st.variant}>{t(st.label)}</Badge>
                              {d.gaps > 0 && <span className="block text-xs text-muted-foreground">{t("{n} items", { n: d.gaps })}</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t("Payments of")}>
                      <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="w-[160px]" />
                    </Field>
                    <Badge variant={status.variant} className="mb-2">{t(status.label)}</Badge>
                  </div>
                  <Button onClick={fetchSettlement} disabled={busy} className="w-full sm:w-auto">
                    <Download /> {t("Fetch settlement report")}
                  </Button>
                </CardContent>
              </Card>
              <ErrorAlert message={report.error} />
              {r && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
                    <StatCard label={t("App UPI payments")} value={formatINR(r.totals.app_upi)} hint={t("{n} payments", { n: r.totals.app_count })} />
                    <StatCard label={t("Gateway gross")} value={formatINR(r.totals.gateway_gross)} hint={r.totals.difference_app_vs_gateway ? t("Diff {amount}", { amount: formatINR(r.totals.difference_app_vs_gateway) }) : t("Same as app")} tone={r.totals.difference_app_vs_gateway ? "bad" : "good"} />
                    <StatCard label={t("Fees + tax")} value={formatINR(r.totals.gateway_fees)} />
                    <StatCard label={t("Net settlement")} value={formatINR(r.totals.gateway_net)} />
                    <StatCard label={t("Bank credit")} value={formatINR(r.totals.bank_credit)} tone={r.totals.bank_credit === r.totals.gateway_net && r.settlements.length ? "good" : "warn"} />
                  </div>
                  {r.totals.manual_upi > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("Plus {amount} of UPI marked manually with UTR (paid to a static QR, not via the gateway).", { amount: formatINR(r.totals.manual_upi) })}
                    </p>
                  )}

                  {r.gaps.length === 0 ? (
                    r.status === "matched" && (
                      <Alert variant="success">
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle>{t("Everything matches")}</AlertTitle>
                        <AlertDescription>{t("App, gateway and bank agree for this day.")}</AlertDescription>
                      </Alert>
                    )
                  ) : (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /> {t("Gaps to explain ({n})", { n: r.gaps.length })}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-2">
                        {r.gaps.map((g, i) => (
                          <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
                            <span className="flex items-start gap-2 text-sm">
                              <CircleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", g.severity === "critical" ? "text-red-600 dark:text-red-400" : g.severity === "serious" ? "text-orange-600 dark:text-orange-400" : "text-amber-500 dark:text-amber-400")} />
                              {g.message}
                            </span>
                            {g.type === "missing_in_app" && (
                              <Button size="sm" onClick={() => importItem(g.item_id)}>
                                <Import /> {t("Import payment")}
                              </Button>
                            )}
                            {(g.type === "bank_unconfirmed" || g.type === "bank_mismatch") && (
                              <Button size="sm" variant="outline" onClick={() => setCrediting(r.settlements.find((s) => s.id === g.settlement_id))}>
                                <Landmark /> {g.type === "bank_unconfirmed" ? t("Confirm bank credit") : t("Correct bank credit")}
                              </Button>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {r.settlements.map((s) => (
                    <Card key={s.id}>
                      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
                        <div>
                          <CardTitle className="text-base">{t("Settlement {id}", { id: s.gateway_settlement_id })}</CardTitle>
                          <CardDescription className="mt-1">
                            {t("Settled {date} · bank UTR {utr} · gross {gross} − fees {fees} = net {net}", {
                              date: formatDate(s.settlement_date),
                              utr: s.bank_utr || "—",
                              gross: formatINR(s.gross),
                              fees: formatINR(s.fees + s.tax),
                              net: formatINR(s.net),
                            })}
                          </CardDescription>
                        </div>
                        {s.bank_credit_amount !== null ? (
                          <Badge variant={s.bank_credit_amount === s.net ? "success" : "destructive"}>
                            {t("Bank credited {amount}", { amount: formatINR(s.bank_credit_amount) })}
                          </Badge>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setCrediting(s)}>
                            <Landmark /> {t("Confirm bank credit")}
                          </Button>
                        )}
                      </CardHeader>
                      <CardContent className="px-0">
                        <ResponsiveTable
                          rows={s.items}
                          inset
                          columns={[
                            { key: "pid", header: t("Gateway payment"), primary: true, cell: (i) => <span className="break-all font-mono text-xs">{i.gateway_payment_id}</span> },
                            { key: "ref", header: t("Reference"), cell: (i) => <span className="font-mono text-xs">{i.reference || "—"}</span> },
                            { key: "utr", header: t("UTR"), hide: "xl", cell: (i) => <span className="font-mono text-xs">{i.utr || "—"}</span> },
                            { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (i) => <span className="tabular">{formatINR(i.amount)}</span> },
                            { key: "match", header: t("Match"), aside: true, cell: (i) => <Badge variant={ITEM_STATUS[i.match_status]?.variant}>{t(ITEM_STATUS[i.match_status]?.label ?? i.match_status)}</Badge> },
                          ]}
                        />
                      </CardContent>
                    </Card>
                  ))}
                  {!r.settlements.length && r.app_payments.length > 0 && (
                    <Card>
                      <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
                        <Scale className="h-5 w-5" /> {t("No settlement report stored for this day yet. Fetch it from the gateway (settles next working day).")}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhookLog />
        </TabsContent>
      </Tabs>
      <BankCreditDialog settlement={crediting} onOpenChange={(o) => !o && setCrediting(null)} onDone={apply} />
    </div>
  );
}
