"use client";
import Image from "next/image";
import Link from "next/link";
import { SWRConfig } from "swr";
import { ThemeToggle } from "./ThemeToggle";
import { useClerk, useAuth, useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ArrowLeftRight,
  ShieldCheck,
  Settings2,
} from "lucide-react";
import posthog from "posthog-js";
import { cn } from "@/lib/utils";


const NO_SHELL_PATHS = ["/sign-in", "/sign-up", "/select-endpoint"];

const SWR_CONFIG = {
  // The Guardian rate-limits per operator commitment (429, retry after
  // 1s) — retry sooner than SWR's 5s default so transient errors heal fast,
  // and dedupe harder so rapid navigation doesn't refire identical requests.
  errorRetryInterval: 2000,
  dedupingInterval: 5000,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { userId } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const isAdmin = (user?.publicMetadata as { role?: string })?.role === "admin";

  useEffect(() => {
    if (userId && user) {
      posthog.identify(userId, {
        role: (user.publicMetadata as { role?: string })?.role ?? "viewer",
      });
    }
  }, [userId, user]);

  async function handleSignOut() {
    if (!confirm("Sign out?")) return;
    posthog.capture("sign_out_confirmed");
    posthog.reset();
    await fetch("/api/select-endpoint", { method: "DELETE" });
    await signOut(() => router.push("/sign-in"));
  }

  if (NO_SHELL_PATHS.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const navItems = [
    { href: "/overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: "/accounts", label: "Accounts", icon: <Users className="h-4 w-4" /> },
    { href: "/transactions", label: "Activity", icon: <ArrowLeftRight className="h-4 w-4" /> },
    { href: "/compliance", label: "Compliance", icon: <ShieldCheck className="h-4 w-4" /> },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: <Settings2 className="h-4 w-4" /> }] : []),
  ];

  return (
    <SWRConfig value={SWR_CONFIG}>
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile top bar */}
      <div className="fixed top-0 inset-x-0 flex md:hidden items-center justify-between bg-sidebar px-4 py-3 border-b z-50">
        <div className="flex items-center gap-2">
          <Image src="/orangerobot.png" alt="Guardian" width={16} height={16} className="shrink-0" />
          <span className="font-heading text-subtitle leading-tight text-foreground">Guardian Dashboard</span>
        </div>
        <button onClick={handleSignOut} className="text-muted-foreground hover:text-foreground transition-colors" title="Sign out" aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* Sidebar (desktop only) */}
      <aside className="hidden md:flex w-56 flex-col bg-sidebar px-3 py-6">
        <div className="mb-8 px-3 flex flex-col items-center">
          <div className="flex items-center gap-2">
            <Image src="/orangerobot.png" alt="Guardian" width={20} height={20} className="shrink-0" />
            <span className="font-heading text-subtitle leading-tight text-foreground">Guardian Dashboard</span>
          </div>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 font-heading text-section transition-colors",
                isActive(href) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {icon}
              {label}
            </Link>
          ))}
        </nav>
        <div className="pt-4 border-t">
          <ThemeToggle />
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 pt-16 md:pt-6 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 flex md:hidden bg-sidebar border-t px-2 py-2 z-50 justify-around">
        {navItems.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors",
              isActive(href) ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {icon}
            {isActive(href) && <span className="text-xs font-medium">{label}</span>}
          </Link>
        ))}
      </nav>
    </div>
    </SWRConfig>
  );
}
