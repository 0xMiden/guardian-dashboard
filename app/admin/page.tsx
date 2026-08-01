"use client";
import { Button } from "@/components/ui/Button";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetcher } from "@/lib/utils";

interface ClerkUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  publicMetadata: { endpointIds?: string[]; role?: string };
}

function EndpointTag({ id }: { id: string }) {
  return (
    <span className="inline-block rounded-lg bg-primary/15 border border-brand/40 px-2 py-0.5 text-xs font-mono text-brand">
      {id}
    </span>
  );
}

function UserRow({ user, onEdit }: { user: ClerkUser; onEdit: (u: ClerkUser) => void }) {
  const endpointIds = user.publicMetadata.endpointIds ?? [];
  const role = user.publicMetadata.role ?? "none";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 text-sm">{name}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{user.email}</td>
      <td className="px-4 py-3">
        <Badge className={role === "admin" ? "bg-primary text-primary-foreground" : "bg-state-neutral text-white"}>
          {role}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {endpointIds.length === 0
            ? <span className="text-xs text-muted-foreground">No access</span>
            : endpointIds.map((id) => <EndpointTag key={id} id={id} />)
          }
        </div>
      </td>
      <td className="px-4 py-3">
        <Button onClick={() => onEdit(user)} size="sm">
          Edit
        </Button>
      </td>
    </tr>
  );
}

function EditModal({ user, onClose }: { user: ClerkUser; onClose: () => void }) {
  const { data: endpointList } = useSWR<{ endpoints: { id: string; label: string }[] }>("/api/admin/endpoints", fetcher);
  const allEndpoints = endpointList?.endpoints ?? [];

  const [endpointIds, setEndpointIds] = useState<string[]>(user.publicMetadata.endpointIds ?? []);
  const [role, setRole] = useState(user.publicMetadata.role ?? "viewer");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function toggle(id: string) {
    setEndpointIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointIds, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await mutate("/api/admin/users");
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-xl bg-popover border p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
        <h2 className="text-sm font-semibold">Edit access — {name}</h2>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Role</p>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border bg-input px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Endpoint access</p>
          {allEndpoints.length === 0 ? (
            <p className="text-xs text-muted-foreground">No endpoints configured in GUARDIAN_ENDPOINTS</p>
          ) : (
            <div className="flex flex-col gap-2">
              {allEndpoints.map((ep) => (
                <label key={ep.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={endpointIds.includes(ep.id)}
                    onChange={() => toggle(ep.id)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{ep.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">({ep.id})</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {saveError && <p className="text-xs text-state-error">{saveError}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose} size="lg">
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} variant="primary" size="lg">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { data, error } = useSWR<ClerkUser[]>("/api/admin/users", fetcher);
  const [editing, setEditing] = useState<ClerkUser | null>(null);

  if (error?.status === 403) {
    return <div className="text-sm text-muted-foreground p-4">Access denied. Admin role required.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">User Management</h1>

      {editing && <EditModal user={editing} onClose={() => setEditing(null)} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-section text-muted-foreground">
            Registered Users
            <span className="ml-2 text-xs font-normal text-muted-foreground">Manage endpoint access and roles</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {!data ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Endpoints</th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(data as ClerkUser[]).map((u) => (
                  <UserRow key={u.id} user={u} onEdit={setEditing} />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
