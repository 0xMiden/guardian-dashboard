"use client";
import Image from "next/image";
import Link from "next/link";
import { NavItem } from "./NavItem";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useClerk, useAuth, useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
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


const NO_SHELL_PATHS = ["/sign-in", "/sign-up", "/select-endpoint"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { userId } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const isAdmin = (user?.publicMetadata as { role?: string })?.role === "admin";
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (userId && user) {
      posthog.identify(userId, {
        role: (user.publicMetadata as { role?: string })?.role ?? "viewer",
      });
    }
  }, [userId, user]);

  async function handleSignOut() {
    posthog.capture("sign_out_confirmed");
    posthog.reset();
    await fetch("/api/select-endpoint", { method: "DELETE" });
    await signOut(() => router.push("/sign-in"));
  }

  if (NO_SHELL_PATHS.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  const navItems = [
    { href: "/overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: "/accounts", label: "Accounts", icon: <Users className="h-4 w-4" /> },
    { href: "/transactions", label: "Transactions", icon: <ArrowLeftRight className="h-4 w-4" /> },
    { href: "/compliance", label: "Compliance", icon: <ShieldCheck className="h-4 w-4" /> },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: <Settings2 className="h-4 w-4" /> }] : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {confirmSignOut && (
        <ConfirmModal
          title="Sign out?"
          message="You'll be redirected to the login page."
          confirmLabel="Sign out"
          confirmClass="bg-zinc-600 hover:bg-zinc-500 text-white"
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}

      {/* Mobile top bar */}
      <div className="fixed top-0 inset-x-0 flex md:hidden items-center justify-between bg-zinc-900 px-4 py-3 border-b border-zinc-800 z-50">
        <div className="flex items-center gap-2">
          <Image src="/orangerobot.png" alt="Guardian" width={16} height={16} className="shrink-0" />
          <span className="text-sm font-semibold text-white">Guardian Dashboard</span>
        </div>
        <button onClick={() => setConfirmSignOut(true)} className="text-zinc-400 hover:text-white transition-colors">
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* Sidebar (desktop only) */}
      <aside className="hidden md:flex w-56 flex-col bg-zinc-900 px-3 py-6">
        <div className="mb-8 px-3 flex flex-col items-center">
          <div className="flex items-center gap-2">
            <Image src="/orangerobot.png" alt="Guardian" width={20} height={20} className="shrink-0" />
            <span className="text-sm font-semibold text-white">Guardian Dashboard</span>
          </div>
          <span className="mt-1.5 inline-block rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-500">
            Read-only MVP
          </span>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ href, label, icon }) => (
            <NavItem key={href} href={href} label={label} icon={icon} />
          ))}
        </nav>
        <div className="pt-4 border-t border-zinc-800">
          <button
            onClick={() => setConfirmSignOut(true)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-zinc-800 hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 pt-16 md:pt-6 pb-24 md:pb-6">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 flex md:hidden bg-zinc-900 border-t border-zinc-800 px-2 py-2 z-50 justify-around">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {icon}
              {active && <span className="text-xs font-medium">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
