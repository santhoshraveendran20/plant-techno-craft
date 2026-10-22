import { useState } from "react";
import { Link } from "react-router-dom";
import { HandCoins, MessageSquare, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatINR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart, ChartEmpty, SEQUENTIAL, barsHeight } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Loading, PageHeader, StatCard, useDebounced } from "@/components/common";
import { ExportButtons } from "@/pages/BillsPage";

const BUCKET_VARIANT = { "0-30": "info", "31-60": "warning", "60+": "destructive" };
const BUCKETS = ["0-30", "31-60", "60+"];

export default function DuesPage() {
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState("all");
  const [sort, setSort] = useState("amount");
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch("/api/dues", {
    q: dq || undefined, bucket: bucket === "all" ? undefined : bucket, sort,
  });
  // unfiltered list for the summary cards and charts
  const all = useFetch("/api/dues", { sort: "amount" });
  const [sending, setSending] = useState(null);

  const remind = async (row, channel) => {
    setSending(`${row.customer_id}-${channel}`);
    try {
      const r = await api.post(`/api/customers/${row.customer_id}/reminders`, { channel, include_link: true });
      window.open(r.data.url, "_blank", "noopener");
      toast.success(`Reminder for ${row.name} ready`, { description: "It includes a UPI payment link for the full due." });
      reload();
      all.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(null);
    }
  };

  const allRows = all.data?.rows || [];
  const byBucket = (b) => allRows.filter((r) => r.bucket === b).reduce((s, r) => s + r.amount_due, 0);
  const top = allRows.slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Dues & reminders"
        description="Who owes money, since when, and one-tap reminders with a UPI payment link."
        actions={<ExportButtons kind="dues" params={{}} />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total to collect" value={formatINR(all.data?.total_due || 0)} hint={`${all.data?.customers || 0} customers`} tone="bad" />
        <StatCard label="0–30 days" value={formatINR(byBucket("0-30"))} />
        <StatCard label="31–60 days" value={formatINR(byBucket("31-60"))} tone="warn" hint="Remind soon" />
        <StatCard label="60+ days" value={formatINR(byBucket("60+"))} tone="bad" hint="Follow up personally" />
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dues by age</CardTitle>
            <CardDescription>Customers' outstanding balance by how old their oldest unpaid bill is</CardDescription>
          </CardHeader>
          <CardContent>
            {!all.data ? (
              <Skeleton className="h-[220px]" />
            ) : allRows.length ? (
              <BarChart
                height={220}
                label="Due"
                labels={BUCKETS.map((b) => `${b} days`)}
                data={BUCKETS.map(byBucket)}
                colors={SEQUENTIAL}
              />
            ) : (
              <ChartEmpty height={220}>Nobody owes money</ChartEmpty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Largest dues</CardTitle>
            <CardDescription>Top {top.length || 10} customers to follow up</CardDescription>
          </CardHeader>
          <CardContent>
            {!all.data ? (
              <Skeleton className="h-[220px]" />
            ) : top.length ? (
              <BarChart
                horizontal
                height={barsHeight(top.length, 24)}
                label="Due"
                labels={top.map((r) => r.name)}
                data={top.map((r) => r.amount_due)}
                tooltipFormatter={(v, i) => `${formatINR(v)} · ${top[i].days_overdue} days overdue`}
              />
            ) : (
              <ChartEmpty height={220}>Nobody owes money</ChartEmpty>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className={FILTER_BAR}>
          <div className={FILTER_SEARCH}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name or mobile" className="pl-9" />
          </div>
          <Select value={bucket} onValueChange={setBucket}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ages</SelectItem>
              <SelectItem value="0-30">0–30 days</SelectItem>
              <SelectItem value="31-60">31–60 days</SelectItem>
              <SelectItem value="60+">60+ days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="amount">Sort: highest due</SelectItem>
              <SelectItem value="days">Sort: most overdue</SelectItem>
              <SelectItem value="name">Sort: name</SelectItem>
              <SelectItem value="last_reminder">Sort: least recently reminded</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : (
          <ResponsiveTable
            rows={data?.rows || []}
            rowKey={(r) => r.customer_id}
            empty={<EmptyState icon={HandCoins} title="No dues" description="Nobody owes money right now." />}
            columns={[
              {
                key: "customer", header: "Customer", primary: true,
                cell: (r) => (
                  <>
                    <Link to={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{r.mobile}</span>
                  </>
                ),
              },
              { key: "due", header: "Amount due", align: "right", aside: true, cell: (r) => <span className="tabular font-semibold text-red-700">{formatINR(r.amount_due)}</span> },
              { key: "oldest", header: "Oldest due", hide: "xl", className: "text-muted-foreground", cell: (r) => formatDate(r.oldest_due_date) },
              { key: "days", header: "Overdue", align: "right", cell: (r) => <Badge variant={BUCKET_VARIANT[r.bucket]}>{r.days_overdue} days</Badge> },
              { key: "reminder", header: "Last reminder", hide: "xl", className: "text-sm text-muted-foreground", cell: (r) => (r.last_reminder_at ? formatDateTime(r.last_reminder_at) : "Never") },
              {
                key: "actions", header: "Remind", actions: true, align: "right",
                cell: (r) =>
                  r.whatsapp_consent ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => remind(r, "whatsapp")} disabled={sending === `${r.customer_id}-whatsapp`}>
                        <Send /> WhatsApp
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remind(r, "sms")} disabled={sending === `${r.customer_id}-sms`} aria-label="Send SMS">
                        <MessageSquare />
                      </Button>
                    </div>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Badge variant="secondary">No consent</Badge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Record consent on the customer before messaging (DPDP Act).</TooltipContent>
                    </Tooltip>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
