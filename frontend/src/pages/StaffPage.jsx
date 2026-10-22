import { useEffect, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useFetch";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ResponsiveTable } from "@/components/data-table";
import { ErrorAlert, Field, Loading, PageHeader } from "@/components/common";

const ROLE_HELP = {
  owner: "Everything: products, prices, staff, dues write-off, dashboard, exports, settings",
  cashier: "Create bills, scan barcodes, show QR, take cash, credit sales, view a customer's due",
};

function UserDialog({ open, onOpenChange, user, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setForm({ name: user?.name || "", username: user?.username || "", password: "", role: user?.role || "cashier" });
      setError(null);
    }
  }, [open, user]);
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (user?.id) {
        await api.put(`/api/users/${user.id}`, { name: form.name, role: form.role, password: form.password || undefined });
      } else {
        await api.post("/api/users", form);
      }
      toast.success("Staff account saved");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{user?.id ? `Edit ${user.username}` : "Add staff login"}</DialogTitle>
          <DialogDescription>{ROLE_HELP[form.role || "cashier"]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label="Full name">
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <Input value={form.username || ""} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={3} disabled={Boolean(user?.id)} />
            </Field>
            <Field label="Role">
              <Select value={form.role || "cashier"} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">Cashier / staff</SelectItem>
                  <SelectItem value="owner">Owner / admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={user?.id ? "New password (leave empty to keep)" : "Password"}>
            <Input type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required={!user?.id} />
          </Field>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffPage() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useFetch("/api/users");
  const [editing, setEditing] = useState(null);

  const toggleActive = async (u, active) => {
    try {
      await api.put(`/api/users/${u.id}`, { is_active: active });
      toast.success(active ? `${u.username} enabled` : `${u.username} disabled`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Staff logins with role permissions. Every edit, discount and deletion is in the audit log."
        actions={
          <Button onClick={() => setEditing({})}>
            <UserPlus /> Add staff
          </Button>
        }
      />
      <Card>
        <ErrorAlert message={error} className="m-3" />
        {loading && !data ? (
          <Loading />
        ) : (
          <ResponsiveTable
            rows={data || []}
            columns={[
              {
                key: "name", header: "Name", primary: true,
                cell: (u) => (
                  <>
                    <span className="font-medium">{u.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground md:hidden">@{u.username}</span>
                  </>
                ),
              },
              { key: "username", header: "Username", card: false, cell: (u) => <span className="font-mono text-sm">{u.username}</span> },
              { key: "role", header: "Role", aside: true, cell: (u) => <Badge variant={u.role === "owner" ? "default" : "secondary"}>{u.role}</Badge> },
              { key: "login", header: "Last sign-in", hide: "xl", className: "text-muted-foreground", cell: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : "Never") },
              {
                key: "active", header: "Active",
                cell: (u) => <Switch checked={u.is_active} disabled={u.id === me?.id} onCheckedChange={(v) => toggleActive(u, v)} aria-label={`Active: ${u.username}`} />,
              },
              {
                key: "actions", header: "Edit", actions: true, align: "right",
                cell: (u) => (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                    <KeyRound /> Edit / reset password
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <UserDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} user={editing} onSaved={reload} />
    </div>
  );
}
