import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorAlert, Field } from "@/components/common";
import { BRAND, BrandLogo } from "@/components/brand";

const POINTS = [
  "Dynamic UPI QR per bill, confirmed automatically",
  "Customer ledger, dues and one-tap reminders",
  "Barcode billing with live plant, pot and seed stock",
  "Daily reconciliation with the gateway and bank",
];

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (ready && user) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Could not sign in"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col items-center justify-center gap-10 bg-brand-paper px-10 pb-20 pt-10 text-brand-deep lg:flex">
        <BrandLogo className="max-w-[300px] xl:max-w-[360px]" />
        <div className="w-full max-w-md space-y-5">
          <h2 className="text-2xl font-semibold leading-tight">Billing, UPI payments and plant stock for the nursery, in one place.</h2>
          <ul className="space-y-3 text-brand-deep/80">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-leaf" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="absolute inset-x-0 bottom-8 text-center text-sm text-brand-deep/60">Billing · UPI · Ledger · Inventory · Analytics</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-6 p-4 sm:p-8">
        <BrandLogo className="w-40 sm:w-48 lg:hidden" />
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <CardDescription>Use your {BRAND.name} staff account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4">
              <ErrorAlert message={error} />
              <Field label="Username" htmlFor="username">
                <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />} Sign in
              </Button>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Demo logins: <span className="font-mono">owner / owner123</span> and <span className="font-mono">cashier / cashier123</span>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
