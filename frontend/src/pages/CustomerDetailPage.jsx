import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Banknote, BellRing, Copy, Link2, MessageSquare, MoreHorizontal, Pencil, Plus, QrCode, Send, Trash2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { useIsTabletUp } from "@/hooks/useMediaQuery";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatINR, lastMonths, sumByMonth } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupedBarChart } from "@/components/charts";
import { ResponsiveTable } from "@/components/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpiQrPanel } from "@/components/UpiQrPanel";
import {
  BillStatusBadge, CustomerFormDialog, ErrorAlert, Field, Loading, MatchBadge, ModeBadge, StatCard,
} from "@/components/common";
import { t } from "@/i18n";

function AmountDialog({ open, onOpenChange, title, description, defaultAmount, onSubmit, children, submitLabel = t("Continue") }) {
  const [amount, setAmount] = useState("");
  const [extra, setExtra] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setAmount(defaultAmount ? String(defaultAmount) : "");
      setExtra({});
      setError(null);
    }
  }, [open, defaultAmount]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onSubmit(Number(amount), extra);
              onOpenChange(false);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorAlert message={error} />
          <Field label={t("Amount ₹")}>
            <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          </Field>
          {children?.(extra, setExtra)}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOwner, settings } = useAuth();
  const customer = useFetch(`/api/customers/${id}`);
  const ledger = useFetch(`/api/customers/${id}/ledger`);
  const bills = useFetch(`/api/customers/${id}/bills`);
  const payments = useFetch(`/api/customers/${id}/payments`);
  const reminders = useFetch(isOwner ? `/api/customers/${id}/reminders` : null);
  const [dialog, setDialog] = useState(null);
  const [qr, setQr] = useState(null);
  const [link, setLink] = useState(null);
  const [newVpa, setNewVpa] = useState("");
  const [showAllLedger, setShowAllLedger] = useState(false);
  const wide = useIsTabletUp();
  const months = lastMonths(6);

  const c = customer.data;
  const reloadAll = () => {
    customer.reload();
    ledger.reload();
    bills.reload();
    payments.reload();
    reminders.reload();
  };

  if (customer.loading && !c) return <Loading />;
  if (customer.error) return <ErrorAlert message={customer.error} />;
  if (!c) return null;

  const remind = async (channel) => {
    try {
      const r = await api.post(`/api/customers/${c.id}/reminders`, { channel, include_link: true });
      window.open(r.data.url, "_blank", "noopener");
      toast.success(channel === "whatsapp" ? t("WhatsApp reminder ready") : t("SMS reminder ready"), { description: t("Send it from the window that opened.") });
      reloadAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addVpa = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/customers/${c.id}/vpas`, { vpa: newVpa.trim() });
      setNewVpa("");
      customer.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeVpa = async (vid) => {
    try {
      await api.delete(`/api/customers/${c.id}/vpas/${vid}`);
      customer.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("Link copied"));
    } catch {
      toast.error(t("Copy failed - select the link and copy it"));
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-3 mb-1" onClick={() => navigate(-1)}>
            <ArrowLeft /> {t("Back")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            {c.whatsapp_consent ? <Badge variant="success">{t("WhatsApp / SMS consent")}</Badge> : <Badge variant="secondary">{t("No message consent")}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.mobile}
            {c.address ? ` · ${c.address}` : ""} · {t("customer since {date}", { date: formatDate(c.created_at) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("pay")}>
            <Banknote /> {t("Receive payment")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("qr")}>
            <QrCode /> {t("UPI QR")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("link")}>
            <Link2 /> {t("Payment link")}
          </Button>
          {wide ? (
            <>
              {isOwner && c.due > 0 && (
                <>
                  <Button variant="outline" onClick={() => remind("whatsapp")} disabled={!c.whatsapp_consent}>
                    <Send /> {t("WhatsApp reminder")}
                  </Button>
                  <Button variant="outline" onClick={() => remind("sms")} disabled={!c.whatsapp_consent}>
                    <MessageSquare /> {t("SMS")}
                  </Button>
                  <Button variant="outline" onClick={() => setDialog("writeoff")}>
                    <XCircle /> {t("Write off")}
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setDialog("edit")}>
                <Pencil /> {t("Edit")}
              </Button>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={t("More actions")}>
                  <MoreHorizontal /> {t("More")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {isOwner && c.due > 0 && (
                  <>
                    <DropdownMenuItem disabled={!c.whatsapp_consent} onClick={() => remind("whatsapp")}>
                      <Send /> {t("WhatsApp reminder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!c.whatsapp_consent} onClick={() => remind("sms")}>
                      <MessageSquare /> {t("SMS reminder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog("writeoff")}>
                      <XCircle /> {t("Write off")}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => setDialog("edit")}>
                  <Pencil /> {t("Edit customer")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={c.advance > 0 ? t("Advance") : t("Amount due")}
          value={formatINR(c.advance > 0 ? c.advance : c.due)}
          tone={c.due > 0 ? "bad" : "good"}
          hint={c.due > 0 ? t("Oldest due {date} · {n} days", { date: formatDate(c.oldest_due_date), n: c.days_overdue }) : c.advance > 0 ? t("Used for the next credit bill") : t("All settled")}
        />
        <StatCard label={t("Total spent")} value={formatINR(c.total_spent)} hint={t("{n} bills", { n: c.bill_count })} />
        <StatCard label={t("Last visit")} value={c.last_visit ? formatDate(c.last_visit) : "—"} hint={c.opening_balance > 0 ? t("Opening balance {amount}", { amount: formatINR(c.opening_balance) }) : undefined} />
        <StatCard label={t("Reminders sent")} value={c.reminder_count} hint={c.last_reminder_at ? t("Last {date}", { date: formatDateTime(c.last_reminder_at) }) : t("None yet")} />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("Purchases and payments by month")}</CardTitle>
          <CardDescription>{t("Bills raised for {name} vs money received (last 6 months)", { name: c.name.split(" ")[0] })}</CardDescription>
        </CardHeader>
        <CardContent>
          {bills.data && payments.data ? (
            <GroupedBarChart
              height={240}
              labels={months.map((m) => m.label)}
              series={[
                {
                  label: t("Purchases"),
                  data: sumByMonth(bills.data.filter((b) => b.bill_type === "sale" && b.completed_at), months, (b) => b.completed_at, (b) => b.total - b.returned_amount),
                },
                {
                  label: t("Payments"),
                  data: sumByMonth(payments.data.filter((p) => p.kind === "payment" && p.gateway_status === "success"), months, (p) => p.created_at, (p) => p.amount),
                },
              ]}
            />
          ) : (
            <Skeleton className="h-[240px]" />
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <Tabs defaultValue="ledger">
            <CardHeader className="pb-0">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="ledger">{t("Ledger")}</TabsTrigger>
                <TabsTrigger value="bills">{t("Bills")}</TabsTrigger>
                <TabsTrigger value="payments">{t("Payments")}</TabsTrigger>
                {isOwner && <TabsTrigger value="reminders">{t("Reminders")}</TabsTrigger>}
              </TabsList>
            </CardHeader>
            <CardContent className="px-0">
              <TabsContent value="ledger">
                <ResponsiveTable
                  rows={(ledger.data?.entries || []).slice().reverse().slice(0, showAllLedger ? undefined : 50)}
                  inset
                  empty={<p className="py-8 text-center text-sm text-muted-foreground">{ledger.data ? t("No ledger entries yet") : t("Loading…")}</p>}
                  columns={[
                    { key: "date", header: t("Date"), className: "whitespace-nowrap text-muted-foreground", cell: (e) => formatDateTime(e.created_at) },
                    {
                      key: "entry", header: t("Entry"), primary: true,
                      cell: (e) => (e.bill_id ? <Link to={`/bills/${e.bill_id}`} className="hover:underline">{e.description}</Link> : e.description),
                    },
                    { key: "debit", header: t("Debit"), align: "right", className: "tabular", cell: (e) => (e.debit ? formatINR(e.debit) : "—") },
                    { key: "credit", header: t("Credit"), align: "right", className: "tabular text-emerald-700 dark:text-emerald-400", cell: (e) => (e.credit ? <span className="text-emerald-700 dark:text-emerald-400">{formatINR(e.credit)}</span> : "—") },
                    {
                      key: "balance", header: t("Balance"), align: "right", aside: true,
                      cell: (e) => <span className={`tabular font-medium ${e.balance_after > 0 ? "text-red-700 dark:text-red-400" : ""}`}>{formatINR(e.balance_after)}</span>,
                    },
                  ]}
                />
                {ledger.data && ledger.data.entries.length > 50 && !showAllLedger && (
                  <div className="border-t px-5 pt-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setShowAllLedger(true)}>
                      {t("Show all {n} entries", { n: ledger.data.entries.length })}
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="bills">
                <ResponsiveTable
                  rows={bills.data || []}
                  inset
                  empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("No bills yet")}</p>}
                  columns={[
                    { key: "bill", header: t("Bill"), primary: true, cell: (b) => <Link to={`/bills/${b.id}`} className="font-medium hover:underline">{b.bill_no}</Link> },
                    { key: "date", header: t("Date"), className: "text-muted-foreground", cell: (b) => formatDateTime(b.completed_at || b.created_at) },
                    { key: "total", header: t("Total"), align: "right", aside: true, cell: (b) => <span className="tabular font-medium">{formatINR(b.total)}</span> },
                    { key: "due", header: t("Due"), align: "right", className: "tabular", cell: (b) => (b.due_amount > 0 ? formatINR(b.due_amount) : "—") },
                    { key: "status", header: t("Status"), aside: true, cell: (b) => <BillStatusBadge status={b.status} /> },
                  ]}
                />
              </TabsContent>
              <TabsContent value="payments">
                <ResponsiveTable
                  rows={payments.data || []}
                  inset
                  empty={<p className="py-8 text-center text-sm text-muted-foreground">{t("No payments yet")}</p>}
                  columns={[
                    { key: "date", header: t("Date"), primary: true, className: "whitespace-nowrap text-muted-foreground", cell: (p) => formatDateTime(p.created_at) },
                    { key: "mode", header: t("Mode"), cell: (p) => <ModeBadge mode={p.mode} kind={p.kind} /> },
                    { key: "amount", header: t("Amount"), align: "right", aside: true, cell: (p) => <span className="tabular font-medium">{formatINR(p.amount)}</span> },
                    {
                      key: "utr", header: t("UTR / UPI ID"), className: "text-xs",
                      cell: (p) => (
                        <span className="text-xs">
                          <span className="font-mono">{p.utr || "—"}</span>
                          {p.payer_vpa && <span className="block text-muted-foreground">{p.payer_vpa}</span>}
                        </span>
                      ),
                    },
                    { key: "status", header: t("Status"), aside: true, cell: (p) => <MatchBadge status={p.match_status} /> },
                  ]}
                />
              </TabsContent>
              {isOwner && (
                <TabsContent value="reminders">
                  <div className="grid gap-2 px-5">
                    {(reminders.data || []).map((r) => (
                      <div key={r.id} className="rounded-md border p-3 text-sm">
                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <BellRing className="h-3.5 w-3.5" /> {r.channel === "whatsapp" ? t("WhatsApp") : t("SMS")} · {formatINR(r.amount_due)}
                          </span>
                          <span>{formatDateTime(r.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap">{r.message}</p>
                      </div>
                    ))}
                    {reminders.data && !reminders.data.length && <p className="py-8 text-center text-sm text-muted-foreground">{t("No reminders sent yet")}</p>}
                  </div>
                </TabsContent>
              )}
            </CardContent>
          </Tabs>
        </Card>

        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("Known UPI IDs")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <p className="text-xs text-muted-foreground">
              {t("Payments from these UPI IDs link to {name} automatically, even on walk-in bills.", { name: c.name.split(" ")[0] })}
            </p>
            {c.vpas.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="font-mono">{v.vpa}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeVpa(v.id)} aria-label={t("Remove {name}", { name: v.vpa })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <form onSubmit={addVpa} className="flex gap-2">
              <Input value={newVpa} onChange={(e) => setNewVpa(e.target.value)} placeholder={t("name@bank")} className="h-8" />
              <Button type="submit" size="sm" variant="outline" disabled={!newVpa.includes("@")}>
                <Plus /> {t("Add")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <AmountDialog
        open={dialog === "pay"}
        onOpenChange={(o) => setDialog(o ? "pay" : null)}
        title={t("Receive payment")}
        description={t("Part, full or advance payment. It settles the oldest open bill first.")}
        defaultAmount={c.due || ""}
        submitLabel={t("Record payment")}
        onSubmit={async (amount, extra) => {
          await api.post(`/api/customers/${c.id}/payments`, { amount, mode: extra.mode || "cash", utr: extra.utr || null, note: extra.note || null });
          toast.success(t("Received {amount} from {name}", { amount: formatINR(amount), name: c.name }));
          reloadAll();
        }}
      >
        {(extra, setExtra) => (
          <>
            <Field label={t("Mode")}>
              <Select value={extra.mode || "cash"} onValueChange={(v) => setExtra({ ...extra, mode: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t("Cash")}</SelectItem>
                  {isOwner && <SelectItem value="upi">{t("UPI already received (enter UTR)")}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            {extra.mode === "upi" && (
              <Field label={t("UTR / transaction ID")}>
                <Input value={extra.utr || ""} onChange={(e) => setExtra({ ...extra, utr: e.target.value })} required minLength={6} />
              </Field>
            )}
          </>
        )}
      </AmountDialog>

      <AmountDialog
        open={dialog === "qr"}
        onOpenChange={(o) => setDialog(o ? "qr" : null)}
        title={t("UPI QR for dues")}
        description={t("Shows a dynamic QR at the counter for the amount below.")}
        defaultAmount={c.due || ""}
        submitLabel={t("Show QR")}
        onSubmit={async (amount) => {
          const r = await api.post(`/api/customers/${c.id}/upi-qr`, { amount });
          setQr(r.data);
        }}
      />

      <AmountDialog
        open={dialog === "link"}
        onOpenChange={(o) => setDialog(o ? "link" : null)}
        title={t("UPI payment link")}
        description={t("A link {name} can open on their phone to pay remotely.", { name: c.name.split(" ")[0] })}
        defaultAmount={c.due || ""}
        submitLabel={t("Create link")}
        onSubmit={async (amount) => {
          const r = await api.post(`/api/customers/${c.id}/payment-link`, { amount });
          setLink(r.data);
        }}
      />

      <AmountDialog
        open={dialog === "writeoff"}
        onOpenChange={(o) => setDialog(o ? "writeoff" : null)}
        title={t("Write off dues")}
        description={t("Use only for amounts that will not be collected. Recorded in the audit log.")}
        defaultAmount={c.due || ""}
        submitLabel={t("Write off")}
        onSubmit={async (amount, extra) => {
          await api.post(`/api/customers/${c.id}/writeoff`, { amount, reason: extra.reason || "" });
          toast.success(t("Dues written off"));
          reloadAll();
        }}
      >
        {(extra, setExtra) => (
          <Field label={t("Reason")}>
            <Input value={extra.reason || ""} onChange={(e) => setExtra({ ...extra, reason: e.target.value })} required minLength={3} />
          </Field>
        )}
      </AmountDialog>

      <Dialog open={Boolean(qr)} onOpenChange={(o) => { if (!o) { setQr(null); reloadAll(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Pay dues by UPI")}</DialogTitle>
            <DialogDescription>{c.name}</DialogDescription>
          </DialogHeader>
          {qr && <UpiQrPanel request={qr} allowSimulate={settings?.gateway_is_mock} onPaid={() => reloadAll()} />}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(link)} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Payment link ready")}</DialogTitle>
            <DialogDescription>
              {t("Valid until {date}. Payment is matched to {name} automatically.", { date: link ? formatDateTime(link.expires_at) : "", name: c.name })}
            </DialogDescription>
          </DialogHeader>
          {link && (
            <div className="grid gap-3">
              <div className="flex gap-2">
                <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button variant="outline" size="icon" onClick={() => copy(link.url)} aria-label={t("Copy link")}>
                  <Copy />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() =>
                    window.open(`https://wa.me/91${c.mobile}?text=${encodeURIComponent(t("Hello {name}, please pay {amount} by UPI: {url}", { name: c.name, amount: formatINR(link.amount), url: link.url }))}`, "_blank", "noopener")
                  }
                  disabled={!c.whatsapp_consent}
                >
                  <Send /> {t("WhatsApp")}
                </Button>
                <Button variant="outline" asChild>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {t("Open link")}
                  </a>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CustomerFormDialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} initial={c} onSaved={() => customer.reload()} />
    </div>
  );
}
