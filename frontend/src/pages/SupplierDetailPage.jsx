import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Banknote, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatINR, formatNumber, lastMonths, sumByMonth, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GroupedBarChart } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { ErrorAlert, Field, Loading, StatCard } from "@/components/common";
import { SupplierFormDialog } from "@/pages/SuppliersPage";
import { t } from "@/i18n";

function PaySupplierDialog({ open, onOpenChange, supplier, onDone }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setForm({ amount: supplier.payable > 0 ? String(supplier.payable) : "", mode: "upi", reference: "", paid_on: todayISO() });
      setError(null);
    }
  }, [open, supplier]);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/suppliers/${supplier.id}/payments`, { ...form, amount: Number(form.amount), reference: form.reference || null });
      toast.success(t("Supplier payment recorded"));
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Pay {name}", { name: supplier.name })}</DialogTitle>
          <DialogDescription>{t("Reduces the amount payable to this supplier.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label={t("Amount ₹")}>
            <Input type="number" min="0.01" step="0.01" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Mode")}>
              <Select value={form.mode || "upi"} onValueChange={(v) => setForm({ ...form, mode: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upi">{t("UPI")}</SelectItem>
                  <SelectItem value="bank">{t("Bank transfer")}</SelectItem>
                  <SelectItem value="cash">{t("Cash")}</SelectItem>
                  <SelectItem value="cheque">{t("Cheque")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("Date")}>
              <Input type="date" value={form.paid_on || ""} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
            </Field>
          </div>
          <Field label={t("Reference")}>
            <Input value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder={t("UTR / cheque no.")} />
          </Field>
          <DialogFooter>
            <Button type="submit">{t("Record payment")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: s, loading, error, reload } = useFetch(`/api/suppliers/${id}`);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const months = lastMonths(6);

  if (loading && !s) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  if (!s) return null;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-1" onClick={() => navigate(-1)}>
            <ArrowLeft /> {t("Back")}
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[s.mobile, s.gstin && `GSTIN ${s.gstin}`, s.address].filter(Boolean).join(" · ") || t("No contact details")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPaying(true)}>
            <Banknote /> {t("Record payment")}
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> {t("Edit")}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={t("Purchased")} value={formatINR(s.purchased)} />
        <StatCard label={t("Paid")} value={formatINR(s.paid)} />
        <StatCard label={t("Payable")} value={formatINR(s.payable)} tone={s.payable > 0 ? "warn" : "good"} className="col-span-2 sm:col-span-1" />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Purchases and payments by month")}</CardTitle>
          <CardDescription>{t("Invoice value bought from {name} vs what you paid them (last 6 months)", { name: s.name })}</CardDescription>
        </CardHeader>
        <CardContent>
          <GroupedBarChart
            height={240}
            labels={months.map((m) => m.label)}
            series={[
              { label: t("Purchased"), data: sumByMonth(s.purchases, months, (p) => p.invoice_date, (p) => p.total) },
              { label: t("Paid"), data: sumByMonth(s.payments, months, (p) => p.paid_on, (p) => p.amount) },
            ]}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("Purchase history")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <ResponsiveTable
              rows={s.purchases}
              inset
              empty={<p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("No purchases yet")}</p>}
              columns={[
                { key: "date", header: t("Date"), cell: (p) => formatDate(p.invoice_date) },
                { key: "invoice", header: t("Invoice"), primary: true, cell: (p) => <span className="font-medium">{p.invoice_no}</span> },
                { key: "items", header: t("Items"), align: "right", className: "tabular", cell: (p) => p.items },
                { key: "total", header: t("Total"), align: "right", aside: true, cell: (p) => <span className="tabular font-medium">{formatINR(p.total)}</span> },
              ]}
            />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("Products supplied")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <ResponsiveTable
                rows={s.products}
                rowKey={(p) => p.product_id}
                inset
                empty={<p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("No products yet")}</p>}
                columns={[
                  { key: "name", header: t("Product"), primary: true, cell: (p) => <Link to={`/products/${p.product_id}`} className="font-medium hover:underline">{p.name}</Link> },
                  { key: "qty", header: t("Bought"), align: "right", className: "tabular text-muted-foreground", cell: (p) => formatNumber(p.total_qty) },
                  { key: "last", header: t("Last purchase"), align: "right", className: "text-muted-foreground", cell: (p) => formatDate(p.last_purchase) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("Payments to supplier")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <ResponsiveTable
                rows={s.payments}
                inset
                empty={<p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("No payments yet")}</p>}
                columns={[
                  { key: "date", header: t("Date"), primary: true, cell: (p) => <span className="font-medium">{formatDate(p.paid_on)}</span> },
                  { key: "mode", header: t("Mode"), className: "uppercase text-muted-foreground", cell: (p) => <span className="uppercase">{p.mode}</span> },
                  { key: "ref", header: t("Reference"), className: "text-xs text-muted-foreground", cell: (p) => p.reference || "—" },
                  { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (p) => <span className="tabular font-medium">{formatINR(p.amount)}</span> },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
      <PaySupplierDialog open={paying} onOpenChange={setPaying} supplier={s} onDone={reload} />
      <SupplierFormDialog open={editing} onOpenChange={setEditing} supplier={s} onSaved={reload} />
    </div>
  );
}
