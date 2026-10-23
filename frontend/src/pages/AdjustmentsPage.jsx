import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Plus, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveTable } from "@/components/data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorAlert, Field, Loading, PageHeader, ProductSearch } from "@/components/common";
import { t } from "@/i18n";

const REASONS = { damage: "Damaged", loss: "Lost / theft", wastage: "Wastage / expired", correction: "Count correction", other: "Other" };
const STATUS_VARIANT = { pending: "warning", approved: "success", rejected: "secondary" };

function AdjustmentDialog({ open, onOpenChange, initialProductId, onSaved, isOwner }) {
  const products = useFetch(open ? "/api/products" : null);
  const [product, setProduct] = useState(null);
  const [direction, setDirection] = useState("remove");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("damage");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setProduct(null);
      setDirection("remove");
      setQty("");
      setReason("damage");
      setNote("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && initialProductId && products.data) {
      setProduct(products.data.find((p) => p.id === Number(initialProductId)) || null);
    }
  }, [open, initialProductId, products.data]);

  const submit = async (e) => {
    e.preventDefault();
    if (!product) return setError(t("Choose a product"));
    const n = Number(qty);
    if (!(n > 0)) return setError(t("Enter a quantity greater than zero"));
    try {
      const r = await api.post("/api/stock/adjustments", {
        product_id: product.id, qty_change: direction === "remove" ? -n : n, reason, note: note || null,
      });
      toast.success(r.data.status === "approved" ? t("Stock adjusted") : t("Sent to the owner for approval"));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Stock adjustment")}</DialogTitle>
          <DialogDescription>
            {isOwner ? t("Applied immediately and logged.") : t("Staff adjustments need the owner's approval before stock changes.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label={t("Product")}>
            {product ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{product.name}</span>
                  <span className="block text-xs text-muted-foreground">{t("In stock: {qty} {unit}", { qty: formatNumber(product.stock_qty), unit: product.unit })}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setProduct(null)}>
                  {t("Change")}
                </Button>
              </div>
            ) : (
              <ProductSearch products={products.data || []} onPick={setProduct} autoFocus />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Change")}>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="remove">{t("Remove from stock")}</SelectItem>
                  <SelectItem value="add">{t("Add to stock")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("Quantity")}>
              <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
            </Field>
          </div>
          <Field label={t("Reason")}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASONS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {t(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("What happened?")} />
          </Field>
          <DialogFooter>
            <Button type="submit">{isOwner ? t("Adjust stock") : t("Request approval")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdjustmentsPage() {
  const { isOwner } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("pending");
  const [open, setOpen] = useState(Boolean(params.get("product")));
  const { data, loading, error, reload } = useFetch("/api/stock/adjustments", { status: status === "all" ? undefined : status });

  const decide = async (a, decision) => {
    try {
      await api.post(`/api/stock/adjustments/${a.id}/${decision}`);
      toast.success(decision === "approve" ? t("Approved — stock updated") : t("Rejected"));
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title={t("Stock adjustments")}
        description={t("Damage, loss, wastage and count corrections — each with a reason, the person and owner approval.")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> {t("New adjustment")}
          </Button>
        }
      />
      <Tabs value={status} onValueChange={setStatus} className="mb-3">
        <TabsList>
          <TabsTrigger value="pending">{t("Awaiting approval")}</TabsTrigger>
          <TabsTrigger value="approved">{t("Approved")}</TabsTrigger>
          <TabsTrigger value="rejected">{t("Rejected")}</TabsTrigger>
          <TabsTrigger value="all">{t("All")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : (
          <ResponsiveTable
            rows={data || []}
            empty={<EmptyState icon={SlidersHorizontal} title={t("No adjustments here")} />}
            columns={[
              { key: "when", header: t("Requested"), hide: "xl", className: "whitespace-nowrap text-muted-foreground", cell: (a) => formatDateTime(a.created_at) },
              {
                key: "product", header: t("Product"), primary: true,
                cell: (a) => (
                  <>
                    <Link to={`/products/${a.product_id}`} className="font-medium hover:underline">{a.product_name}</Link>
                    <span className="block text-xs text-muted-foreground">{t("Now {qty} {unit}", { qty: formatNumber(a.stock_qty), unit: a.unit })}</span>
                  </>
                ),
              },
              {
                key: "change", header: t("Change"), align: "right", aside: true,
                cell: (a) => (
                  <span className={`tabular font-semibold ${a.qty_change < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {a.qty_change > 0 ? "+" : ""}
                    {formatNumber(a.qty_change)}
                  </span>
                ),
              },
              {
                key: "reason", header: t("Reason"),
                cell: (a) => (
                  <>
                    {t(REASONS[a.reason] || a.reason)}
                    {a.note && <span className="block text-xs text-muted-foreground">{a.note}</span>}
                  </>
                ),
              },
              {
                key: "by", header: t("By"), className: "text-sm",
                cell: (a) => (
                  <>
                    {a.requested_by}
                    <span className="block text-xs text-muted-foreground xl:hidden">{formatDateTime(a.created_at)}</span>
                    {a.approved_by && <span className="block text-xs text-muted-foreground">{t("decided by {name}", { name: a.approved_by })}</span>}
                  </>
                ),
              },
              { key: "status", header: t("Status"), aside: true, cell: (a) => <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge> },
              ...(isOwner
                ? [
                    {
                      key: "actions", header: t("Decision"), actions: true, align: "right",
                      cell: (a) =>
                        a.status === "pending" ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="success" onClick={() => decide(a, "approve")}>
                              <Check /> {t("Approve")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => decide(a, "reject")}>
                              <X /> {t("Reject")}
                            </Button>
                          </div>
                        ) : null,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>
      <AdjustmentDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && params.get("product")) setParams({});
        }}
        initialProductId={params.get("product")}
        isOwner={isOwner}
        onSaved={() => {
          setStatus(isOwner ? "approved" : "pending");
          reload();
        }}
      />
    </div>
  );
}
