import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { useFetch } from "@/hooks/useFetch";
import { daysAgoISO, formatDateTime, formatNumber, todayISO } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, FILTER_BAR, Loading, PageHeader } from "@/components/common";
import { MovementLink } from "@/pages/ProductDetailPage";
import { t } from "@/i18n";

const TYPES = {
  opening: "Opening", purchase: "Stock-in", sale: "Sale", return: "Return", adjustment: "Adjustment", count: "Count",
};

export default function MovementsPage() {
  const [type, setType] = useState("all");
  const [dateFrom, setDateFrom] = useState(daysAgoISO(6));
  const [dateTo, setDateTo] = useState(todayISO());
  const { data, loading, error } = useFetch("/api/stock/movements", {
    movement_type: type === "all" ? undefined : type, date_from: dateFrom, date_to: dateTo, limit: 500,
  });

  return (
    <div>
      <PageHeader title={t("Stock movements")} description={t("Every change to stock: purchases in, sales out, returns, adjustments and counts.")} />
      <Card>
        <div className={FILTER_BAR}>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All types")}</SelectItem>
              {Object.entries(TYPES).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-[150px]" aria-label={t("From date")} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-[150px]" aria-label={t("To date")} />
          <span className="col-span-2 text-sm text-muted-foreground">{data ? t("{n} movements (latest 500)", { n: data.length }) : ""}</span>
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : (
          <ResponsiveTable
            rows={data || []}
            empty={<EmptyState icon={ArrowLeftRight} title={t("No movements in this period")} />}
            columns={[
              { key: "date", header: t("Date"), hide: "xl", className: "whitespace-nowrap text-muted-foreground", cell: (m) => formatDateTime(m.created_at) },
              {
                key: "product", header: t("Product"), primary: true,
                cell: (m) => (
                  <>
                    <Link to={`/products/${m.product_id}`} className="font-medium hover:underline">{m.product_name}</Link>
                    <span className="block text-xs text-muted-foreground xl:hidden">{formatDateTime(m.created_at)}</span>
                  </>
                ),
              },
              {
                key: "type", header: t("Type"),
                cell: (m) => (
                  <>
                    {TYPES[m.movement_type] || m.movement_type}
                    {m.reason && <span className="block max-w-[200px] truncate text-xs text-muted-foreground">{m.reason}</span>}
                  </>
                ),
              },
              {
                key: "change", header: t("In / out"), align: "right", aside: true,
                cell: (m) =>
                  m.qty_in ? (
                    <span className="tabular font-semibold text-emerald-700 dark:text-emerald-400">+{formatNumber(m.qty_in)}</span>
                  ) : (
                    <span className="tabular font-semibold text-red-700 dark:text-red-400">−{formatNumber(m.qty_out)}</span>
                  ),
              },
              { key: "balance", header: t("Balance"), align: "right", className: "tabular font-medium", cell: (m) => formatNumber(m.balance_after) },
              { key: "ref", header: t("Reference"), className: "text-sm", cell: (m) => <MovementLink m={m} /> },
              { key: "user", header: t("User"), hide: "xl", className: "text-sm text-muted-foreground", cell: (m) => m.user || "system" },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
