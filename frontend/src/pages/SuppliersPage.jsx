import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, Field, Loading, PageHeader, StatCard } from "@/components/common";
import { t } from "@/i18n";

export function SupplierFormDialog({ open, onOpenChange, supplier, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setForm({
        name: supplier?.name || "", mobile: supplier?.mobile || "", gstin: supplier?.gstin || "",
        email: supplier?.email || "", address: supplier?.address || "", is_active: supplier?.is_active ?? true,
      });
      setError(null);
    }
  }, [open, supplier]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { ...form, mobile: form.mobile || null, gstin: form.gstin || null, email: form.email || null, address: form.address || null };
      if (supplier?.id) await api.put(`/api/suppliers/${supplier.id}`, body);
      else await api.post("/api/suppliers", body);
      toast.success(t("Supplier saved"));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier?.id ? t("Edit supplier") : t("Add supplier")}</DialogTitle>
          <DialogDescription>{t("Contact and tax details used on purchase entries.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label={t("Name")}>
            <Input value={form.name || ""} onChange={set("name")} required autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Mobile")}>
              <Input value={form.mobile || ""} onChange={set("mobile")} />
            </Field>
            <Field label={t("GSTIN")}>
              <Input value={form.gstin || ""} onChange={set("gstin")} className="uppercase" />
            </Field>
          </div>
          <Field label={t("Email")}>
            <Input type="email" value={form.email || ""} onChange={set("email")} />
          </Field>
          <Field label={t("Address")}>
            <Input value={form.address || ""} onChange={set("address")} />
          </Field>
          <DialogFooter>
            <Button type="submit">{t("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppliersPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch("/api/suppliers");
  const [editing, setEditing] = useState(null);
  const payable = (data || []).reduce((s, x) => s + x.payable, 0);

  return (
    <div>
      <PageHeader
        title={t("Suppliers")}
        description={t("Who supplies what, purchase history and the amount you still owe them.")}
        actions={
          <Button onClick={() => setEditing({})}>
            <Plus /> {t("Add supplier")}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("Suppliers")} value={data?.length ?? "—"} />
        <StatCard label={t("Total payable")} value={formatINR(payable)} tone={payable > 0 ? "warn" : "good"} />
      </div>
      <Card>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <ResponsiveTable
            rows={data}
            onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
            columns={[
              {
                key: "name", header: t("Supplier"), primary: true,
                cell: (s) => (
                  <>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground xl:hidden">{[s.mobile, s.gstin].filter(Boolean).join(" · ") || "—"}</span>
                  </>
                ),
              },
              { key: "mobile", header: t("Mobile"), hide: "xl", card: false, cell: (s) => s.mobile || "—" },
              { key: "gstin", header: t("GSTIN"), hide: "xl", card: false, cell: (s) => <span className="font-mono text-xs">{s.gstin || "—"}</span> },
              { key: "purchased", header: t("Purchased"), align: "right", className: "tabular", cell: (s) => formatINR(s.purchased) },
              { key: "paid", header: t("Paid"), align: "right", className: "tabular", cell: (s) => formatINR(s.paid) },
              {
                key: "payable", header: t("Payable"), align: "right", aside: true,
                cell: (s) => <span className={`tabular font-semibold ${s.payable > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{formatINR(s.payable)}</span>,
              },
              {
                key: "actions", header: t("Edit"), actions: true, align: "right",
                cell: (s) => (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(s)} aria-label={t("Edit {name}", { name: s.name })}>
                    <Pencil />
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState icon={Building2} title={t("No suppliers yet")} />
        )}
      </Card>
      <SupplierFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} supplier={editing} onSaved={reload} />
    </div>
  );
}
