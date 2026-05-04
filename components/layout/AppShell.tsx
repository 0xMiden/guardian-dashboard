"use client";
import Image from "next/image";
import { NavItem } from "./NavItem";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useClerk, useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ScrollText,
  Users,
  ArrowLeftRight,
  ShieldCheck,
  Settings2,
} from "lucide-react";


const NO_SHELL_PATHS = ["/sign-in", "/sign-up", "/select-endpoint"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sessionClaims } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const isAdmin = (sessionClaims?.publicMetadata as { role?: string })?.role === "admin";
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  async function handleSignOut() {
    await fetch("/api/select-endpoint", { method: "DELETE" });
    await signOut(() => router.push("/sign-in"));
  }

  if (NO_SHELL_PATHS.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

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
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-zinc-900 px-3 py-6">
        <div className="mb-8 flex items-center gap-2 px-3">
          <Image src="/orangerobot.png" alt="Guardian" width={20} height={20} className="shrink-0" />
          <span className="text-sm font-semibold text-white">Guardian Dashboard</span>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          <NavItem href="/overview" label="Overview" icon={<LayoutDashboard className="h-4 w-4" />} />
          <NavItem href="/logs" label="Logs" icon={<ScrollText className="h-4 w-4" />} />
          <NavItem href="/accounts" label="Accounts" icon={<Users className="h-4 w-4" />} />
          <NavItem href="/transactions" label="Transactions" icon={<ArrowLeftRight className="h-4 w-4" />} />
          <NavItem href="/compliance" label="Compliance" icon={<ShieldCheck className="h-4 w-4" />} />
          {isAdmin && (
            <NavItem href="/admin" label="Admin" icon={<Settings2 className="h-4 w-4" />} />
          )}
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
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
