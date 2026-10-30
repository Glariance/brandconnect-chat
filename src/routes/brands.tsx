import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Card, Btn } from "@/components/app-shell";
import { brands as sampleBrands } from "@/lib/sample-data";
import { ApiError, isRealChatEnabled } from "@/lib/api";
import { createBrand, fetchBrands, updateBrand, type ApiBrand } from "@/lib/chat-api";
import { useAuth } from "@/lib/auth";
import { normalizeOriginList, OriginValidationError } from "@/lib/origin-allowlist";

export const Route = createFileRoute("/brands")({
  head: () => ({
    meta: [
      { title: "Brands · BrandConnect" },
      { name: "description", content: "Manage brands, domains and widget installation." },
      { property: "og:title", content: "Brands · BrandConnect" },
      { property: "og:description", content: "Manage brands, domains and widget installation." },
    ],
  }),
  component: Page,
});

function Page() {
  return isRealChatEnabled() ? <RealBrands /> : <DemoBrands />;
}

function DemoBrands() {
  const [origin, setOrigin] = useState("https://your-app-address");
  useEffect(() => setOrigin(window.location.origin), []);
  return (<>
    <PageHeader title="Brands" desc="Each brand has its own widget, team, rules and reports" action={<Btn type="button" disabled>Add brand</Btn>} />
    <p className="mb-4 text-xs text-muted-foreground">Demo brands (sample data). Enable the API to manage real brands.</p>
    <BrandGrid
      items={sampleBrands.map((b) => ({
        key: b.id,
        id: 0,
        name: b.name,
        domain: b.domain,
        tz: b.tz,
        color: b.color,
        publicId: b.publicId,
        meta: `${b.agents} agents · ${b.chats} chats`,
        allowedOrigins: [] as string[],
      }))}
      origin={origin}
      canManageOrigins={false}
      onSaveOrigins={async () => {}}
    />
  </>);
}

function RealBrands() {
  const { user } = useAuth();
  const canManageOrigins = user?.role === "owner" || user?.role === "admin";
  const [origin, setOrigin] = useState("https://your-app-address");
  const [items, setItems] = useState<ApiBrand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = async () => {
    try {
      setError(null);
      setItems(await fetchBrands());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load brands");
    }
  };

  useEffect(() => { void load(); }, []);

  const onCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await createBrand({ name: name.trim() });
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create brand");
    } finally {
      setCreating(false);
    }
  };

  const onSaveOrigins = async (brandId: number, origins: string[]) => {
    await updateBrand(brandId, { allowed_origins: origins });
    await load();
  };

  return (<>
    <PageHeader
      title="Brands"
      desc="Each brand has its own widget, team, rules and reports"
      action={
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New brand name"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
          <Btn type="button" onClick={() => void onCreate()} disabled={creating || !canManageOrigins}>
            {creating ? "Adding…" : "Add brand"}
          </Btn>
        </div>
      }
    />
    {error && (
      <div className="mb-3 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <span className="flex-1">{error}</span>
        <Btn variant="outline" type="button" onClick={() => void load()}>Retry</Btn>
      </div>
    )}
    <BrandGrid
      items={items.map((b) => ({
        key: String(b.id),
        id: b.id,
        name: b.name,
        domain: b.domain ?? "",
        tz: b.timezone ?? "",
        color: b.color,
        publicId: b.public_id,
        meta: `Public ID · ${b.public_id}`,
        allowedOrigins: b.allowed_origins ?? [],
      }))}
      origin={origin}
      canManageOrigins={canManageOrigins}
      onSaveOrigins={onSaveOrigins}
    />
  </>);
}

function BrandGrid({
  items,
  origin,
  canManageOrigins,
  onSaveOrigins,
}: {
  items: {
    key: string;
    id: number;
    name: string;
    domain: string;
    tz: string;
    color: string;
    publicId: string;
    meta: string;
    allowedOrigins: string[];
  }[];
  origin: string;
  canManageOrigins: boolean;
  onSaveOrigins: (brandId: number, origins: string[]) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {items.length === 0 && <p className="text-sm text-muted-foreground">No brands yet.</p>}
      {items.map((b) => (
        <Card key={b.key} className="p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg" style={{ background: b.color }} />
            <div>
              <p className="font-medium">{b.name}</p>
              <p className="text-xs text-muted-foreground">{b.domain}{b.tz ? ` · ${b.tz}` : ""}</p>
            </div>
          </div>
          <div className="mt-4 text-sm text-muted-foreground">{b.meta}</div>
          <p className="mt-4 text-xs text-muted-foreground">Install snippet</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{`<script src="${origin}/widget.js" data-brand-id="${b.publicId}" defer></script>`}</pre>
          <Link to="/widget-demo" search={{ brand: b.publicId }} reloadDocument className="mt-3 inline-block text-sm font-medium text-primary underline">Preview on demo site →</Link>
          {b.id > 0 && (
            <ApprovedOriginsEditor
              brandId={b.id}
              initial={b.allowedOrigins}
              canEdit={canManageOrigins}
              onSave={onSaveOrigins}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

function ApprovedOriginsEditor({
  brandId,
  initial,
  canEdit,
  onSave,
}: {
  brandId: number;
  initial: string[];
  canEdit: boolean;
  onSave: (brandId: number, origins: string[]) => Promise<void>;
}) {
  const [text, setText] = useState(initial.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(initial.join("\n"));
  }, [initial]);

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const normalized = normalizeOriginList(lines, true);
      await onSave(brandId, normalized);
    } catch (e) {
      setError(
        e instanceof OriginValidationError || e instanceof ApiError
          ? e.message
          : "Could not save approved origins",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-xs font-medium">Approved embed origins</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Exact scheme + host + optional port (one per line). www and non-www are separate. No wildcards or paths.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canEdit}
        rows={3}
        placeholder={"https://www.example.com\nhttps://example.com"}
        className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs disabled:opacity-60"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {canEdit && (
        <Btn type="button" className="mt-2" variant="outline" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save origins"}
        </Btn>
      )}
    </div>
  );
}
