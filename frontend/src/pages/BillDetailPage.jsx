import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, MessageSquare, Pencil, Printer, QrCode, ReceiptText, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatINR, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveTable } from "@/components/data-table";
import { UpiQrPanel } from "@/components/UpiQrPanel";
import {
  BillStatusBadge, ConfirmDialog, ErrorAlert, Field, Loading, MatchBadge, ModeBadge, UpiStatusBadge,
} from "@/components/common";
import { t, tx } from "@/i18n";

function ReturnDialog({ bill, open, onOpenChange, onDone }) {
  const [qtys, setQtys] = useState({});
  const [mode, setMode] = useState("cash");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setQtys({});
      setReason("");
      setError(null);
      setMode(bill.customer_id && bill.due_amount > 0 ? "ledger" : "cash");
    }
  }, [open, bill]);

  const submit = async () => {
    const items = Object.entries(qtys)
      .filter(([, q]) => Number(q) > 0)
      .map(([id, q]) => ({ bill_item_id: Number(id), qty: Number(q) }));
    if (!items.length) return setError(t("Enter a quantity for at least one item"));
    setBusy(true);
    try {
      const r = await api.post(`/api/bills/${bill.id}/returns`, { items, refund_mode: mode, reason: reason || null });
      toast.success(t("Return {no}: {amount}", { no: r.data.return_no, amount: formatINR(r.data.amount) }), {
        description:
          r.data.refund_amount > 0
            ? t("Give back {amount} by {mode}", { amount: formatINR(r.data.refund_amount), mode: mode.toUpperCase() })
            : t("Adjusted in the customer's ledger"),
      });
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Sales return")}</DialogTitle>
          <DialogDescription>{t("Returned items go back into stock and the bill amount is reversed.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {bill.items.map((i) => {
            const max = i.qty - i.returned_qty;
            return (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Sold {sold} · returned {returned} · {price} each", {
                      sold: formatNumber(i.qty),
                      returned: formatNumber(i.returned_qty),
                      price: formatINR(i.unit_price),
                    })}
                  </p>
                </div>
                <Input
                  type="number"
                  min="0"
                  max={max}
                  step="any"
                  disabled={max <= 0}
                  value={qtys[i.id] ?? ""}
                  onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })}
                  className="h-8 w-20 text-right"
                  placeholder="0"
                  aria-label={t("Return quantity for {name}", { name: i.product_name })}
                />
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Money back as")}>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{t("Cash refund")}</SelectItem>
                <SelectItem value="upi">{t("UPI refund")}</SelectItem>
                {bill.customer_id && <SelectItem value="ledger">{t("Credit to customer ledger")}</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("Reason")}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Damaged, expired…")} />
          </Field>
        </div>
        <ErrorAlert message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Undo2 /> {t("Record return")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualUpiDialog({ bill, open, onOpenChange, onDone }) {
  const [form, setForm] = useState({ amount: "", utr: "", payer_vpa: "", payer_name: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ amount: String(bill.due_amount || ""), utr: "", payer_vpa: "", payer_name: "" });
      setError(null);
    }
  }, [open, bill]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/bills/${bill.id}/manual-upi`, { ...form, amount: Number(form.amount) });
      toast.success(t("UPI payment recorded"));
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Mark paid with UTR")}</DialogTitle>
          <DialogDescription>{t("For a customer who paid to the old static QR. Check the UTR in your bank app first.")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Amount ₹")}>
              <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </Field>
            <Field label={t("UTR / transaction ID")}>
              <Input value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value })} required minLength={6} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Payer UPI ID")}>
              <Input value={form.payer_vpa} onChange={(e) => setForm({ ...form, payer_vpa: e.target.value })} placeholder={t("optional")} />
            </Field>
            <Field label={t("Payer name")}>
              <Input value={form.payer_name} onChange={(e) => setForm({ ...form, payer_name: e.target.value })} placeholder={t("optional")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {t("Record payment")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOwner, settings } = useAuth();
  const { data: bill, loading, error, reload } = useFetch(`/api/bills/${id}`);
  const [returnOpen, setReturnOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [qr, setQr] = useState(null);

  if (loading && !bill) return <Loading />;
  if (error) return <ErrorAlert message={error} />;
  if (!bill) return null;

  const open = ["draft", "pending"].includes(bill.status);
  const completed = Boolean(bill.completed_at);

  const share = async (channel) => {
    try {
      const r = await api.get(`/api/bills/${bill.id}/share`, { params: { channel } });
      window.open(r.data.url, "_blank", "noopener");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const collectQr = async () => {
    try {
      const r = await api.post(`/api/bills/${bill.id}/upi-qr`);
      setQr(r.data);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const cancel = async () => {
    try {
      const r = await api.delete(`/api/bills/${bill.id}`);
      toast.success(r.data.result === "deleted" ? t("Draft deleted") : t("Bill cancelled"));
      if (r.data.result === "deleted") navigate("/bills");
      else reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-1" onClick={() => navigate(-1)}>
            <ArrowLeft /> {t("Back")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{bill.bill_no || t("Draft #{id}", { id: bill.id })}</h1>
            <BillStatusBadge status={bill.status} />
            {bill.bill_type === "opening" && <Badge variant="secondary">{t("Opening balance")}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateTime(bill.completed_at || bill.created_at)} · {t("by {name}", { name: bill.created_by || "—" })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*:only-child]:col-span-2">
          {open && (
            <Button asChild>
              <Link to={`/pos/${bill.id}`}>
                <Pencil /> {bill.status === "pending" ? t("Resume payment") : t("Continue billing")}
              </Link>
            </Button>
          )}
          {completed && bill.due_amount > 0 && (
            <Button onClick={collectQr} className="col-span-2 sm:col-span-1">
              <QrCode /> {t("Collect {amount} by UPI", { amount: formatINR(bill.due_amount) })}
            </Button>
          )}
          {completed && bill.bill_type === "sale" && (
            <>
              <Button variant="outline" asChild>
                <a href={`/bills/${bill.id}/receipt?print=1`} target="_blank" rel="noreferrer">
                  <Printer /> {t("Receipt")}
                </a>
              </Button>
              <Button variant="outline" onClick={() => share("whatsapp")} disabled={!bill.customer_mobile}>
                <Send /> {t("WhatsApp")}
              </Button>
              <Button variant="outline" onClick={() => share("sms")} disabled={!bill.customer_mobile}>
                <MessageSquare /> {t("SMS")}
              </Button>
            </>
          )}
          {isOwner && completed && bill.bill_type === "sale" && bill.status !== "returned" && (
            <Button variant="outline" onClick={() => setReturnOpen(true)}>
              <Undo2 /> {t("Return items")}
            </Button>
          )}
          {isOwner && (bill.status === "pending" || (completed && bill.due_amount > 0)) && (
            <Button variant="outline" onClick={() => setManualOpen(true)}>
              <ReceiptText /> {t("Mark paid with UTR")}
            </Button>
          )}
          {open && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" className="text-red-700 dark:text-red-400">
                  <Ban /> {bill.status === "draft" ? t("Delete draft") : t("Cancel bill")}
                </Button>
              }
              title={bill.status === "draft" ? t("Delete this draft?") : t("Cancel this bill?")}
              description={
                bill.status === "draft"
                  ? t("The draft and its items are removed. This is recorded in the audit log.")
                  : t("Any money already taken on this bill is recorded as refunded. This is recorded in the audit log.")
              }
              confirmLabel={bill.status === "draft" ? t("Delete") : t("Cancel bill")}
              variant="destructive"
              onConfirm={cancel}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("Items")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ResponsiveTable
              rows={bill.items}
              inset
              empty={
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {bill.bill_type === "opening" ? bill.notes || t("Opening balance carried from the paper book") : t("No items")}
                </p>
              }
              columns={[
                {
                  key: "product", header: t("Product"), primary: true,
                  cell: (i) => (
                    <>
                      <span className="font-medium">{i.product_name}</span>
                      {i.returned_qty > 0 && <Badge variant="warning" className="ml-2">{t("{n} returned", { n: formatNumber(i.returned_qty) })}</Badge>}
                      {i.barcode && <span className="block font-mono text-xs text-muted-foreground">{i.barcode}</span>}
                    </>
                  ),
                },
                { key: "qty", header: t("Qty"), align: "right", className: "tabular", cell: (i) => `${formatNumber(i.qty)} ${i.unit}` },
                { key: "price", header: t("Price"), align: "right", className: "tabular", cell: (i) => formatINR(i.unit_price) },
                { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (i) => <span className="tabular font-medium">{formatINR(i.line_total)}</span> },
              ]}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-2 p-5 text-sm">
              {[
                ["Subtotal", bill.subtotal],
                ["Discount", -bill.discount],
                ["Total", bill.total, true],
                ["Returned", -bill.returned_amount],
                ["Paid", bill.paid_amount],
              ].map(([label, value, strong]) =>
                value === 0 && !strong && label !== "Paid" ? null : (
                  <div key={label} className="flex justify-between">
                    <span className={strong ? "font-medium" : "text-muted-foreground"}>{t(label)}</span>
                    <span className={`tabular ${strong ? "text-lg font-semibold" : ""}`}>{formatINR(value)}</span>
                  </div>
                )
              )}
              <div className="mt-1 flex justify-between border-t pt-3">
                <span className="font-medium">{t("Due")}</span>
                <span className={`tabular text-lg font-semibold ${bill.due_amount > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatINR(bill.due_amount)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("Customer")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {bill.customer ? (
                <Link to={`/customers/${bill.customer.id}`} className="block rounded-md border p-3 hover:bg-accent">
                  <span className="block font-medium">{bill.customer.name}</span>
                  <span className="text-muted-foreground">{bill.customer.mobile}</span>
                  <span className="mt-1 block">
                    {tx("Ledger balance: {amount}", {
                      amount: (
                        <b className={bill.customer.balance > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                          {formatINR(bill.customer.balance)}
                        </b>
                      ),
                    })}
                  </span>
                </Link>
              ) : (
                <p className="text-muted-foreground">{t("Walk-in customer")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Payments")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <ResponsiveTable
            rows={bill.payments}
            inset
            columns={[
              { key: "time", header: t("Time"), className: "whitespace-nowrap text-muted-foreground", cell: (p) => formatDateTime(p.created_at) },
              { key: "mode", header: t("Mode"), primary: true, cell: (p) => <ModeBadge mode={p.mode} kind={p.kind} /> },
              { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (p) => <span className="tabular font-medium">{formatINR(p.amount)}</span> },
              { key: "utr", header: t("UTR"), cell: (p) => <span className="font-mono text-xs">{p.utr || "—"}</span> },
              {
                key: "payer", header: t("Payer"), className: "text-sm",
                cell: (p) => (
                  <>
                    {p.payer_vpa || "—"}
                    {p.payer_name && <span className="block text-xs text-muted-foreground">{p.payer_name}</span>}
                  </>
                ),
              },
              { key: "status", header: t("Status"), aside: true, cell: (p) => <MatchBadge status={p.match_status} /> },
            ]}
          />
          {!bill.payments.length && (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              {bill.paid_amount > 0
                ? t("{amount} was settled from the customer's later due payments (oldest bill is settled first).", { amount: formatINR(bill.paid_amount) })
                : t("No payments recorded against this bill")}
            </p>
          )}
          {bill.payments.length > 0 &&
            bill.customer_id &&
            bill.paid_amount > bill.payments.filter((p) => p.gateway_status === "success").reduce((sum, p) => sum + p.amount, 0) + 0.009 && (
              <p className="border-t px-5 py-3 text-center text-sm text-muted-foreground">
                {t("The rest was settled from the customer's later due payments (oldest bill first).")}
              </p>
            )}
        </CardContent>
      </Card>

      {(bill.upi_requests.length > 0 || bill.returns.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {bill.upi_requests.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("UPI QR history")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {bill.upi_requests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs">{r.ref}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(r.created_at)}
                        {r.closed_reason ? ` · ${r.closed_reason}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular">{formatINR(r.amount)}</span>
                      <UpiStatusBadge status={r.status} />
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {bill.returns.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("Returns")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {bill.returns.map((r) => (
                  <div key={r.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{r.return_no}</span>
                      <span className="tabular">{formatINR(r.amount)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(r.created_at)} · {r.refund_mode === "ledger"
                        ? t("Ledger credit")
                        : t("{mode} refund {amount}", { mode: r.refund_mode.toUpperCase(), amount: formatINR(r.refund_amount) })}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </p>
                    <p className="text-xs">{r.items.map((i) => `${i.product_name} × ${formatNumber(i.qty)}`).join(", ")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ReturnDialog bill={bill} open={returnOpen} onOpenChange={setReturnOpen} onDone={reload} />
      <ManualUpiDialog bill={bill} open={manualOpen} onOpenChange={setManualOpen} onDone={reload} />
      <Dialog open={Boolean(qr)} onOpenChange={(o) => { if (!o) { setQr(null); reload(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Collect by UPI")}</DialogTitle>
            <DialogDescription>{t("The customer scans this QR; the bill updates as soon as the gateway confirms.")}</DialogDescription>
          </DialogHeader>
          {qr && <UpiQrPanel request={qr} allowSimulate={settings?.gateway_is_mock} onNewQr={collectQr} onPaid={() => reload()} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
