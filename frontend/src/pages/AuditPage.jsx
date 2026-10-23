import { useState } from "react";
import { History, Search } from "lucide-react";
import { useFetch } from "@/hooks/useFetch";
import { daysAgoISO, formatDateTime, todayISO } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Loading, PageHeader, Pagination, useDebounced } from "@/components/common";
import { t } from "@/i18n";

const RISKY = new Set(["delete", "cancel", "discount", "writeoff", "return", "price_change", "manual_payment", "adjustment_approve"]);

function pretty(json) {
  if (!json) return null;
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export default function AuditPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const dq = useDebounced(q);
  const { data, loading, error } = useFetch("/api/audit", {
    q: dq || undefined, action: action === "all" ? undefined : action, date_from: from, date_to: to, page, page_size: pageSize,
  });

  return (
    <div>
      <PageHeader title={t("Audit log")} description={t("Who changed what and when: edits, discounts, deletions, returns, write-offs, approvals and exports.")} />
      <Card>
        <div className={FILTER_BAR}>
          <div className={FILTER_SEARCH}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("Search summary or user")} className="pl-9" />
          </div>
          <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All actions")}</SelectItem>
              {(data?.actions || []).map((a) => (
                <SelectItem key={a} value={a}>
                  {t(a.replace(/_/g, " "))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label={t("From date")} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-full sm:w-[150px]" aria-label={t("To date")} />
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : data?.rows.length ? (
          <>
            <ResponsiveTable
              rows={data.rows}
              columns={[
                { key: "time", header: t("Time"), hide: "xl", className: "whitespace-nowrap text-muted-foreground", cell: (a) => formatDateTime(a.created_at) },
                {
                  key: "user", header: t("User"),
                  cell: (a) => (
                    <>
                      <span className="font-medium">{a.username}</span>
                      <span className="block text-xs capitalize text-muted-foreground">{t(a.role)}</span>
                    </>
                  ),
                },
                { key: "action", header: t("Action"), aside: true, cell: (a) => <Badge variant={RISKY.has(a.action) ? "warning" : "secondary"}>{t(a.action.replace(/_/g, " "))}</Badge> },
                {
                  key: "summary", header: t("What happened"), primary: true, className: "max-w-[480px] text-sm",
                  cell: (a) => (
                    <>
                      <span className="text-sm">{a.summary}</span>
                      <span className="block text-xs text-muted-foreground xl:hidden">{formatDateTime(a.created_at)}</span>
                    </>
                  ),
                },
                {
                  key: "details", header: t("Details"), actions: true, align: "right",
                  cell: (a) =>
                    a.old_value || a.new_value ? (
                      <Popover>
                        <PopoverTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">{t("Details")}</PopoverTrigger>
                        <PopoverContent align="end" className="w-[min(92vw,420px)]">
                          {a.old_value && (
                            <>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("Before")}</p>
                              <pre className="mb-3 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{pretty(a.old_value)}</pre>
                            </>
                          )}
                          {a.new_value && (
                            <>
                              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("After")}</p>
                              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{pretty(a.new_value)}</pre>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                    ) : null,
                },
              ]}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          </>
        ) : (
          <EmptyState icon={History} title={t("No audit entries for this filter")} />
        )}
      </Card>
    </div>
  );
}
