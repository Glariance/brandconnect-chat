import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, Btn, Card, Badge } from "@/components/app-shell";
import { ApiError, isAbortError, isRealChatEnabled } from "@/lib/api";
import {
  archiveSavedReply,
  createSavedReply,
  fetchBrands,
  fetchSavedReplies,
  updateSavedReply,
  type ApiBrand,
  type ApiSavedReply,
} from "@/lib/chat-api";
import { canned } from "@/lib/sample-data";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/canned-replies")({
  head: () => ({
    meta: [
      { title: "Saved Replies · BrandConnect" },
      { name: "description", content: "Organization and brand saved replies with slash shortcuts." },
      { property: "og:title", content: "Saved Replies · BrandConnect" },
    ],
  }),
  component: Page,
});

function Page() {
  return isRealChatEnabled() ? <RealSavedReplies /> : <DemoSavedReplies />;
}

function DemoSavedReplies() {
  return (
    <>
      <PageHeader title="Saved Replies" desc="Type the shortcut in the reply box to insert" action={<Btn disabled>New reply</Btn>} />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Shortcut</th>
              <th className="p-3">Title</th>
              <th className="p-3">Brand</th>
              <th className="p-3">Body</th>
            </tr>
          </thead>
          <tbody>
            {canned.map((c) => (
              <tr key={c.shortcut} className="border-b">
                <td className="p-3"><code className="text-xs text-accent-foreground">{c.shortcut}</code></td>
                <td className="p-3 font-medium">{c.title}</td>
                <td className="p-3">{c.brand}</td>
                <td className="p-3 text-muted-foreground">{c.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-sm text-muted-foreground">Demo mode — enable the Laravel API for persistent saved replies.</p>
    </>
  );
}

function emptyForm() {
  return { title: "", shortcut: "", body: "", brand_id: "" as string | number | "", is_active: true };
}

function RealSavedReplies() {
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "admin";
  const [rows, setRows] = useState<ApiSavedReply[]>([]);
  const [brands, setBrands] = useState<ApiBrand[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [list, brandList] = await Promise.all([
        fetchSavedReplies(q ? { q } : {}, { signal }),
        fetchBrands({ signal }),
      ]);
      setRows(list);
      setBrands(brandList);
      setError(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof ApiError ? e.message : "Could not load saved replies");
    }
  }, [q]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const onSave = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        shortcut: form.shortcut.trim(),
        body: form.body.trim(),
        brand_id: form.brand_id === "" ? null : Number(form.brand_id),
        is_active: form.is_active,
      };
      if (editingId) {
        await updateSavedReply(editingId, payload);
      } else {
        await createSavedReply(payload);
      }
      setForm(emptyForm());
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (row: ApiSavedReply) => {
    setEditingId(row.id);
    setForm({
      title: row.title,
      shortcut: row.shortcut,
      body: row.body,
      brand_id: row.brand_id ?? "",
      is_active: row.is_active,
    });
  };

  const onArchive = async (id: number) => {
    if (!canManage) return;
    try {
      await archiveSavedReply(id);
      if (editingId === id) {
        setEditingId(null);
        setForm(emptyForm());
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Archive failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Saved Replies"
        desc="Slash shortcuts in Inbox and Live Visitors. Brand-specific replies override organization defaults with the same shortcut."
      />
      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}

      {canManage && (
        <Card className="mb-4 space-y-3 p-4">
          <p className="text-sm font-medium">{editingId ? "Edit reply" : "New reply"}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Title</span>
              <input className="h-9 w-full rounded-md border bg-background px-3" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Shortcut</span>
              <input className="h-9 w-full rounded-md border bg-background px-3" placeholder="/hello" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-muted-foreground">Message body</span>
              <textarea className="min-h-[5rem] w-full rounded-md border bg-background px-3 py-2" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Brand scope</span>
              <select className="h-9 w-full rounded-md border bg-background px-3" value={form.brand_id === "" ? "" : String(form.brand_id)} onChange={(e) => setForm({ ...form, brand_id: e.target.value === "" ? "" : Number(e.target.value) })}>
                <option value="">Organization-wide</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm md:mt-6">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex gap-2">
            <Btn type="button" disabled={saving} onClick={() => void onSave()}>{saving ? "Saving…" : editingId ? "Update" : "Create"}</Btn>
            {editingId && (
              <Btn type="button" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Cancel</Btn>
            )}
          </div>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        <input
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
          placeholder="Search title, shortcut, or body"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Shortcut</th>
              <th className="p-3">Title</th>
              <th className="p-3">Scope</th>
              <th className="p-3">Status</th>
              <th className="p-3">Body</th>
              {canManage && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>No saved replies yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="p-3"><code className="text-xs">{r.shortcut}</code></td>
                <td className="p-3 font-medium">{r.title}</td>
                <td className="p-3">{r.brand_id ? (r.brand_name ?? `Brand #${r.brand_id}`) : "Organization"}</td>
                <td className="p-3">
                  {r.archived_at ? <Badge tone="warning">Archived</Badge> : r.is_active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                </td>
                <td className="p-3 text-muted-foreground"><span className="line-clamp-3 whitespace-pre-wrap">{r.body}</span></td>
                {canManage && (
                  <td className="p-3 text-right whitespace-nowrap">
                    <button type="button" className="text-xs text-primary underline" onClick={() => onEdit(r)}>Edit</button>
                    {" · "}
                    <button type="button" className="text-xs text-destructive underline" onClick={() => void onArchive(r.id)}>Archive</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
