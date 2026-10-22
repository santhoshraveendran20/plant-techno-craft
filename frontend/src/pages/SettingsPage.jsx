import { useEffect, useState } from "react";
import { Info, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, Loading, PageHeader } from "@/components/common";

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
      toast.success("Settings saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <PageHeader
        title="Settings"
        description="Shop details, UPI, billing rules and reminders."
        actions={
          <Button type="submit" disabled={saving}>
            <Save /> Save settings
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shop</CardTitle>
            <CardDescription>Printed on receipts and used in messages.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Shop name">
              <Input value={form.shop_name} onChange={set("shop_name")} required />
            </Field>
            <Field label="Tagline" hint="Shown under the name in the menu, receipts and payment pages">
              <Input value={form.shop_tagline ?? ""} onChange={set("shop_tagline")} />
            </Field>
            <Field label="Address">
              <Input value={form.shop_address} onChange={set("shop_address")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <Input value={form.shop_phone} onChange={set("shop_phone")} />
              </Field>
              <Field label="GSTIN">
                <Input value={form.shop_gstin} onChange={set("shop_gstin")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Receipt width">
                <Select value={String(form.receipt_width_mm)} onValueChange={(v) => setForm({ ...form, receipt_width_mm: Number(v) })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58 mm thermal</SelectItem>
                    <SelectItem value="80">80 mm thermal</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Receipt footer">
                <Input value={form.receipt_footer} onChange={set("receipt_footer")} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              UPI & payment gateway <Badge variant={form.gateway_is_mock ? "warning" : "success"}>{form.gateway}</Badge>
            </CardTitle>
            <CardDescription>Dynamic QR codes are created by the gateway with the bill ID as reference.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Merchant UPI ID (VPA)">
                <Input value={form.upi_vpa} onChange={set("upi_vpa")} />
              </Field>
              <Field label="Payee name">
                <Input value={form.upi_payee_name} onChange={set("upi_payee_name")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="QR expires after (minutes)">
                <Input type="number" min="2" max="120" value={form.qr_expiry_minutes} onChange={set("qr_expiry_minutes")} />
              </Field>
              <Field label="Payment links valid for (days)">
                <Input type="number" min="1" max="30" value={form.payment_link_expiry_days} onChange={set("payment_link_expiry_days")} />
              </Field>
            </div>
            <Alert variant="info">
              <Info className="h-4 w-4" />
              <AlertTitle>Gateway keys stay on the server</AlertTitle>
              <AlertDescription>
                Switch provider with <code>PAYMENT_GATEWAY</code> and the <code>RAZORPAY_*</code> keys in <code>backend/.env</code>. Webhook URL:{" "}
                <code className="break-all">{`<your-domain>/api/upi/webhook/${form.gateway}`}</code>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing rules</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="flex items-start justify-between gap-4">
              <span className="text-sm">
                <span className="font-medium">Allow selling items with zero stock</span>
                <span className="block text-muted-foreground">Billing always warns; turn off to block the sale.</span>
              </span>
              <Switch checked={Boolean(form.allow_zero_stock_sale)} onCheckedChange={set("allow_zero_stock_sale")} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max cashier discount (%)" hint="Above this, only the owner can give the discount">
                <Input type="number" min="0" max="100" step="0.5" value={form.cashier_max_discount_pct} onChange={set("cashier_max_discount_pct")} />
              </Field>
              <Field label="Reorder cover (days)" hint="Used for suggested reorder quantity">
                <Input type="number" min="1" max="90" value={form.reorder_cover_days} onChange={set("reorder_cover_days")} />
              </Field>
            </div>
            <Field label="Near-expiry alert (days)">
              <Input type="number" min="1" max="180" value={form.near_expiry_days} onChange={set("near_expiry_days")} className="w-40" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Due reminder message</CardTitle>
            <CardDescription>
              Placeholders: <code>{"{name}"}</code> <code>{"{shop}"}</code> <code>{"{amount}"}</code> <code>{"{since}"}</code> <code>{"{link}"}</code>
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
