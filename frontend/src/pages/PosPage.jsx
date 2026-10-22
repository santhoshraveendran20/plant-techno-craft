import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, Banknote, Camera, CheckCircle2, ClipboardList, CloudUpload, HandCoins, Loader2, Minus, Plus,
  Printer, QrCode, ScanBarcode, Send, ShoppingCart, Split, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useOnline } from "@/hooks/useOnline";
import { api, errorMessage } from "@/lib/api";
import { playError } from "@/lib/sound";
import { cn, formatINR, round2 } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BarcodeScannerDialog } from "@/components/BarcodeScanner";
import { UpiQrPanel } from "@/components/UpiQrPanel";
import { BillStatusBadge, CustomerPicker, ErrorAlert, ProductSearch } from "@/components/common";

const CART_KEY = "pos-cart-v1";
const PRODUCTS_KEY = "pos-products-v1";
const OFFLINE_KEY = "pos-offline-drafts-v1";

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  },
};

const newRef = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const emptyCart = () => ({ items: [], customer: null, discount: "", discountMode: "amount", billId: null, billNo: null, billStatus: null, clientRef: newRef() });

function computeTotals(cart) {
  const subtotal = round2(cart.items.reduce((s, i) => s + round2(i.qty * i.price), 0));
  const raw = Number(cart.discount || 0);
  const discount = Math.min(subtotal, round2(cart.discountMode === "percent" ? (subtotal * raw) / 100 : raw));
  return { subtotal, discount: Math.max(0, discount), total: round2(subtotal - Math.max(0, discount)) };
}

/* ------------------------------------------------------------------ checkout */

function CheckoutDialog({ open, onOpenChange, cart, totals, ensureBill, onFinished, settings }) {
  const [step, setStep] = useState("pay");
  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState("");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bill, setBill] = useState(null);
  const [qr, setQr] = useState(null);
  const [paidSoFar, setPaidSoFar] = useState(0);

  const due = round2(totals.total - paidSoFar);
  const cashN = Number(cash || 0);
  const upiN = Number(upi || 0);
  const credit = round2(due - cashN - upiN);
  const hasCustomer = Boolean(cart.customer);

  const preset = useCallback(
    (mode, remaining) => {
      setError(null);
      setTendered("");
      if (mode === "cash") {
        setCash(String(remaining));
        setUpi("");
      } else if (mode === "upi") {
        setUpi(String(remaining));
        setCash("");
      } else if (mode === "credit") {
        setCash("");
        setUpi("");
      } else {
        const half = round2(remaining / 2);
        setCash(String(half));
        setUpi(String(round2(remaining - half)));
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep("pay");
    setQr(null);
    setBill(null);
    setPaidSoFar(0);
    preset("upi", totals.total);
    // a bill already waiting for UPI: reopen its live QR
    if (cart.billId && cart.billStatus === "pending") {
      api
        .get(`/api/bills/${cart.billId}`)
        .then((r) => {
          setBill(r.data);
          const paid = r.data.payments.filter((p) => p.gateway_status === "success").reduce((s, p) => s + p.amount, 0);
          setPaidSoFar(round2(paid));
          const live = r.data.upi_requests.find((q) => ["active", "failed", "partially_paid"].includes(q.status));
          if (r.data.status === "pending" && live) {
            setQr(live);
            setStep("qr");
          } else if (r.data.status !== "pending" && r.data.status !== "draft") {
            setStep("done");
          } else {
            preset("upi", round2(r.data.total - paid));
          }
        })
        .catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    setError(null);
    if (cashN < 0 || upiN < 0) return setError("Amounts cannot be negative");
    if (credit < -0.009) return setError("Cash + UPI is more than the amount due");
    if (credit > 0.009 && !hasCustomer) return setError("Walk-in bills must be fully paid. Select a customer to give credit.");
    setBusy(true);
    try {
      // A pending bill that already has money on it cannot be edited - just take the rest.
      const billId = bill?.status === "pending" && paidSoFar > 0 ? bill.id : await ensureBill();
      const res = await api.post(`/api/bills/${billId}/checkout`, { cash_amount: cashN, upi_amount: upiN });
      setBill(res.data.bill);
      if (res.data.stock_warnings?.length) {
        toast.warning(`Sold more than stock for ${res.data.stock_warnings.map((w) => w.name).join(", ")}`);
      }
      if (res.data.upi_request) {
        setQr(res.data.upi_request);
        setStep("qr");
        onFinished?.(res.data.bill, false);
      } else {
        setStep("done");
        onFinished?.(res.data.bill, true);
      }
    } catch (e) {
      playError();
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshBill = async (billId) => {
    const r = await api.get(`/api/bills/${billId}`);
    setBill(r.data);
    return r.data;
  };

  const newQr = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/bills/${bill.id}/upi-qr`);
      setQr(r.data);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const switchToOtherMode = async () => {
    const b = await refreshBill(bill.id);
    const paid = b.payments.filter((p) => p.gateway_status === "success").reduce((s, p) => s + p.amount, 0);
    setPaidSoFar(round2(paid));
    preset("cash", round2(b.total - paid));
    setQr(null);
    setStep("pay");
  };

  const share = async () => {
    try {
      const r = await api.get(`/api/bills/${bill.id}/share`, { params: { channel: "whatsapp" } });
      window.open(r.data.url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const change = tendered ? round2(Number(tendered) - cashN) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => step === "qr" && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {step === "pay" && "Take payment"}
            {step === "qr" && "Scan to pay with any UPI app"}
            {step === "done" && "Bill completed"}
          </DialogTitle>
          <DialogDescription>
            {step === "pay" && (hasCustomer ? `Customer: ${cart.customer.name}` : "Walk-in customer")}
            {step === "qr" && "Payment is confirmed automatically by the gateway."}
            {step === "done" && bill?.bill_no}
          </DialogDescription>
        </DialogHeader>

        {step === "pay" && (
          <div className="grid gap-4">
            <div className="rounded-lg bg-muted/60 p-4 text-center">
              <p className="text-sm text-muted-foreground">{paidSoFar > 0 ? `Remaining (paid ${formatINR(paidSoFar)})` : "Amount to pay"}</p>
              <p className="tabular text-4xl font-semibold tracking-tight">{formatINR(due)}</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Button variant="outline" className="h-14 flex-col gap-1 text-xs" onClick={() => preset("upi", due)}>
                <QrCode /> UPI
              </Button>
              <Button variant="outline" className="h-14 flex-col gap-1 text-xs" onClick={() => preset("cash", due)}>
                <Banknote /> Cash
              </Button>
              <Button variant="outline" className="h-14 flex-col gap-1 text-xs" onClick={() => preset("credit", due)} disabled={!hasCustomer} title={hasCustomer ? "" : "Select a customer first"}>
                <HandCoins /> Credit
              </Button>
              <Button variant="outline" className="h-14 flex-col gap-1 text-xs" onClick={() => preset("split", due)}>
                <Split /> Split
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="co-cash">Cash ₹</Label>
                <Input id="co-cash" type="number" min="0" step="0.01" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="co-upi">UPI ₹</Label>
                <Input id="co-upi" type="number" min="0" step="0.01" inputMode="decimal" value={upi} onChange={(e) => setUpi(e.target.value)} />
              </div>
            </div>
            {cashN > 0 && (
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="co-tendered">Cash received ₹</Label>
                  <Input id="co-tendered" type="number" min="0" step="1" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(cashN)} />
                </div>
                <p className={cn("pb-2 text-sm", change < 0 ? "text-red-600" : "text-muted-foreground")}>
                  {tendered ? (change >= 0 ? <>Return change <b className="tabular text-foreground">{formatINR(change)}</b></> : "Less than cash amount") : "Optional: for change"}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm">
              <span className="text-muted-foreground">On credit (customer pays later)</span>
              <span className={cn("tabular font-semibold", credit > 0.009 && "text-red-600")}>{formatINR(Math.max(0, credit))}</span>
            </div>
            <ErrorAlert message={error} />
            <Button size="lg" onClick={confirm} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {upiN > 0 ? `Show UPI QR for ${formatINR(upiN)}` : "Complete bill"}
            </Button>
          </div>
        )}

        {step === "qr" && qr && (
          <div className="grid gap-4">
            <UpiQrPanel
              request={qr}
              allowSimulate={settings?.gateway_is_mock}
              onNewQr={newQr}
              onPaid={async () => {
                const b = await refreshBill(qr.bill_id);
                setStep("done");
                onFinished?.(b, true);
              }}
            />
            <Button variant="outline" onClick={switchToOtherMode} disabled={busy} className="h-auto min-h-9 whitespace-normal py-2">
              Collect the rest another way (cash / credit)
            </Button>
          </div>
        )}

        {step === "done" && bill && (
          <div className="grid gap-4">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-emerald-50 py-6 text-emerald-800 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-12 w-12 animate-pop-in text-emerald-600" />
              <p className="tabular text-2xl font-semibold">{formatINR(bill.total)}</p>
              <BillStatusBadge status={bill.status} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border px-3 py-2">
                <p className="text-muted-foreground">Paid</p>
                <p className="tabular font-semibold">{formatINR(bill.paid_amount)}</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-muted-foreground">Due (credit)</p>
                <p className="tabular font-semibold">{formatINR(bill.due_amount)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" asChild>
                <a href={`/bills/${bill.id}/receipt?print=1`} target="_blank" rel="noreferrer">
                  <Printer /> Print receipt
                </a>
              </Button>
              <Button variant="outline" onClick={share} disabled={!bill.customer_mobile}>
                <Send /> WhatsApp bill
              </Button>
            </div>
            <Button size="lg" onClick={() => onOpenChange(false)}>
              New bill
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ page */

export default function PosPage() {
  const { settings, isOwner } = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const { billId: routeBillId } = useParams();
  const [products, setProducts] = useState(() => store.get(PRODUCTS_KEY, []));
  const [cart, setCart] = useState(() => store.get(CART_KEY, null) || emptyCart());
  const [scan, setScan] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [offlineDrafts, setOfflineDrafts] = useState(() => store.get(OFFLINE_KEY, []));
  const scanRef = useRef(null);
  const totals = useMemo(() => computeTotals(cart), [cart]);
  const allowZeroStock = settings?.allow_zero_stock_sale ?? true;

  useEffect(() => store.set(CART_KEY, cart), [cart]);

  const loadProducts = useCallback(async () => {
    try {
      const r = await api.get("/api/products");
      setProducts(r.data);
      store.set(PRODUCTS_KEY, r.data);
    } catch {
      /* offline: keep using the cached catalogue */
    }
  }, []);
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Sync drafts that were saved while offline (NFR: offline drafts)
  const syncOffline = useCallback(async () => {
    const pending = store.get(OFFLINE_KEY, []);
    if (!pending.length) return;
    try {
      const r = await api.post("/api/bills/sync-drafts", { drafts: pending });
      const failed = r.data.results.filter((x) => x.status === "error");
      const remaining = pending.filter((d) => failed.some((f) => f.client_ref === d.client_ref));
      store.set(OFFLINE_KEY, remaining);
      setOfflineDrafts(remaining);
      const synced = r.data.results.length - failed.length;
      if (synced) toast.success(`${synced} offline draft${synced > 1 ? "s" : ""} synced`);
      if (failed.length) toast.error(`${failed.length} draft(s) could not sync: ${failed[0].error}`);
    } catch {
      /* still offline */
    }
  }, []);
  useEffect(() => {
    if (online) syncOffline();
  }, [online, syncOffline]);

  // Resume a draft / pending bill from the URL
  useEffect(() => {
    if (!routeBillId) return;
    api
      .get(`/api/bills/${routeBillId}`)
      .then((r) => {
        const b = r.data;
        if (!["draft", "pending"].includes(b.status)) {
          toast.info(`Bill ${b.bill_no} is already ${b.status}`);
          navigate(`/bills/${b.id}`, { replace: true });
          return;
        }
        setCart({
          items: b.items.map((i) => ({
            product_id: i.product_id, name: i.product_name, barcode: i.barcode, unit: i.unit, price: i.unit_price,
            qty: i.qty, stock: i.stock_qty,
          })),
          customer: b.customer || null,
          discount: b.discount ? String(b.discount) : "",
          discountMode: "amount",
          billId: b.id,
          billNo: b.bill_no,
          billStatus: b.status,
          clientRef: newRef(),
        });
        if (b.status === "pending") setCheckoutOpen(true);
        navigate("/pos", { replace: true });
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [routeBillId, navigate]);

  const addProduct = useCallback(
    (p, qty = 1) => {
      setCart((c) => {
        const existing = c.items.find((i) => i.product_id === p.id);
        const nextQty = round2((existing?.qty || 0) + qty);
        if (nextQty > p.stock_qty) {
          if (!allowZeroStock) {
            playError();
            toast.error(`${p.name}: only ${p.stock_qty} in stock. Selling without stock is blocked.`);
            return c;
          }
          toast.warning(`${p.name}: only ${p.stock_qty} ${p.unit} in stock`, { description: "You can still sell it (allowed in settings)." });
        }
        const items = existing
          ? c.items.map((i) => (i.product_id === p.id ? { ...i, qty: nextQty, stock: p.stock_qty } : i))
          : [...c.items, { product_id: p.id, name: p.name, barcode: p.barcode, unit: p.unit, price: p.selling_price, qty, stock: p.stock_qty }];
        return { ...c, items };
      });
    },
    [allowZeroStock]
  );

  const lookupBarcode = useCallback(
    async (code) => {
      const value = code.trim();
      if (!value) return;
      let p = products.find((x) => x.barcode === value);
      if (!p) {
        try {
          p = (await api.get(`/api/products/barcode/${encodeURIComponent(value)}`)).data;
        } catch (e) {
          playError();
          toast.error(e.response?.status === 404 ? `No product with barcode ${value}` : errorMessage(e));
          return;
        }
      }
      addProduct(p);
    },
    [products, addProduct]
  );

  const setQty = (pid, qty) => {
    setCart((c) => ({ ...c, items: c.items.map((i) => (i.product_id === pid ? { ...i, qty } : i)) }));
  };
  const removeItem = (pid) => setCart((c) => ({ ...c, items: c.items.filter((i) => i.product_id !== pid) }));
  const clearCart = () => setCart(emptyCart());

  const billBody = () => ({
    customer_id: cart.customer?.id || null,
    discount: totals.discount,
    items: cart.items.filter((i) => Number(i.qty) > 0).map((i) => ({ product_id: i.product_id, qty: Number(i.qty) })),
    client_ref: cart.billId ? undefined : cart.clientRef,
  });

  /** Create or update the server-side draft; returns the bill id. */
  const ensureBill = async () => {
    const body = billBody();
    if (!body.items.length) throw new Error("Cart is empty");
    let res;
    if (cart.billId) {
      res = await api.put(`/api/bills/${cart.billId}`, body);
    } else {
      res = await api.post("/api/bills", body);
    }
    setCart((c) => ({ ...c, billId: res.data.id, billNo: res.data.bill_no, billStatus: res.data.status }));
    return res.data.id;
  };

  const saveDraft = async () => {
    if (!cart.items.length) return;
    setSaving(true);
    try {
      await ensureBill();
      toast.success("Draft saved", { description: "Find it under Drafts to continue later." });
      clearCart();
    } catch (e) {
      if (!e.response) {
        const queued = [...store.get(OFFLINE_KEY, []), { ...billBody(), client_ref: cart.clientRef }];
        store.set(OFFLINE_KEY, queued);
        setOfflineDrafts(queued);
        toast.info("You are offline — draft saved on this device and will sync automatically.");
        clearCart();
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const openDrafts = async () => {
    setDraftsOpen(true);
    try {
      const r = await api.get("/api/bills", { params: { status: "draft,pending", page_size: 50 } });
      setDrafts(r.data.rows);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const startCheckout = () => {
    if (!cart.items.length) return;
    if (cart.items.some((i) => !(Number(i.qty) > 0))) {
      toast.error("Every item needs a quantity greater than zero");
      return;
    }
    if (!online) {
      toast.error("You are offline. Save the bill as a draft, or take cash and bill once online.");
      return;
    }
    setCheckoutOpen(true);
  };

  // Keyboard: F2 checkout, F4 save draft; keep the scan box focused for USB scanners
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        startCheckout();
      } else if (e.key === "F4") {
        e.preventDefault();
        saveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const maxPct = settings?.cashier_max_discount_pct ?? 10;
  const discountTooHigh = !isOwner && totals.subtotal > 0 && totals.discount > round2((totals.subtotal * maxPct) / 100);

  return (
    <div className="pb-24 md:pb-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Scan with a USB scanner or phone camera · <kbd className="rounded border px-1 text-xs">F2</kbd> checkout ·{" "}
            <kbd className="rounded border px-1 text-xs">F4</kbd> save draft
          </p>
        </div>
        <div className="flex gap-2">
          {offlineDrafts.length > 0 && (
            <Button variant="outline" size="sm" onClick={syncOffline} disabled={!online}>
              <CloudUpload /> {offlineDrafts.length} offline draft{offlineDrafts.length > 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={openDrafts}>
            <ClipboardList /> Drafts
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  lookupBarcode(scan);
                  setScan("");
                }}
              >
                <div className="relative flex-1">
                  <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={scanRef}
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    placeholder="Scan or type barcode, then Enter"
                    className="h-10 pl-9 font-mono"
                    autoFocus
                    inputMode="numeric"
                  />
                </div>
                <Button type="button" variant="outline" className="h-10" onClick={() => setCameraOpen(true)}>
                  <Camera /> <span className="hidden sm:inline">Camera</span>
                </Button>
              </form>
              <ProductSearch products={products} onPick={(p) => addProduct(p)} placeholder="…or search by product name" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-4 w-4" /> Items
                <Badge variant="secondary">{cart.items.length}</Badge>
                {cart.billNo && (
                  <span className="text-sm font-normal text-muted-foreground">
                    · {cart.billNo} {cart.billStatus && <BillStatusBadge status={cart.billStatus} />}
                  </span>
                )}
              </CardTitle>
              {cart.items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearCart}>
                  <Trash2 /> Clear
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {cart.items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 pb-10 pt-6 text-center text-muted-foreground">
                  <ScanBarcode className="h-10 w-10" />
                  <p className="font-medium text-foreground">Scan the first item</p>
                  <p className="text-sm">Items appear here with price and quantity.</p>
                </div>
              ) : (
                <ul className="divide-y border-t">
                  {cart.items.map((i) => {
                    const over = Number(i.qty) > Number(i.stock ?? Infinity);
                    return (
                      <li key={i.product_id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{i.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatINR(i.price)} / {i.unit}
                            {over && (
                              <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                                <AlertTriangle className="h-3 w-3" /> only {i.stock} in stock
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Decrease" onClick={() => setQty(i.product_id, Math.max(0, round2(Number(i.qty) - 1)))}>
                            <Minus />
                          </Button>
                          <Input
                            value={i.qty}
                            onChange={(e) => setQty(i.product_id, e.target.value === "" ? "" : Number(e.target.value))}
                            type="number"
                            min="0"
                            step="any"
                            className="h-8 w-16 text-center tabular"
                            aria-label={`Quantity of ${i.name}`}
                          />
                          <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Increase" onClick={() => addProduct({ id: i.product_id, name: i.name, unit: i.unit, stock_qty: i.stock ?? Infinity })}>
                            <Plus />
                          </Button>
                        </div>
                        <p className="tabular w-24 text-right font-semibold">{formatINR(round2(Number(i.qty || 0) * i.price))}</p>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Remove ${i.name}`} onClick={() => removeItem(i.product_id)}>
                          <Trash2 />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 md:sticky md:top-20 md:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <CustomerPicker value={cart.customer} onChange={(c) => setCart((x) => ({ ...x, customer: c }))} allowOpeningBalance={isOwner} />
              {cart.customer && (cart.customer.due > 0 || cart.customer.advance > 0) && (
                <p className="text-sm">
                  {cart.customer.due > 0 ? (
                    <span className="text-red-700">Previous due: <b className="tabular">{formatINR(cart.customer.due)}</b></span>
                  ) : (
                    <span className="text-emerald-700">Advance available: <b className="tabular">{formatINR(cart.customer.advance)}</b></span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 p-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular">{formatINR(totals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="discount" className="text-sm font-normal text-muted-foreground">
                  Discount
                </Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="discount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cart.discount}
                    onChange={(e) => setCart((c) => ({ ...c, discount: e.target.value }))}
                    className="h-8 w-24 text-right tabular"
                    placeholder="0"
                  />
                  <div className="flex rounded-md border p-0.5">
                    {["amount", "percent"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setCart((c) => ({ ...c, discountMode: m }))}
                        className={cn("rounded px-2 py-0.5 text-xs", cart.discountMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        {m === "amount" ? "₹" : "%"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {discountTooHigh && (
                <Alert variant="warning" className="py-2">
                  <AlertDescription className="text-xs">Discount above {maxPct}% needs the owner.</AlertDescription>
                </Alert>
              )}
              <Separator />
              <div className="flex items-end justify-between">
                <span className="font-medium">Total</span>
                <span className="tabular text-3xl font-semibold tracking-tight">{formatINR(totals.total)}</span>
              </div>
              <Button size="lg" className="mt-1 hidden md:flex" onClick={startCheckout} disabled={!cart.items.length || discountTooHigh}>
                {cart.billStatus === "pending" ? "Resume payment" : "Checkout"} <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">F2</kbd>
              </Button>
              <Button variant="outline" onClick={saveDraft} disabled={!cart.items.length || saving}>
                {saving && <Loader2 className="animate-spin" />} Save as draft
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* mobile checkout bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{cart.items.length} items</p>
            <p className="tabular text-xl font-semibold">{formatINR(totals.total)}</p>
          </div>
          <Button size="lg" onClick={startCheckout} disabled={!cart.items.length || discountTooHigh}>
            {cart.billStatus === "pending" ? "Resume payment" : "Checkout"}
          </Button>
        </div>
      </div>

      <BarcodeScannerDialog open={cameraOpen} onOpenChange={setCameraOpen} onDetected={lookupBarcode} continuous />

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={(o) => {
          setCheckoutOpen(o);
          if (!o) {
            setTimeout(() => scanRef.current?.focus(), 50);
          }
        }}
        cart={cart}
        totals={totals}
        settings={settings}
        ensureBill={ensureBill}
        onFinished={(bill, completed) => {
          if (completed) {
            setCart(emptyCart());
            loadProducts();
          } else {
            setCart((c) => ({ ...c, billId: bill.id, billNo: bill.bill_no, billStatus: bill.status }));
          }
        }}
      />

      <Sheet open={draftsOpen} onOpenChange={setDraftsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetTitle>Open bills</SheetTitle>
          <SheetDescription>Drafts and bills waiting for UPI payment.</SheetDescription>
          <div className="mt-4 grid gap-2">
            {drafts.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No open bills</p>}
            {drafts.map((b) => (
              <Link
                key={b.id}
                to={`/pos/${b.id}`}
                onClick={() => setDraftsOpen(false)}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{b.bill_no || `Draft #${b.id}`}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.customer_name || "Walk-in"} · {b.item_count} items
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-semibold">{formatINR(b.total)}</span>
                  <BillStatusBadge status={b.status} />
                </span>
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
