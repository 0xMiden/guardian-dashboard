"use client";
import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import Image from "next/image";
import posthog from "posthog-js";

interface EndpointMeta {
  id: string;
  label: string;
}

export default function SelectEndpointPage() {
  const router = useRouter();
  const { signOut } = useClerk();
  const [endpoints, setEndpoints] = useState<EndpointMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/select-endpoint")
      .then((r) => r.json())
      .then((d) => {
        setEndpoints(d.endpoints ?? []);
        if (d.endpoints?.length === 1) setSelected(d.endpoints[0].id);
      })
      .finally(() => setFetching(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError("");
    const res = await fetch("/api/select-endpoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointId: selected }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/overview");
    } else {
      posthog.capture("endpoint_connection_failed", { endpoint_id: selected });
      setError("Failed to connect. Please try again.");
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-xl border bg-card p-8">
        <div className="flex flex-col items-center gap-2">
          <Image src="/orangerobot.png" alt="Guardian" width={32} height={32} />
          <h1 className="text-title">Select Guardian</h1>
        </div>

        {fetching ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : endpoints.length === 0 ? (
          <div className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              You don&apos;t have access to any Miden Guardian dashboard yet.
              Contact your administrator.
            </p>
            <Button onClick={() => signOut(() => router.push("/sign-in"))} size="lg" className="w-full">
              Sign out
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
<select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {endpoints.length > 1 && <option value="">Select endpoint…</option>}
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>{ep.label}</option>
              ))}
            </select>
            {error && <p className="text-sm text-state-error">{error}</p>}
            <button
              type="submit"
              disabled={loading || !selected}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Connecting…" : "Connect"}
            </button>
            <Button type="button" onClick={() => signOut(() => router.push("/sign-in"))} size="lg" className="w-full">
              Sign out
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
