import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight, BarChart3, Bell, Building2, ChevronLeft, ChevronRight, ClipboardCheck, FlaskConical, HandCoins, History, KeyRound,
  LayoutDashboard, LogOut, Menu, MonitorSmartphone, Package, Receipt, Scale, Settings, ShoppingCart,
  SlidersHorizontal, Truck, UserCog, Users, Wallet, WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useOnline } from "@/hooks/useOnline";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ErrorAlert, Field } from "@/components/common";
import { BRAND, BrandMark } from "@/components/brand";

const NAV = [
  { group: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, owner: true }] },
  {
    group: "Counter",
    items: [
      { to: "/pos", label: "Billing", icon: ShoppingCart },
      { to: "/bills", label: "Bills", icon: Receipt },
      { to: "/payments", label: "Payments", icon: Wallet },
      { to: "/display", label: "Customer display", icon: MonitorSmartphone, external: true },
    ],
  },
  {
    group: "Customers",
    items: [
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/dues", label: "Dues & reminders", icon: HandCoins, owner: true },
    ],
  },
  {
    group: "Inventory",
    items: [
      { to: "/products", label: "Products", icon: Package },
      { to: "/purchases", label: "Stock-in", icon: Truck, owner: true },
      { to: "/suppliers", label: "Suppliers", icon: Building2, owner: true },
      { to: "/stock/adjustments", label: "Adjustments", icon: SlidersHorizontal },
      { to: "/stock/counts", label: "Stock count", icon: ClipboardCheck },
      { to: "/stock/movements", label: "Stock movements", icon: ArrowLeftRight },
    ],
  },
  {
    group: "Finance",
    items: [
      { to: "/reconciliation", label: "Reconciliation", icon: Scale, owner: true },
      { to: "/reports", label: "Reports", icon: BarChart3, owner: true },
    ],
  },
  {
    group: "Admin",
    items: [
      { to: "/staff", label: "Staff", icon: UserCog, owner: true },
      { to: "/audit", label: "Audit log", icon: History, owner: true },
      { to: "/settings", label: "Settings", icon: Settings, owner: true },
    ],
  },
];

function NavList({ isOwner, onNavigate, collapsed = false }) {
  return (
    <nav className={cn("flex flex-col gap-5 py-4", collapsed ? "px-2" : "px-3")}>
      {NAV.map((section) => {
        const items = section.items.filter((i) => !i.owner || isOwner);
        if (!items.length) return null;
        return (
          <div key={section.group}>
            {collapsed ? (
              <div className="mx-3 mb-1.5 border-t" />
            ) : (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{section.group}</p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((item) =>
                item.external ? (
                  <a
                    key={item.to}
                    href={item.to}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                      collapsed && "justify-center px-0"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && item.label}
                  </a>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                        collapsed && "justify-center px-0",
                        isActive && "bg-sidebar-accent font-medium text-primary"
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && item.label}
                  </NavLink>
                )
              )}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ shopName, tagline, collapsed = false }) {
  return (
    <Link to="/" className={cn("flex min-w-0 items-center gap-2.5", collapsed ? "mx-auto" : "px-4")}>
      <BrandMark className={collapsed ? "h-8 w-8" : "h-10 w-10"} />
      <div className={cn("min-w-0 leading-tight", collapsed && "hidden")}>
        <p className="truncate text-sm font-semibold text-brand-deep">{shopName || BRAND.name}</p>
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-brand-leaf">{tagline ?? BRAND.tagline}</p>
      </div>
    </Link>
  );
}

const SEVERITY = {
  critical: "bg-red-500",
  serious: "bg-orange-500",
  warning: "bg-amber-400",
};

function Notifications() {
  const [data, setData] = useState({ count: 0, items: [] });
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get("/api/notifications")
        .then((r) => alive && setData(r.data))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [location.pathname]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell />
          {data.count > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {data.count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,360px)] p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">Alerts</div>
        {data.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">All clear — nothing needs attention.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {data.items.map((n) => (
              <li key={n.type}>
                <Link to={n.link} className="flex gap-3 border-b px-4 py-3 last:border-0 hover:bg-accent">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY[n.severity] || "bg-muted-foreground")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{n.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ChangePasswordDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ current_password: "", new_password: "" });
      setError(null);
    }
  }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/auth/change-password", form);
      toast.success("Password changed");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Use at least 6 characters.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <ErrorAlert message={error} />
          <Field label="Current password">
            <Input type="password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} required />
          </Field>
          <Field label="New password">
            <Input type="password" minLength={6} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={saving}>Update password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AppLayout() {
  const { user, settings, logout, isOwner } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const online = useOnline();
  const navigate = useNavigate();

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className={cn("flex h-14 items-center border-b", collapsed ? "justify-center" : "justify-end pr-3")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
          <NavList isOwner={isOwner} collapsed={collapsed} />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Go to a page</SheetDescription>
          <div className="flex h-14 items-center border-b">
            <Brand shopName={settings?.shop_name} tagline={settings?.shop_tagline} />
          </div>
          <NavList isOwner={isOwner} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-16" : "lg:pl-60")}>
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Link to="/" className="flex min-w-0 shrink items-center gap-2 lg:hidden">
            <BrandMark className="h-8 w-8" />
            <span className="truncate text-sm font-semibold text-brand-deep md:text-base">
              {settings?.shop_name || BRAND.name}
            </span>
          </Link>
          <div className="-ml-1 hidden shrink-0 lg:block">
            <Brand shopName={settings?.shop_name} tagline={settings?.shop_tagline} />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {settings?.gateway_is_mock && (
              <Badge variant="warning" className="hidden sm:inline-flex">
                <FlaskConical className="h-3 w-3" /> Test gateway
              </Badge>
            )}
            {!online && (
              <Badge variant="destructive">
                <WifiOff className="h-3 w-3" /> Offline — drafts are saved on this device
              </Badge>
            )}
          </div>
          <Notifications />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback>{(user?.name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium">{user?.name}</span>
                  <span className="block text-[11px] capitalize text-muted-foreground">{user?.role}</span>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-sm font-medium">{user?.name}</span>
                <span className="block text-xs text-muted-foreground">@{user?.username}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPwOpen(true)}>
                <KeyRound /> Change password
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
