import { useEffect, useState } from "react";
import { Info, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { BILL_PAPERS, paperFor } from "@/lib/paper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading, PageHeader } from "@/components/common";
import { t, tx } from "@/i18n";

export default function SettingsPage() {
  const { settings, reloadSettings } = useAuth();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setForm({ ...settings });
  }, [settings]);

  if (!form) return <Loading />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { gateway, gateway_is_mock, public_app_url, ...body } = form; // eslint-disable-line no-unused-vars
      await api.put("/api/settings", body);
      await reloadSettings();
      toast.success(t("Settings saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <PageHeader
        title={t("Settings")}
        description={t("Shop details, UPI, billing rules and reminders.")}
        actions={
          <Button type="submit" disabled={saving}>
            <Save /> {t("Save settings")}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Shop")}</CardTitle>
            <CardDescription>{t("Printed on receipts and used in messages.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t("Shop name")}>
              <Input value={form.shop_name} onChange={set("shop_name")} required />
            </Field>
            <Field label={t("Tagline")} hint={t("Shown under the name in the menu, receipts and payment pages")}>
              <Input value={form.shop_tagline ?? ""} onChange={set("shop_tagline")} />
            </Field>
            <Field label={t("Address")}>
              <Input value={form.shop_address} onChange={set("shop_address")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Phone")}>
                <Input value={form.shop_phone} onChange={set("shop_phone")} />
              </Field>
              <Field label={t("GSTIN")}>
                <Input value={form.shop_gstin} onChange={set("shop_gstin")} />
              </Field>
            </div>
            <Field label={t("Bill paper size")} hint={t("Default when printing a bill. Any size can still be picked on the bill page.")}>
              <Select value={paperFor(form.receipt_paper)} onValueChange={set("receipt_paper")}>
                <SelectTrigger>
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
            </Field>
            <Field label={t("Bill footer")} hint={t("Printed at the bottom of every bill. Each line prints on its own line.")}>
              <Textarea rows={3} value={form.receipt_footer} onChange={set("receipt_footer")} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {t("UPI & payment gateway")} <Badge variant={form.gateway_is_mock ? "warning" : "success"}>{form.gateway}</Badge>
            </CardTitle>
            <CardDescription>{t("Dynamic QR codes are created by the gateway with the bill ID as reference.")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Merchant UPI ID (VPA)")}>
                <Input value={form.upi_vpa} onChange={set("upi_vpa")} />
              </Field>
              <Field label={t("Payee name")}>
                <Input value={form.upi_payee_name} onChange={set("upi_payee_name")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("QR expires after (minutes)")}>
                <Input type="number" min="2" max="120" value={form.qr_expiry_minutes} onChange={set("qr_expiry_minutes")} />
              </Field>
              <Field label={t("Payment links valid for (days)")}>
                <Input type="number" min="1" max="30" value={form.payment_link_expiry_days} onChange={set("payment_link_expiry_days")} />
              </Field>
            </div>
            <Alert variant="info">
              <Info className="h-4 w-4" />
              <AlertTitle>{t("Gateway keys stay on the server")}</AlertTitle>
              <AlertDescription>
                {tx("Switch provider with {gateway} and the {keys} keys in {env}. Webhook URL:", {
                  gateway: <code>PAYMENT_GATEWAY</code>,
                  keys: <code>RAZORPAY_*</code>,
                  env: <code>backend/.env</code>,
                })}{" "}
                <code className="break-all">{`<your-domain>/api/upi/webhook/${form.gateway}`}</code>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Billing rules")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="flex items-start justify-between gap-4">
              <span className="text-sm">
                <span className="font-medium">{t("Allow selling items with zero stock")}</span>
                <span className="block text-muted-foreground">{t("Billing always warns; turn off to block the sale.")}</span>
              </span>
              <Switch checked={Boolean(form.allow_zero_stock_sale)} onCheckedChange={set("allow_zero_stock_sale")} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Max cashier discount (%)")} hint={t("Above this, only the owner can give the discount")}>
                <Input type="number" min="0" max="100" step="0.5" value={form.cashier_max_discount_pct} onChange={set("cashier_max_discount_pct")} />
              </Field>
              <Field label={t("Reorder cover (days)")} hint={t("Used for suggested reorder quantity")}>
                <Input type="number" min="1" max="90" value={form.reorder_cover_days} onChange={set("reorder_cover_days")} />
              </Field>
            </div>
            <Field label={t("Near-expiry alert (days)")}>
              <Input type="number" min="1" max="180" value={form.near_expiry_days} onChange={set("near_expiry_days")} className="w-40" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Due reminder message")}</CardTitle>
            <CardDescription>
              {t("Placeholders:")} <code>{"{name}"}</code> <code>{"{shop}"}</code> <code>{"{amount}"}</code> <code>{"{since}"}</code> <code>{"{link}"}</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea rows={5} value={form.reminder_template} onChange={set("reminder_template")} />
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
