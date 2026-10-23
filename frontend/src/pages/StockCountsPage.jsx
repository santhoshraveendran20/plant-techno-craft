import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Plus } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, Loading, PageHeader } from "@/components/common";
import { t } from "@/i18n";

const VARIANT = { open: "info", posted: "success", cancelled: "secondary" };

export default function StockCountsPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useFetch("/api/stock/counts");

  const start = async () => {
    try {
      const r = await api.post("/api/stock/counts", { note: `Count on ${new Date().toLocaleDateString("en-IN")}` });
      navigate(`/stock/counts/${r.data.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title={t("Physical stock count")}
        description={t("Scan what is on the shelf, compare with the system count, and post the differences as adjustments.")}
        actions={
          <Button onClick={start}>
            <Plus /> {t("Start a count")}
          </Button>
        }
      />
      <Card>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : (
          <ResponsiveTable
            rows={data || []}
            onRowClick={(c) => navigate(`/stock/counts/${c.id}`)}
            empty={<EmptyState icon={ClipboardCheck} title={t("No stock counts yet")} description={t("Target: 98% or better accuracy at the monthly count.")} />}
            columns={[
              {
                key: "started", header: t("Started"), primary: true,
                cell: (c) => (
                  <>
                    <span className="font-medium">{formatDateTime(c.created_at)}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">{c.note || ""}</span>
                  </>
                ),
              },
              { key: "note", header: t("Note"), card: false, cell: (c) => c.note || "—" },
              { key: "items", header: t("Items counted"), align: "right", className: "tabular", cell: (c) => c.item_count },
              { key: "mismatch", header: t("Mismatches"), align: "right", className: "tabular", cell: (c) => c.mismatches },
              { key: "accuracy", header: t("Accuracy"), align: "right", className: "tabular", cell: (c) => (c.accuracy_pct !== null ? `${c.accuracy_pct}%` : "—") },
              { key: "status", header: t("Status"), aside: true, cell: (c) => <Badge variant={VARIANT[c.status]}>{c.status}</Badge> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
