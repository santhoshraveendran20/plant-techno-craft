import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { BILL_PAPERS, paperFor } from "@/lib/paper";
import { amountInWords, cn, formatDateTime, formatINR, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorAlert, Field, Loading } from "@/components/common";
import { BrandLogo, BrandMark } from "@/components/brand";
import { t } from "@/i18n";

const money = (v) => Number(v).toFixed(2);
const sum = (rows) => rows.reduce((s, p) => s + p.amount, 0);

/** Everything both layouts print, worked out once from the bill. */
function billFacts(bill, settings) {
  const upi = bill.payments.filter((p) => p.mode === "upi" && p.gateway_status === "success" && p.kind === "payment");
  const cash = bill.payments.filter((p) => p.mode === "cash" && p.kind === "payment");
  const cashPaid = sum(cash);
  const upiPaid = sum(upi);
  return {
    // A bill of supply is the GST document for exempt goods such as plants; it needs a GSTIN
    title: settings.shop_gstin ? t("BILL OF SUPPLY") : t("BILL"),
    date: formatDateTime(bill.completed_at || bill.created_at),
    payment: [cashPaid > 0 && t("Cash"), upiPaid > 0 && t("UPI"), bill.due_amount > 0 && t("Credit")].filter(Boolean).join(" + ") || "—",
    cashPaid,
    upiPaid,
    utr: upi.find((p) => p.utr)?.utr,
    words: amountInWords(bill.total),
  };
}

function Row({ label, value, className }) {
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <span>{label}</span>
      <span className="tabular shrink-0">{value}</span>
    </div>
  );
}

const Dashes = () => <div className="my-[0.6em] border-t border-dashed border-black" />;

/** Thermal roll receipt (58 / 80 mm). */
function RollBill({ bill, settings, paper, facts }) {
  return (
    <div className="font-mono leading-snug">
      <div className="text-center">
        <div className="mx-auto mb-[0.6em]" style={{ width: `${paper.logoWidth}mm` }}>
          <BrandLogo plate={false} className="print:grayscale" />
        </div>
        <p className="text-[1.25em] font-bold uppercase">{settings.shop_name}</p>
        {settings.shop_address && <p>{settings.shop_address}</p>}
        {settings.shop_phone && <p>{t("Ph:")} {settings.shop_phone}</p>}
        {settings.shop_gstin && <p>{t("GSTIN:")} {settings.shop_gstin}</p>}
      </div>
      <Dashes />
      <p className="text-center font-bold">{facts.title}</p>
      <Dashes />
      <p><b>{t("Invoice No:")}</b> {bill.bill_no}</p>
      <p><b>{t("Date:")}</b> {facts.date}</p>
      {bill.created_by && <p><b>{t("Cashier:")}</b> {bill.created_by}</p>}
      {bill.customer && <p><b>{t("Customer:")}</b> {bill.customer.name} ({bill.customer.mobile})</p>}
      <p><b>{t("Payment:")}</b> {facts.payment}</p>
      <Dashes />
      {bill.items.map((i, n) => (
        <div key={i.id} className="mb-[0.4em]">
          <p>{n + 1}. {i.product_name}</p>
          <Row label={`${formatNumber(i.qty)} ${i.unit} x ${money(i.unit_price)}`} value={money(i.line_total)} />
        </div>
      ))}
      <Dashes />
      <Row label={t("Subtotal")} value={money(bill.subtotal)} />
      {bill.discount > 0 && <Row label={t("Discount")} value={`-${money(bill.discount)}`} />}
      {bill.returned_amount > 0 && <Row label={t("Returned")} value={`-${money(bill.returned_amount)}`} />}
      <div className="my-[0.3em] border-t border-black" />
      <Row label={t("Grand total")} value={formatINR(bill.total)} className="text-[1.3em] font-bold" />
      <p className="mt-[0.4em] italic">{facts.words}</p>
      <Dashes />
      {facts.cashPaid > 0 && <Row label={t("Paid by Cash")} value={money(facts.cashPaid)} />}
      {facts.upiPaid > 0 && <Row label={`${t("Paid by UPI")}${facts.utr ? ` (UTR ${facts.utr})` : ""}`} value={money(facts.upiPaid)} />}
      {bill.due_amount > 0 && <Row label={t("Balance due")} value={money(bill.due_amount)} className="font-bold" />}
      {settings.receipt_footer && (
        <>
          <Dashes />
          <p className="whitespace-pre-line text-center">{settings.receipt_footer}</p>
        </>
      )}
    </div>
  );
}

/** Full-page invoice for A5 / A4 / A3 sheets. */
function SheetBill({ bill, settings, facts }) {
  const label = "text-[0.8em] font-semibold uppercase tracking-wide text-neutral-600";
  return (
    <div className="flex flex-1 flex-col font-sans leading-normal">
      <header className="flex items-start justify-between gap-[2em] border-b-2 border-black pb-[1em]">
        <div className="flex min-w-0 items-start gap-[1em]">
          <BrandMark plate={false} className="h-[5.5em] w-[5.5em]" />
          <div className="min-w-0">
            <p className="text-[1.7em] font-bold uppercase leading-tight">{settings.shop_name}</p>
            {settings.shop_tagline && <p className="mb-[0.3em] text-[0.8em] uppercase tracking-[0.2em] text-neutral-600">{settings.shop_tagline}</p>}
            {settings.shop_address && <p>{settings.shop_address}</p>}
            {settings.shop_phone && <p>{t("Ph:")} {settings.shop_phone}</p>}
            {settings.shop_gstin && <p>{t("GSTIN:")} {settings.shop_gstin}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="mb-[0.3em] text-[1.4em] font-bold tracking-wide">{facts.title}</p>
          <p>{t("Invoice No:")} <b>{bill.bill_no}</b></p>
          <p>{t("Date:")} {facts.date}</p>
          {bill.created_by && <p>{t("Cashier:")} {bill.created_by}</p>}
        </div>
      </header>

      <section className="mt-[1.2em] grid grid-cols-2 gap-[1em] rounded border border-black p-[0.8em]">
        <div>
          <p className={label}>{t("Bill to")}</p>
          <p className="font-semibold">{bill.customer ? bill.customer.name : t("Walk-in customer")}</p>
          {bill.customer && <p>{bill.customer.mobile}</p>}
        </div>
        <div className="text-right">
          <p className={label}>{t("Payment")}</p>
          <p className="font-semibold">{facts.payment}</p>
          {facts.utr && <p>UTR {facts.utr}</p>}
        </div>
      </section>

      <table className="mt-[1.2em] w-full border-collapse">
        <thead>
          <tr className="border-y-2 border-black text-left">
            <th className="w-[3em] py-[0.5em] pl-[0.4em]">#</th>
            <th className="py-[0.5em]">{t("Item")}</th>
            <th className="py-[0.5em] text-right">{t("Qty")}</th>
            <th className="py-[0.5em] text-right">{t("Rate")}</th>
            <th className="py-[0.5em] pr-[0.4em] text-right">{t("Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((i, n) => (
            <tr key={i.id} className="border-b border-neutral-300">
              <td className="py-[0.45em] pl-[0.4em] align-top">{n + 1}</td>
              <td className="py-[0.45em] pr-[1em] align-top">{i.product_name}</td>
              <td className="tabular whitespace-nowrap py-[0.45em] text-right align-top">
                {formatNumber(i.qty)} {i.unit}
              </td>
              <td className="tabular py-[0.45em] text-right align-top">{money(i.unit_price)}</td>
              <td className="tabular py-[0.45em] pr-[0.4em] text-right align-top">{money(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-[1.2em] flex items-start justify-between gap-[2em]">
        <div className="min-w-0 flex-1">
          <p className={label}>{t("Amount in words")}</p>
          <p className="italic">{facts.words}</p>
        </div>
        <div className="w-[45%] space-y-[0.25em]">
          <Row label={t("Subtotal")} value={money(bill.subtotal)} />
          {bill.discount > 0 && <Row label={t("Discount")} value={`-${money(bill.discount)}`} />}
          {bill.returned_amount > 0 && <Row label={t("Returned")} value={`-${money(bill.returned_amount)}`} />}
          <Row label={t("Grand total")} value={formatINR(bill.total)} className="border-y-2 border-black py-[0.3em] text-[1.25em] font-bold" />
          {facts.cashPaid > 0 && <Row label={t("Paid by Cash")} value={money(facts.cashPaid)} />}
          {facts.upiPaid > 0 && <Row label={t("Paid by UPI")} value={money(facts.upiPaid)} />}
          {bill.due_amount > 0 && <Row label={t("Balance due")} value={money(bill.due_amount)} className="font-bold" />}
        </div>
      </div>

      <footer className="mt-auto flex items-end justify-between gap-[2em] pt-[3em]">
        <p className="whitespace-pre-line text-[0.9em]">{settings.receipt_footer}</p>
        <div className="shrink-0 text-center">
          <div className="mb-[0.3em] w-[14em] border-t border-black" />
          {t("Authorised signatory")}
        </div>
      </footer>
    </div>
  );
}

/** Opens WhatsApp with the bill text ready to send. `mobile` is only passed when staff typed the number in. */
async function openWhatsApp(billId, mobile) {
  const r = await api.get(`/api/bills/${billId}/share`, { params: { channel: "whatsapp", mobile: mobile || undefined } });
  window.open(r.data.url, "_blank", "noopener");
}

/** Asks for the number when the bill has no customer, or the customer has not agreed to messages. */
function WhatsAppDialog({ bill, open, onOpenChange }) {
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMobile(bill.customer?.mobile || "");
      setError(null);
    }
  }, [open, bill]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await openWhatsApp(bill.id, mobile);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Send bill on WhatsApp")}</DialogTitle>
          <DialogDescription>
            {bill.customer
              ? t("No message consent is recorded for {name}. Send only if they agreed.", { name: bill.customer.name })
              : t("Opens WhatsApp with the bill details ready to send.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label={t("WhatsApp number")} htmlFor="wa-mobile">
            <Input
              id="wa-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder={t("10-digit number")}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} {t("Open WhatsApp")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Printable bill on a thermal roll or a sheet (FR-08). Opens the print dialog with ?print=1; ?paper= overrides the size. */
export default function ReceiptPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings } = useAuth();
  const { data: bill, error } = useFetch(`/api/bills/${id}`);
  const [waOpen, setWaOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const paperKey = paperFor(params.get("paper") || settings?.receipt_paper);
  const paper = BILL_PAPERS[paperKey];

  useEffect(() => {
    if (bill && settings && params.get("print") === "1") {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [bill, settings, params]);

  if (error) return <ErrorAlert message={error} className="m-6" />;
  if (!bill || !settings) return <Loading />;

  const facts = billFacts(bill, settings);
  // Rolls have no fixed length, so the thermal printer's own paper setting sizes the page (CSS cannot
  // say "80mm wide, any height"); the bill is capped at the roll width. Sheets get their exact size and
  // a 12 mm margin, the same padding the on-screen preview uses.
  const pageCss = paper.roll ? "margin: 3mm;" : `size: ${paper.width}mm ${paper.height}mm; margin: 12mm;`;

  // A customer who agreed to messages gets it straight away; otherwise staff confirm the number first
  const sendWhatsApp = async () => {
    if (!bill.customer?.mobile || !bill.customer.whatsapp_consent) return setWaOpen(true);
    setSending(true);
    try {
      await openWhatsApp(bill.id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-auto bg-muted/40 py-6 print:overflow-visible print:bg-white print:py-0">
      <style>{`@media print { @page { ${pageCss} } }`}</style>
      <div className="no-print mx-auto mb-4 flex flex-wrap items-center justify-center gap-2 px-4">
        <Button onClick={() => window.print()}>
          <Printer /> {t("Print")}
        </Button>
        <Button variant="outline" onClick={sendWhatsApp} disabled={sending}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />} {t("WhatsApp")}
        </Button>
        {/* changing the size drops ?print=1 so the dialog does not reopen */}
        <Select value={paperKey} onValueChange={(v) => setParams({ paper: v }, { replace: true })}>
          <SelectTrigger className="w-48" aria-label={t("Paper size")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(BILL_PAPERS).map(([key, p]) => (
              <SelectItem key={key} value={key}>
                {t(p.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => window.close()}>
          {t("Close")}
        </Button>
      </div>
      <div
        className={cn(
          "mx-auto bg-white text-black shadow print:shadow-none",
          paper.roll
            ? "w-[var(--paper-w)] p-3 print:w-auto print:max-w-[var(--paper-w)] print:p-0"
            : "flex min-h-[var(--paper-h)] w-[var(--paper-w)] flex-col p-[12mm] print:min-h-0 print:w-auto print:p-0"
        )}
        style={{ "--paper-w": `${paper.width}mm`, "--paper-h": `${paper.height}mm`, fontSize: paper.fontSize }}
      >
        {paper.roll ? (
          <RollBill bill={bill} settings={settings} paper={paper} facts={facts} />
        ) : (
          <SheetBill bill={bill} settings={settings} facts={facts} />
        )}
      </div>
      <WhatsAppDialog bill={bill} open={waOpen} onOpenChange={setWaOpen} />
    </div>
  );
}
