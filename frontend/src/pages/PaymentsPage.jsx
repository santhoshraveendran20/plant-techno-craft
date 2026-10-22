import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Link2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { daysAgoISO, formatDate, formatDateTime, formatINR, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartEmpty, GroupedBarChart } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import {
  CustomerPicker, EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Loading, MatchBadge, ModeBadge, PageHeader, Pagination,
  UpiStatusBadge, useDebounced,
} from "@/components/common";
import { ExportButtons } from "@/pages/BillsPage";

function PaymentRows({ rows, onLink, isOwner }) {
  const columns = [
    { key: "time", header: "Time", hide: "xl", card: false, className: "whitespace-nowrap text-muted-foreground", cell: (p) => formatDateTime(p.created_at) },
    { key: "mode", header: "Mode", cell: (p) => <ModeBadge mode={p.mode} kind={p.kind} /> },
    {
      key: "amount", header: "Amount", align: "right", aside: true,
      cell: (p) => (
        <span className={`tabular font-semibold ${p.gateway_status === "failed" ? "text-muted-foreground line-through" : ""}`}>{formatINR(p.amount)}</span>
      ),
    },
    {
      key: "for", header: "Bill / customer", primary: true, className: "text-sm",
      cell: (p) => (
        <>
          {p.bill_no ? (
            <Link to={`/bills/${p.bill_id}`} className="font-medium hover:underline">
              {p.bill_no}
            </Link>
          ) : (
            <span className="text-muted-foreground">Dues</span>
          )}
          {p.customer_name && (
            <Link to={`/customers/${p.customer_id}`} className="block text-xs text-muted-foreground hover:underline">
              {p.customer_name}
            </Link>
          )}
          <span className="block text-xs text-muted-foreground xl:hidden">{formatDateTime(p.created_at)}</span>
        </>
      ),
    },
    { key: "utr", header: "UTR", hide: "xl", className: "font-mono text-xs", cell: (p) => <span className="font-mono text-xs">{p.utr || "—"}</span> },
    {
      key: "payer", header: "Payer UPI ID", hide: "2xl", className: "text-sm",
      cell: (p) => (
        <>
          {p.payer_vpa || "—"}
          {p.payer_name && <span className="block text-xs text-muted-foreground">{p.payer_name}</span>}
        </>
      ),
    },
    {
      key: "status", header: "Status", aside: true,
      cell: (p) => (
        <>
          <MatchBadge status={p.match_status} />
          {p.note && <span className="mt-0.5 block max-w-[160px] truncate text-xs text-muted-foreground" title={p.note}>{p.note}</span>}
        </>
      ),
    },
  ];
  if (onLink) {
    columns.push({
      key: "actions", header: "Actions", actions: true, align: "right",
      cell: (p) =>
        isOwner && !p.customer_id && p.gateway_status === "success" && p.kind === "payment" ? (
          <Button size="sm" variant="outline" onClick={() => onLink(p)}>
            <Link2 /> Link customer
          </Button>
        ) : null,
    });
  }
  return <ResponsiveTable rows={rows} columns={columns} />;
}

function CollectionsChart({ dateFrom, dateTo }) {
  const { data } = useFetch("/api/payments/daily", { date_from: dateFrom, date_to: dateTo });
  if (!data) return <Skeleton className="h-[220px]" />;
  const labels = data.labels.map((d) => formatDate(d, { year: undefined }));
  const total = data.totals.upi + data.totals.cash;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="tabular text-lg font-semibold">{formatINR(total)}</span>
        <span className="text-muted-foreground">
          UPI {formatINR(data.totals.upi)} · Cash {formatINR(data.totals.cash)}
          {data.totals.refunds > 0 && ` · Refunds ${formatINR(data.totals.refunds)}`}
        </span>
      </div>
      {total > 0 ? (
        <GroupedBarChart
          stacked
          height={240}
          labels={labels}
          series={[
            { label: "UPI", data: data.upi },
            { label: "Cash", data: data.cash },
          ]}
        />
      ) : (
        <ChartEmpty height={200}>No money collected in this period</ChartEmpty>
      )}
    </>
  );
}

function LinkCustomerDialog({ payment, onOpenChange, onDone }) {
  const [customer, setCustomer] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/payments/${payment.id}/link-customer`, { customer_id: customer.id, remember_vpa: true });
      toast.success(`Linked to ${customer.name}`, { description: "It now settles their oldest dues first." });
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={Boolean(payment)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link payment to a customer</DialogTitle>
          <DialogDescription>
            {payment && `${formatINR(payment.amount)} from ${payment.payer_vpa || "unknown UPI ID"}. The UPI ID is remembered so future payments link automatically.`}
          </DialogDescription>
        </DialogHeader>
        <CustomerPicker value={customer} onChange={setCustomer} />
        <DialogFooter>
          <Button onClick={submit} disabled={!customer || busy}>
            Link payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsPage() {
  const { isOwner } = useAuth();
  const [search] = useSearchParams();
  const [tab, setTab] = useState(search.get("review") ? "review" : "all");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("all");
  const [dateFrom, setDateFrom] = useState(daysAgoISO(6));
  const [dateTo, setDateTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const [linking, setLinking] = useState(null);
  const dq = useDebounced(q);

  const all = useFetch(tab === "all" ? "/api/payments" : null, {
    q: dq || undefined, mode: mode === "all" ? undefined : mode, date_from: dateFrom, date_to: dateTo, page, page_size: 50,
  });
  const review = useFetch(tab === "review" ? "/api/payments/review" : null, { days: 30 });
  const qrs = useFetch(tab === "qr" ? "/api/upi/requests" : null, { limit: 100 });

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every UPI and cash payment with UTR, payer UPI ID and the bill it settled. Search a UTR to resolve 'I already paid'."
        actions={isOwner && <ExportButtons kind="payments" params={{ date_from: dateFrom, date_to: dateTo }} />}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="review">Needs review</TabsTrigger>
          <TabsTrigger value="qr">QR requests</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {isOwner && (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Money collected per day</CardTitle>
                <CardDescription>UPI and cash received in the selected dates (dues collections included)</CardDescription>
              </CardHeader>
              <CardContent>
                <CollectionsChart dateFrom={dateFrom} dateTo={dateTo} />
              </CardContent>
            </Card>
          )}
          <Card>
            <div className={FILTER_BAR}>
              <div className={FILTER_SEARCH}>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="UTR, UPI ID, payer, bill no or customer" className="pl-9" />
              </div>
              <Select value={mode} onValueChange={(v) => { setMode(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All modes</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="writeoff">Write-off</SelectItem>
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label="From date" />
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label="To date" />
            </div>
            {all.data && (
              <div className="flex flex-wrap gap-4 border-b px-4 py-2 text-sm">
                {Object.entries(all.data.sum_by_mode).map(([m, v]) => (
                  <span key={m} className="text-muted-foreground">
                    {m.toUpperCase()}: <b className="tabular text-foreground">{formatINR(v)}</b>
                  </span>
                ))}
              </div>
            )}
            <ErrorAlert message={all.error} className="m-3" />
            {all.loading && !all.data ? (
              <Loading />
            ) : all.data?.rows.length ? (
              <>
                <PaymentRows rows={all.data.rows} />
                <Pagination page={page} pageSize={50} total={all.data.total} onPage={setPage} />
              </>
            ) : (
              <EmptyState icon={Wallet} title="No payments found" />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardContent className="p-0">
              <p className="border-b px-4 py-3 text-sm text-muted-foreground">
                Failed attempts, amount mismatches, overpayments and UPI credits not linked to any customer (last 30 days).
              </p>
              {review.loading && !review.data ? (
                <Loading />
              ) : review.data?.length ? (
                <PaymentRows rows={review.data} onLink={setLinking} isOwner={isOwner} />
              ) : (
                <EmptyState icon={Wallet} title="Nothing to review" description="Every UPI payment is matched to a bill or customer." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qr">
          <Card>
            {qrs.loading && !qrs.data ? (
              <Loading />
            ) : (
              <ResponsiveTable
                rows={qrs.data || []}
                empty={<EmptyState icon={Wallet} title="No QR requests yet" />}
                columns={[
                  { key: "created", header: "Created", className: "whitespace-nowrap text-muted-foreground", cell: (r) => formatDateTime(r.created_at) },
                  {
                    key: "ref", header: "Reference", hide: "xl",
                    cell: (r) => (
                      <span className="font-mono text-xs">
                        {r.ref}
                        {r.is_link && <span className="ml-1 rounded bg-muted px-1 font-sans">link</span>}
                      </span>
                    ),
                  },
                  {
                    key: "for", header: "For", primary: true, className: "text-sm",
                    cell: (r) => (
                      <>
                        {r.bill_no ? <Link to={`/bills/${r.bill_id}`} className="font-medium hover:underline">{r.bill_no}</Link> : <span className="font-medium">Dues</span>}
                        {r.customer_name && <span className="block text-xs text-muted-foreground">{r.customer_name}</span>}
                      </>
                    ),
                  },
                  { key: "amount", header: "Amount", align: "right", aside: true, cell: (r) => <span className="tabular font-semibold">{formatINR(r.amount)}</span> },
                  { key: "received", header: "Received", align: "right", className: "tabular", cell: (r) => formatINR(r.received_amount) },
                  { key: "status", header: "Status", aside: true, cell: (r) => <UpiStatusBadge status={r.status} /> },
                ]}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
      <LinkCustomerDialog payment={linking} onOpenChange={(o) => !o && setLinking(null)} onDone={review.reload} />
    </div>
  );
}
