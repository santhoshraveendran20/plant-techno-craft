import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { cn, formatINR } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";

/** Filter row above a list: stacked 2-column grid on phones, one wrapping row from tablet up. */
export const FILTER_BAR = "grid grid-cols-2 gap-2 border-b p-3 sm:flex sm:flex-wrap sm:items-center";
export const FILTER_SEARCH = "relative col-span-2 sm:min-w-[220px] sm:flex-1";

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "default", className }) {
  const toneClass = {
    default: "text-muted-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    bad: "text-red-600 dark:text-red-400",
    warn: "text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="tabular mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
        {hint && <p className={cn("mt-1 text-xs", toneClass)}>{hint}</p>}
      </CardContent>
    </Card>
  );
}

const BILL_STATUS = {
  draft: { label: "Draft", variant: "secondary" },
  pending: { label: "Awaiting UPI", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  part_paid: { label: "Part-paid", variant: "warning" },
  credit: { label: "Credit", variant: "destructive" },
  returned: { label: "Returned", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

export function BillStatusBadge({ status }) {
  const s = BILL_STATUS[status] || { label: status, variant: "outline" };
  return <Badge variant={s.variant}>{t(s.label)}</Badge>;
}

const MATCH_STATUS = {
  matched: { label: "Matched", variant: "success" },
  manual: { label: "Manual (UTR)", variant: "info" },
  mismatch: { label: "Amount mismatch", variant: "warning" },
  overpaid: { label: "Overpaid", variant: "warning" },
  unlinked: { label: "Unlinked", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
};

export function MatchBadge({ status }) {
  const s = MATCH_STATUS[status] || { label: status, variant: "outline" };
  return <Badge variant={s.variant}>{t(s.label)}</Badge>;
}

const UPI_STATUS = {
  active: { label: "Waiting", variant: "info" },
  paid: { label: "Paid", variant: "success" },
  partially_paid: { label: "Part-paid", variant: "warning" },
  failed: { label: "Failed", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

export function UpiStatusBadge({ status }) {
  const s = UPI_STATUS[status] || { label: status, variant: "outline" };
  return <Badge variant={s.variant}>{t(s.label)}</Badge>;
}

export function ModeBadge({ mode, kind }) {
  if (kind === "refund") return <Badge variant="warning">{t("Refund")} · {mode.toUpperCase()}</Badge>;
  if (kind === "writeoff" || mode === "writeoff") return <Badge variant="secondary">{t("Write-off")}</Badge>;
  return <Badge variant={mode === "upi" ? "info" : "outline"}>{mode.toUpperCase()}</Badge>;
}

export function EmptyState({ icon: Icon = Search, title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-4 py-12 text-center", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = t("Loading…"), className }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorAlert({ message, className }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function Field({ label, hint, children, className, htmlFor }) {
  // Link the label to a single child control so clicks and screen readers work without wiring ids by hand.
  const autoId = useId();
  let id = htmlFor;
  let control = children;
  if (!id && isValidElement(children) && children.props.id === undefined && children.props.onValueChange === undefined) {
    id = autoId;
    control = cloneElement(children, { id });
  }
  return (
    <div className={cn("grid min-w-0 grid-cols-1 gap-1.5", className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {control}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ConfirmDialog({ trigger, title, description, confirmLabel = t("Confirm"), variant = "default", onConfirm, disabled }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction variant={variant} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Page numbers to show: all of them when few, else first, last and the neighbours of the current page. */
function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return shown.flatMap((p, i) => (i && p - shown[i - 1] > 1 ? ["…", p] : [p]));
}

/** Footer for a paged list. Pass onPageSize to add a rows-per-page picker (the bar then stays visible on one page). */
export function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [10, 20, 50, 100] }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (!total || (pages <= 1 && !onPageSize)) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        {onPageSize && (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">{t("Rows per page")}</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[72px]" aria-label={t("Rows per page")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <span className="tabular">
          {t("{from}–{to} of {total}", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Previous page")}>
          <ChevronLeft />
        </Button>
        <span className="tabular px-2 sm:hidden">
          {page} / {pages}
        </span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageNumbers(page, pages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "ghost"}
                size="icon"
                className="tabular h-8 w-8"
                onClick={() => onPage(p)}
                aria-label={t("Page {n}", { n: p })}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </Button>
            )
          )}
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("Next page")}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** New-customer form used from billing and the customers page. */
export function CustomerFormDialog({ open, onOpenChange, onSaved, initial, allowOpeningBalance }) {
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name || "",
        mobile: initial?.mobile || "",
        email: initial?.email || "",
        address: initial?.address || "",
        opening_balance: "",
        vpa: "",
        whatsapp_consent: initial?.whatsapp_consent ?? true,
        notes: initial?.notes || "",
      });
      setError(null);
    }
  }, [open, initial]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let res;
      if (editing) {
        res = await api.put(`/api/customers/${initial.id}`, {
          name: form.name, mobile: form.mobile, email: form.email, address: form.address,
          whatsapp_consent: form.whatsapp_consent, notes: form.notes,
        });
      } else {
        res = await api.post("/api/customers", {
          name: form.name, mobile: form.mobile, email: form.email || null, address: form.address || null,
          opening_balance: Number(form.opening_balance || 0), whatsapp_consent: form.whatsapp_consent,
          notes: form.notes || null, vpas: form.vpa ? [form.vpa.trim()] : [],
        });
      }
      toast.success(editing ? t("Customer updated") : t("Customer {name} added", { name: res.data.name }));
      onSaved?.(res.data);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit customer") : t("New customer")}</DialogTitle>
          <DialogDescription>{t("Mobile number is the unique key for each customer.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <ErrorAlert message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Name")} htmlFor="c-name">
              <Input id="c-name" value={form.name || ""} onChange={set("name")} required autoFocus />
            </Field>
            <Field label={t("Mobile")} htmlFor="c-mobile">
              <Input id="c-mobile" inputMode="tel" value={form.mobile || ""} onChange={set("mobile")} placeholder={t("10-digit number")} required />
            </Field>
          </div>
          {!editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("UPI ID (optional)")} htmlFor="c-vpa" hint={t("Payments from this UPI ID auto-link to the customer")}>
                <Input id="c-vpa" value={form.vpa || ""} onChange={set("vpa")} placeholder={t("name@okaxis")} />
              </Field>
              {allowOpeningBalance && (
                <Field label={t("Opening balance (₹)")} htmlFor="c-ob" hint={t("Dues from the paper book")}>
                  <Input id="c-ob" type="number" min="0" step="0.01" value={form.opening_balance ?? ""} onChange={set("opening_balance")} />
                </Field>
              )}
            </div>
          )}
          <Field label={t("Address (optional)")} htmlFor="c-addr">
            <Input id="c-addr" value={form.address || ""} onChange={set("address")} />
          </Field>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={Boolean(form.whatsapp_consent)} onCheckedChange={set("whatsapp_consent")} />
            <span className="text-sm">
              <span className="font-medium">{t("Consent for WhatsApp / SMS")}</span>
              <span className="block text-muted-foreground">{t("Customer agreed to receive bills and due reminders (DPDP Act 2023).")}</span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} {editing ? t("Save") : t("Add customer")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Find a customer by mobile or name (FR-05). value = customer object or null (walk-in). */
export function CustomerPicker({ value, onChange, allowOpeningBalance = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q, 250);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    api
      .get("/api/customers", { params: { q: dq || undefined, limit: 20 } })
      .then((r) => alive && setResults(r.data))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, open]);

  return (
    <>
      <div className="flex min-w-0 gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-10 min-w-0 flex-1 justify-start gap-2 px-3 text-left font-normal">
              <UserRound className="text-muted-foreground" />
              {value ? (
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{value.name}</span>
                  <span className="text-muted-foreground"> · {value.mobile}</span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{t("Walk-in customer (search to select)")}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,380px)] p-0" align="start">
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Mobile number or name…")}
                className="h-10 flex-1 bg-transparent text-sm outline-none"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {results.length === 0 && !loading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("No customers found")}</p>}
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.mobile}</span>
                  </span>
                  {c.due > 0 && <Badge variant="destructive">{t("Due {amount}", { amount: formatINR(c.due) })}</Badge>}
                  {c.advance > 0 && <Badge variant="success">{t("Adv {amount}", { amount: formatINR(c.advance) })}</Badge>}
                </button>
              ))}
            </div>
            <div className="border-t p-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <UserPlus className="h-4 w-4" /> {t("Add new customer")}
              </button>
            </div>
          </PopoverContent>
        </Popover>
        {value && (
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => onChange(null)} aria-label={t("Remove customer")}>
            <X />
          </Button>
        )}
      </div>
      <CustomerFormDialog
        open={creating}
        onOpenChange={setCreating}
        allowOpeningBalance={allowOpeningBalance}
        onSaved={(c) => onChange(c)}
      />
    </>
  );
}

/** Product search box with keyboard support. `products` is the cached catalogue. */
export function ProductSearch({ products, onPick, placeholder = t("Search product by name…"), className, autoFocus }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(term) || (p.barcode || "").includes(term))
      .slice(0, 8);
  }, [q, products]);

  useEffect(() => {
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p) => {
    onPick(p);
    setQ("");
    setOpen(false);
    setActive(0);
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="h-10 pl-9"
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                i === active && "bg-accent"
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.barcode || t("no barcode")} · {t("stock {qty} {unit}", { qty: p.stock_qty, unit: p.unit })}
                </span>
              </span>
              <span className="tabular font-medium">{formatINR(p.selling_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionTitle({ children, className }) {
  return <h2 className={cn("text-sm font-semibold uppercase tracking-wide text-muted-foreground", className)}>{children}</h2>;
}
