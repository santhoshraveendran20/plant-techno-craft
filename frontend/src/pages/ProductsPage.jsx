import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Barcode, FolderCog, Package, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatINR, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ResponsiveTable } from "@/components/data-table";
import { BarcodeScannerDialog } from "@/components/BarcodeScanner";
import { ConfirmDialog, EmptyState, ErrorAlert, FILTER_BAR, FILTER_SEARCH, Field, Loading, PageHeader, Pagination, useDebounced } from "@/components/common";

export function StockBadge({ status }) {
  if (status === "out") return <Badge variant="destructive">Out of stock</Badge>;
  if (status === "low") return <Badge variant="warning">Low</Badge>;
  return <Badge variant="success">In stock</Badge>;
}

export function ProductFormDialog({ open, onOpenChange, product, categories, onSaved }) {
  const editing = Boolean(product?.id);
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: product?.name || "",
        category_id: product?.category_id ? String(product.category_id) : "none",
        barcode: product?.barcode || "",
        unit: product?.unit || "pcs",
        cost_price: product?.cost_price ?? "",
        selling_price: product?.selling_price ?? "",
        stock_qty: "",
        reorder_level: product?.reorder_level ?? 5,
        track_expiry: product?.track_expiry || false,
        is_active: product?.is_active ?? true,
      });
      setError(null);
    }
  }, [open, product]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      ...form,
      category_id: form.category_id === "none" ? null : Number(form.category_id),
      cost_price: Number(form.cost_price || 0),
      selling_price: Number(form.selling_price || 0),
      stock_qty: Number(form.stock_qty || 0),
      reorder_level: Number(form.reorder_level || 0),
      barcode: form.barcode || null,
    };
    try {
      const r = editing ? await api.put(`/api/products/${product.id}`, body) : await api.post("/api/products", body);
      toast.success(editing ? "Product updated" : `${r.data.name} added`);
      onSaved?.(r.data);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            {editing ? "Stock changes only through stock-in, sales, returns and adjustments." : "Opening stock is recorded as the first stock movement."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.name || ""} onChange={set("name")} required autoFocus />
            </Field>
            <Field label="Category">
              <Select value={form.category_id || "none"} onValueChange={set("category_id")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Barcode" hint="EAN-13, Code-128 or leave empty and generate a shop label later">
              <div className="flex gap-2">
                <Input value={form.barcode || ""} onChange={set("barcode")} className="font-mono" placeholder="Scan or type" />
                <Button type="button" variant="outline" size="icon" onClick={() => setScanOpen(true)} aria-label="Scan barcode">
                  <Barcode />
                </Button>
              </div>
            </Field>
            <Field label="Unit">
              <Select value={form.unit || "pcs"} onValueChange={set("unit")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["pcs", "kg", "g", "litre", "ml", "pack", "box", "dozen", "metre"].map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Cost price ₹">
              <Input type="number" min="0" step="0.01" value={form.cost_price ?? ""} onChange={set("cost_price")} />
            </Field>
            <Field label="Selling price ₹">
              <Input type="number" min="0" step="0.01" value={form.selling_price ?? ""} onChange={set("selling_price")} required />
            </Field>
            <Field label="Reorder level">
              <Input type="number" min="0" step="any" value={form.reorder_level ?? ""} onChange={set("reorder_level")} />
            </Field>
            {!editing && (
              <Field label="Opening stock">
                <Input type="number" min="0" step="any" value={form.stock_qty ?? ""} onChange={set("stock_qty")} placeholder="0" />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={Boolean(form.track_expiry)} onCheckedChange={set("track_expiry")} /> Track batch & expiry
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={Boolean(form.is_active)} onCheckedChange={set("is_active")} /> Active (sold at billing)
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
        <BarcodeScannerDialog open={scanOpen} onOpenChange={setScanOpen} onDetected={(code) => setForm((f) => ({ ...f, barcode: code }))} />
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ open, onOpenChange, categories, onChanged }) {
  const [name, setName] = useState("");
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post("/api/categories", { name });
      setName("");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (id) => {
    try {
      await api.delete(`/api/categories/${id}`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>Deleting a category keeps its products (uncategorised).</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-72 gap-1 overflow-y-auto">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted">
              <span className="text-sm">
                {c.name} <span className="text-muted-foreground">({c.product_count})</span>
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(c.id)} aria-label={`Delete ${c.name}`}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <form onSubmit={add} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" required />
          <Button type="submit">Add</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZE = 10;

export default function ProductsPage() {
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const stock = params.get("stock") || "all";
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const dq = useDebounced(q);
  const cats = useFetch("/api/categories");
  const { data, loading, error, reload } = useFetch("/api/products", {
    q: dq || undefined, category_id: category === "all" ? undefined : category, stock: stock === "all" ? undefined : stock,
  });
  const all = useMemo(() => data || [], [data]);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [dq, category, stock]);
  const lastPage = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const curPage = Math.min(page, lastPage);
  const rows = useMemo(() => all.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE), [all, curPage]);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const genBarcode = async (p) => {
    try {
      await api.post(`/api/products/${p.id}/generate-barcode`);
      toast.success(`Barcode generated for ${p.name}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const genAll = async () => {
    try {
      const r = await api.post("/api/products/generate-barcodes");
      const ids = r.data.updated.map((p) => p.id);
      toast.success(ids.length ? `Generated ${ids.length} shop barcodes` : "Every product already has a barcode");
      reload();
      if (ids.length) navigate(`/labels?ids=${ids.join(",")}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const deactivate = async (p) => {
    try {
      await api.delete(`/api/products/${p.id}`);
      toast.success(`${p.name} deactivated`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Products"
        description="Catalogue with barcodes, prices, stock and reorder levels."
        actions={
          <>
            {selected.size > 0 && (
              <Button variant="outline" asChild>
                <a href={`/labels?ids=${[...selected].join(",")}`} target="_blank" rel="noreferrer">
                  <Printer /> Print {selected.size} labels
                </a>
              </Button>
            )}
            {isOwner && (
              <>
                <Button variant="outline" onClick={genAll}>
                  <Barcode /> <span className="hidden sm:inline">Labels for items without barcode</span>
                  <span className="sm:hidden">Missing barcodes</span>
                </Button>
                <Button variant="outline" onClick={() => setCatsOpen(true)}>
                  <FolderCog /> Categories
                </Button>
                <Button onClick={() => setEditing({})}>
                  <Plus /> Add product
                </Button>
              </>
            )}
          </>
        }
      />
      <Card>
        <div className={FILTER_BAR}>
          <div className={FILTER_SEARCH}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or barcode" className="pl-9" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(cats.data || []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stock} onValueChange={(v) => setParams(v === "all" ? {} : { stock: v })}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any stock</SelectItem>
              <SelectItem value="low">Low (≤ reorder)</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
              <SelectItem value="ok">Healthy</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : rows.length ? (
          <>
          <ResponsiveTable
            rows={rows}
            columns={[
              {
                key: "select", card: false, className: "w-10",
                header: (
                  <Checkbox
                    checked={rows.length > 0 && rows.every((p) => selected.has(p.id))}
                    onCheckedChange={(v) => setSelected(v ? new Set(rows.map((p) => p.id)) : new Set())}
                    aria-label="Select all"
                  />
                ),
                cell: (p) => <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />,
              },
              {
                key: "product", header: "Product", primary: true,
                cell: (p) => (
                  <div className="flex items-start gap-3">
                    <Checkbox className="mt-0.5 md:hidden" checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name} for labels`} />
                    <div className="min-w-0">
                      <Link to={`/products/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{p.category || "Uncategorised"}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: "barcode", header: "Barcode", hide: "xl", className: "font-mono text-xs",
                cell: (p) =>
                  p.barcode ? (
                    <span className="font-mono text-xs">{p.barcode}</span>
                  ) : isOwner ? (
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => genBarcode(p)}>
                      Generate
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              ...(isOwner
                ? [{ key: "cost", header: "Cost", align: "right", hide: "xl", className: "tabular text-muted-foreground", cell: (p) => formatINR(p.cost_price) }]
                : []),
              { key: "price", header: "Price", align: "right", aside: true, cell: (p) => <span className="tabular font-semibold">{formatINR(p.selling_price)}</span> },
              {
                key: "stock", header: "Stock", align: "right", className: "tabular",
                cell: (p) => (
                  <>
                    {formatNumber(p.stock_qty)} <span className="text-xs text-muted-foreground">{p.unit}</span>
                  </>
                ),
              },
              { key: "status", header: "Status", aside: true, cell: (p) => <StockBadge status={p.stock_status} /> },
              ...(isOwner
                ? [
                    {
                      key: "actions", header: "Actions", actions: true, align: "right",
                      cell: (p) => (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                            <Pencil />
                          </Button>
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Deactivate ${p.name}`}>
                                <Trash2 />
                              </Button>
                            }
                            title={`Deactivate ${p.name}?`}
                            description="It disappears from billing but its history stays. You can re-activate it by editing."
                            confirmLabel="Deactivate"
                            variant="destructive"
                            onConfirm={() => deactivate(p)}
                          />
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <Pagination page={curPage} pageSize={PAGE_SIZE} total={all.length} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={Package} title="No products found" />
        )}
      </Card>
      <ProductFormDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        product={editing}
        categories={cats.data || []}
        onSaved={() => reload()}
      />
      <CategoriesDialog open={catsOpen} onOpenChange={setCatsOpen} categories={cats.data || []} onChanged={() => { cats.reload(); reload(); }} />
    </div>
  );
}
