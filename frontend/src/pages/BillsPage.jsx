import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileSpreadsheet, FileText, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { downloadFile, errorMessage } from "@/lib/api";
import { daysAgoISO, formatDateTime, formatINR, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveTable } from "@/components/data-table";
import { BillStatusBadge, EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Loading, PageHeader, Pagination, useDebounced } from "@/components/common";

export function ExportButtons({ kind, params }) {
  const run = async (format) => {
    try {
      await downloadFile(`/api/exports/${kind}`, { format, ...params });
    } catch (e) {
      toast.error(errorMessage(e, "Export failed"));
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => run("xlsx")}>
        <FileSpreadsheet /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={() => run("pdf")}>
        <FileText /> PDF
      </Button>
    </>
  );
}

export default function BillsPage() {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState(daysAgoISO(29));
  const [dateTo, setDateTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const params = {
    q: dq || undefined,
    status: status === "all" ? undefined : status,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
    page_size: 50,
  };
  const { data, loading, error } = useFetch("/api/bills", params);

  return (
    <div>
      <PageHeader
        title="Bills"
        description="Every bill with its payment status. Open one to collect dues, print, share or return items."
        actions={isOwner && <ExportButtons kind="bills" params={{ date_from: dateFrom, date_to: dateTo }} />}
      />
      <Card>
        <div className={FILTER_BAR}>
          <div className={FILTER_SEARCH}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Bill no, customer name or mobile" className="pl-9" />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="part_paid">Part-paid</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
              <SelectItem value="pending">Awaiting UPI</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label="From date" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label="To date" />
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : data?.rows.length ? (
          <>
            <ResponsiveTable
              rows={data.rows}
              onRowClick={(b) => navigate(`/bills/${b.id}`)}
              columns={[
                {
                  key: "bill", header: "Bill", primary: true, className: "font-medium",
                  cell: (b) => (
                    <>
                      <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                        {b.bill_no || `Draft #${b.id}`}
                      </Link>
                      <span className="block text-xs text-muted-foreground xl:hidden">
                        {b.customer_name || "Walk-in"} · {formatDateTime(b.completed_at || b.created_at)}
                      </span>
                    </>
                  ),
                },
                { key: "date", header: "Date", card: false, hide: "xl", className: "whitespace-nowrap text-muted-foreground", cell: (b) => formatDateTime(b.completed_at || b.created_at) },
                { key: "customer", header: "Customer", card: false, hide: "xl", cell: (b) => b.customer_name || <span className="text-muted-foreground">Walk-in</span> },
                { key: "items", header: "Items", align: "right", hide: "xl", className: "tabular", cell: (b) => b.item_count },
                { key: "total", header: "Total", align: "right", aside: true, className: "tabular font-medium", cell: (b) => <span className="tabular font-semibold">{formatINR(b.total)}</span> },
                { key: "paid", header: "Paid", align: "right", className: "tabular", cell: (b) => formatINR(b.paid_amount) },
                { key: "due", header: "Due", align: "right", className: "tabular", cell: (b) => (b.due_amount > 0 ? <span className="text-red-700">{formatINR(b.due_amount)}</span> : "—") },
                { key: "status", header: "Status", aside: true, cell: (b) => <BillStatusBadge status={b.status} /> },
              ]}
            />
            <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={Receipt} title="No bills found" description="Try another date range or status." />
        )}
      </Card>
    </div>
  );
}
