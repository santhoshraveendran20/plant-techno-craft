import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { formatINR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ResponsiveTable } from "@/components/data-table";
import { CustomerFormDialog, EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Loading, PageHeader, useDebounced } from "@/components/common";
import { t } from "@/i18n";

export default function CustomersPage() {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const { data, loading, error, reload } = useFetch("/api/customers", { q: dq || undefined, has_due: dueOnly || undefined });

  return (
    <div>
      <PageHeader
        title={t("Customers")}
        description={t("Mobile number is the unique key. Linked UPI IDs let payments match automatically.")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> {t("Add customer")}
          </Button>
        }
      />
      <Card>
        <div className={FILTER_BAR}>
          <div className={FILTER_SEARCH}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search by name or mobile")} className="pl-9" />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Switch checked={dueOnly} onCheckedChange={setDueOnly} /> {t("With dues only")}
          </label>
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <ResponsiveTable
            rows={data}
            onRowClick={(c) => navigate(`/customers/${c.id}`)}
            columns={[
              {
                key: "name", header: t("Customer"), primary: true,
                cell: (c) => (
                  <>
                    <span className="font-medium">{c.name}</span>
                    <span className="tabular block text-xs text-muted-foreground md:hidden">{c.mobile}</span>
                  </>
                ),
              },
              { key: "mobile", header: t("Mobile"), card: false, className: "tabular", cell: (c) => c.mobile },
              { key: "vpas", header: t("UPI IDs"), hide: "xl", wide: true, className: "text-sm text-muted-foreground", cell: (c) => c.vpas.map((v) => v.vpa).join(", ") || "—" },
              { key: "consent", header: t("Consent"), cell: (c) => (c.whatsapp_consent ? <Badge variant="success">{t("Yes")}</Badge> : <Badge variant="secondary">{t("No")}</Badge>) },
              {
                key: "balance", header: t("Balance"), align: "right", aside: true, className: "tabular",
                cell: (c) => (
                  <>
                    {c.due > 0 && <span className="font-semibold text-red-700 dark:text-red-400">{t("{amount} due", { amount: formatINR(c.due) })}</span>}
                    {c.advance > 0 && (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">{t("{amount} advance", { amount: formatINR(c.advance) })}</span>
                    )}
                    {!c.due && !c.advance && <span className="text-muted-foreground">{t("Settled")}</span>}
                  </>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState icon={Users} title={t("No customers found")} />
        )}
      </Card>
      <CustomerFormDialog open={adding} onOpenChange={setAdding} allowOpeningBalance={isOwner} onSaved={() => reload()} />
    </div>
  );
}
