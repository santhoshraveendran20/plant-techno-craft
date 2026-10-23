import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, PackagePlus, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useFetch";
import { useIsTabletUp } from "@/hooks/useMediaQuery";
import { api, errorMessage } from "@/lib/api";
import { playError } from "@/lib/sound";
import { formatDate, formatINR, formatNumber, round2, todayISO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarcodeScannerDialog } from "@/components/BarcodeScanner";
import { ResponsiveTable } from "@/components/data-table";
import { EmptyState, ErrorAlert, Field, Loading, PageHeader, ProductSearch } from "@/components/common";
import { t } from "@/i18n";

/** Invoice lines: an editable table on tablet / desktop, one card per item on phones. */
function PurchaseLines({ lines, update, remove }) {
  const tableMode = useIsTabletUp();
  const amount = (l) => formatINR(Number(l.qty || 0) * Number(l.cost_price || 0));
  if (!lines.length) {
    return <p className="rounded-md border py-8 text-center text-sm text-muted-foreground">{t("Scan or search items to add them")}</p>;
  }
  if (!tableMode) {
    return (
      <div className="grid max-h-[45vh] gap-2 overflow-y-auto">
        {lines.map((l) => (
          <div key={l.product_id} className="rounded-md border p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-medium">{l.name}</p>
              <Button variant="ghost" size="icon" className="-mr-2 -mt-1 h-8 w-8" onClick={() => remove(l.product_id)} aria-label={t("Remove {name}", { name: l.name })}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("Qty")}>
                <Input type="number" min="0" step="any" value={l.qty} onChange={(e) => update(l.product_id, "qty", e.target.value)} className="h-9" />
              </Field>
              <Field label={t("Cost ₹")}>
                <Input type="number" min="0" step="0.01" value={l.cost_price} onChange={(e) => update(l.product_id, "cost_price", e.target.value)} className="h-9" />
              </Field>
              <Field label={t("Batch")}>
                <Input value={l.batch_no} onChange={(e) => update(l.product_id, "batch_no", e.target.value)} className="h-9" placeholder={l.track_expiry ? t("Batch") : "—"} />
              </Field>
              <Field label={t("Expiry")}>
                <Input type="date" value={l.expiry_date} onChange={(e) => update(l.product_id, "expiry_date", e.target.value)} className="h-9" />
              </Field>
            </div>
            <p className="tabular mt-2 text-right text-sm font-semibold">{amount(l)}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="max-h-[40vh] overflow-y-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Product")}</TableHead>
            <TableHead className="w-24">{t("Qty")}</TableHead>
            <TableHead className="w-28">{t("Cost ₹")}</TableHead>
            <TableHead className="w-32">{t("Batch")}</TableHead>
            <TableHead className="w-40">{t("Expiry")}</TableHead>
            <TableHead className="text-right">{t("Amount")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.product_id}>
              <TableCell className="font-medium">{l.name}</TableCell>
              <TableCell>
                <Input type="number" min="0" step="any" value={l.qty} onChange={(e) => update(l.product_id, "qty", e.target.value)} className="h-8" aria-label={t("Quantity of {name}", { name: l.name })} />
              </TableCell>
              <TableCell>
                <Input type="number" min="0" step="0.01" value={l.cost_price} onChange={(e) => update(l.product_id, "cost_price", e.target.value)} className="h-8" aria-label={t("Cost of {name}", { name: l.name })} />
              </TableCell>
              <TableCell>
                <Input value={l.batch_no} onChange={(e) => update(l.product_id, "batch_no", e.target.value)} className="h-8" placeholder={l.track_expiry ? t("Batch") : "—"} aria-label={t("Batch of {name}", { name: l.name })} />
              </TableCell>
              <TableCell>
                <Input type="date" value={l.expiry_date} onChange={(e) => update(l.product_id, "expiry_date", e.target.value)} className="h-8" aria-label={t("Expiry of {name}", { name: l.name })} />
              </TableCell>
              <TableCell className="tabular text-right">{amount(l)}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(l.product_id)} aria-label={t("Remove {name}", { name: l.name })}>
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NewPurchaseDialog({ open, onOpenChange, onSaved }) {
  const suppliers = useFetch(open ? "/api/suppliers" : null);
  const products = useFetch(open ? "/api/products" : null);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [lines, setLines] = useState([]);
  const [updateCost, setUpdateCost] = useState(true);
  const [scan, setScan] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplierId("");
      setInvoiceNo("");
      setInvoiceDate(todayISO());
      setLines([]);
      setError(null);
    }
  }, [open]);

  const addProduct = (p) =>
    setLines((ls) => {
      const existing = ls.find((l) => l.product_id === p.id);
      if (existing) return ls.map((l) => (l.product_id === p.id ? { ...l, qty: Number(l.qty || 0) + 1 } : l));
      return [...ls, { product_id: p.id, name: p.name, unit: p.unit, track_expiry: p.track_expiry, qty: 1, cost_price: p.cost_price ?? 0, batch_no: "", expiry_date: "" }];
    });

  const byBarcode = (code) => {
    const p = (products.data || []).find((x) => x.barcode === code.trim());
    if (!p) {
      playError();
      toast.error(t("No product with barcode {code}", { code }));
      return;
    }
    addProduct(p);
  };

  const update = (pid, k, v) => setLines((ls) => ls.map((l) => (l.product_id === pid ? { ...l, [k]: v } : l)));
  const total = round2(lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost_price || 0), 0));

  const submit = async () => {
    setError(null);
    if (!supplierId) return setError(t("Choose the supplier"));
    if (!invoiceNo.trim()) return setError(t("Enter the supplier's invoice number"));
    if (!lines.length) return setError(t("Add at least one item"));
    setSaving(true);
    try {
      await api.post("/api/purchases", {
        supplier_id: Number(supplierId),
        invoice_no: invoiceNo,
        invoice_date: invoiceDate,
        update_cost_price: updateCost,
        items: lines.map((l) => ({
          product_id: l.product_id, qty: Number(l.qty), cost_price: Number(l.cost_price || 0),
          batch_no: l.batch_no || null, expiry_date: l.expiry_date || null,
        })),
      });
      toast.success(t("Stock-in saved: {n} items, {amount}", { n: lines.length, amount: formatINR(total) }));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("New stock-in (purchase entry)")}</DialogTitle>
          <DialogDescription>{t("Scan the items from the supplier's invoice. Stock goes up as soon as you save.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("Supplier")}>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder={t("Choose supplier")} />
              </SelectTrigger>
              <SelectContent>
                {(suppliers.data || []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Invoice no.")}>
            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          </Field>
          <Field label={t("Invoice date")}>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (scan.trim()) byBarcode(scan);
              setScan("");
            }}
          >
            <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t("Scan barcode + Enter")} className="font-mono" />
            <Button type="button" variant="outline" onClick={() => setCameraOpen(true)} aria-label={t("Scan with camera")}>
              <Camera />
            </Button>
          </form>
          <ProductSearch products={products.data || []} onPick={addProduct} className="flex-1" />
        </div>
        <PurchaseLines
          lines={lines}
          update={update}
          remove={(pid) => setLines((ls) => ls.filter((x) => x.product_id !== pid))}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={updateCost} onCheckedChange={setUpdateCost} /> {t("Update product cost price to this invoice")}
          </label>
          <p className="text-lg">
            {t("Total")} <span className="tabular font-semibold">{formatINR(total)}</span>
          </p>
        </div>
        <ErrorAlert message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit} disabled={saving}>
            <PackagePlus /> {t("Save stock-in")}
          </Button>
        </DialogFooter>
        <BarcodeScannerDialog open={cameraOpen} onOpenChange={setCameraOpen} onDetected={byBarcode} continuous title={t("Scan invoice items")} />
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDetailDialog({ purchaseId, onOpenChange }) {
  const { data } = useFetch(purchaseId ? `/api/purchases/${purchaseId}` : null);
  return (
    <Dialog open={Boolean(purchaseId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Invoice {no}", { no: data?.invoice_no ?? "" })}</DialogTitle>
          <DialogDescription>
            {data ? `${data.supplier_name} · ${formatDate(data.invoice_date)} · ${formatINR(data.total)}` : t("Loading…")}
          </DialogDescription>
        </DialogHeader>
        {data && (
          <div className="-mx-5 border-t sm:-mx-6">
            <ResponsiveTable
              rows={data.items}
              inset
              columns={[
                { key: "product", header: t("Product"), primary: true, cell: (i) => <Link to={`/products/${i.product_id}`} className="font-medium hover:underline">{i.product_name}</Link> },
                { key: "qty", header: t("Qty"), align: "right", className: "tabular", cell: (i) => formatNumber(i.qty) },
                { key: "cost", header: t("Cost"), align: "right", className: "tabular", cell: (i) => formatINR(i.cost_price) },
                { key: "batch", header: t("Batch / expiry"), className: "text-xs", cell: (i) => `${i.batch_no || "—"}${i.expiry_date ? ` · ${formatDate(i.expiry_date)}` : ""}` },
                { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (i) => <span className="tabular font-medium">{formatINR(i.line_total)}</span> },
              ]}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PurchasesPage() {
  const { data, loading, error, reload } = useFetch("/api/purchases");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  return (
    <div>
      <PageHeader
        title={t("Stock-in")}
        description={t("Purchase entries from suppliers. Every line adds stock and is recorded as a stock movement.")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t("New stock-in")}
          </Button>
        }
      />
      <Card>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <ResponsiveTable
            rows={data}
            onRowClick={(p) => setViewing(p.id)}
            columns={[
              { key: "date", header: t("Invoice date"), cell: (p) => formatDate(p.invoice_date) },
              {
                key: "invoice", header: t("Invoice no."), primary: true,
                cell: (p) => (
                  <>
                    <span className="font-medium">{p.invoice_no}</span>
                    <span className="block text-xs text-muted-foreground md:hidden">{p.supplier_name}</span>
                  </>
                ),
              },
              {
                key: "supplier", header: t("Supplier"), card: false,
                cell: (p) => (
                  <Link to={`/suppliers/${p.supplier_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {p.supplier_name}
                  </Link>
                ),
              },
              { key: "items", header: t("Items"), align: "right", className: "tabular", cell: (p) => p.item_count },
              { key: "total", header: t("Total"), align: "right", aside: true, cell: (p) => <span className="tabular font-semibold">{formatINR(p.total)}</span> },
            ]}
          />
        ) : (
          <EmptyState icon={Truck} title={t("No purchases yet")} description={t("Record supplier invoices to add stock.")} />
        )}
      </Card>
      <NewPurchaseDialog open={creating} onOpenChange={setCreating} onSaved={reload} />
      <PurchaseDetailDialog purchaseId={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </div>
  );
}
