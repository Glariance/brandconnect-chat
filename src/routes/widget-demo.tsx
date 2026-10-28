import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { brands as sampleBrands } from "@/lib/sample-data";
import { isAbortError, isRealChatEnabled } from "@/lib/api";
import { fetchBrands, fetchWidgetConfig, type ApiBrand, type WidgetConfig } from "@/lib/chat-api";
import {
  friendlyWidgetConfigMessage,
  resolveRealModeBrandPublicId,
} from "@/lib/widget-demo";

export const Route = createFileRoute("/widget-demo")({
  validateSearch: (s: Record<string, unknown>) => ({ brand: String(s["brand"] ?? "") }),
  head: () => ({
    meta: [
      { title: "Widget demo site · BrandConnect" },
      { name: "description", content: "Sample brand website with the BrandConnect chat widget installed." },
      { property: "og:title", content: "Widget demo site · BrandConnect" },
      { property: "og:description", content: "Sample brand website with the BrandConnect chat widget installed." },
    ],
  }),
  component: Demo,
});

function Demo() {
  return isRealChatEnabled() ? <RealWidgetDemo /> : <SampleWidgetDemo />;
}

type DemoBrand = {
  id: string;
  name: string;
  domain: string;
  color: string;
  publicId: string;
};

function injectWidget(publicId: string, color: string) {
  document.querySelectorAll("script[data-bc-demo]").forEach((n) => n.remove());
  const existing = document.querySelector('iframe[title="Chat with us"]');
  existing?.remove();
  document.querySelectorAll('button[aria-label="Open chat"],button[aria-label="Close chat"]').forEach((n) => {
    if (n.parentElement === document.body) n.remove();
  });
  // Reset loader singleton so brand switches re-inject cleanly in demos.
  // @ts-expect-error demo reset
  window.__bcWidget = false;
  const s = document.createElement("script");
  s.src = `${location.origin}/widget.js`;
  s.setAttribute("data-brand-id", publicId);
  s.setAttribute("data-color", color);
  s.setAttribute("data-bc-demo", "1");
  s.defer = true;
  document.body.appendChild(s);
  return () => {
    s.remove();
  };
}

/** Explicit demo mode — sample brand tabs only. */
function SampleWidgetDemo() {
  const { brand: publicId } = Route.useSearch();
  const options: DemoBrand[] = sampleBrands.map((b) => ({
    id: b.id,
    name: b.name,
    domain: b.domain,
    color: b.color,
    publicId: b.publicId,
  }));
  const brand = options.find((b) => b.publicId === publicId) ?? options[0];

  useEffect(() => {
    if (!brand) return;
    return injectWidget(brand.publicId, brand.color);
  }, [brand?.publicId, brand?.color]);

  if (!brand) {
    return <div className="p-8 text-sm text-muted-foreground">No sample brands available.</div>;
  }

  return (
    <DemoChrome
      brand={brand}
      tabs={options}
      banner="Demo site preview (sample data) — pick a brand:"
      note="Demo mode uses browser-local storage only."
    />
  );
}

/** Real mode — preserve exact URL public ID; load name/color from the API. */
function RealWidgetDemo() {
  const { brand: urlBrand } = Route.useSearch();
  const publicId = resolveRealModeBrandPublicId(urlBrand);

  const [apiBrands, setApiBrands] = useState<ApiBrand[]>([]);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void fetchBrands({ signal: ac.signal })
      .then(setApiBrands)
      .catch((e) => {
        if (!isAbortError(e)) setApiBrands([]);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!publicId) {
      setConfig(null);
      setLoading(false);
      setSetupMessage(
        "Missing brand ID. Open this page from Brands → Preview, or add ?brand=YOUR_PUBLIC_ID to the URL.",
      );
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setSetupMessage(null);
    setConfig(null);

    void fetchWidgetConfig(publicId, { signal: ac.signal })
      .then((cfg) => {
        setConfig(cfg);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbortError(e)) return;
        setConfig(null);
        setLoading(false);
        setSetupMessage(friendlyWidgetConfigMessage(e));
      });

    return () => ac.abort();
  }, [publicId]);

  useEffect(() => {
    if (!publicId || !config) return;
    // Always inject the exact URL public ID — never a substituted sample ID.
    return injectWidget(publicId, config.color);
  }, [publicId, config?.color, config?.public_id]);

  const tabs: DemoBrand[] = apiBrands.map((b) => ({
    id: String(b.id),
    name: b.name,
    domain: b.domain ?? "",
    color: b.color,
    publicId: b.public_id,
  }));

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading brand…</div>;
  }

  if (!publicId || !config || setupMessage) {
    return (
      <div className="space-y-4 p-8 text-sm">
        <p className="text-muted-foreground" role="status">
          {setupMessage ?? "This brand isn't set up for chat yet."}
        </p>
        {tabs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Try one of your brands:</span>
            {tabs.map((b) => (
              <a
                key={b.id}
                href={`/widget-demo?brand=${encodeURIComponent(b.publicId)}`}
                className="rounded px-2 py-1 text-xs underline hover:bg-muted"
              >
                {b.name}
              </a>
            ))}
          </div>
        ) : (
          <Link to="/brands" className="inline-block text-primary underline">
            Create a brand in the dashboard →
          </Link>
        )}
        <div>
          <Link to="/inbox" className="underline">Open Inbox →</Link>
        </div>
      </div>
    );
  }

  const brand: DemoBrand = {
    id: publicId,
    name: config.name,
    domain: "",
    color: config.color,
    publicId,
  };

  return (
    <DemoChrome
      brand={brand}
      tabs={tabs}
      banner="Live preview — pick one of your API brands:"
      note="Messages persist through the Laravel API."
      highlightPublicId={publicId}
    />
  );
}

function DemoChrome({
  brand,
  tabs,
  banner,
  note,
  highlightPublicId,
}: {
  brand: DemoBrand;
  tabs: DemoBrand[];
  banner: string;
  note: string;
  highlightPublicId?: string;
}) {
  const activeId = highlightPublicId ?? brand.publicId;
  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-xs">
        <span className="text-muted-foreground">{banner}</span>
        {tabs.map((b) => (
          <a
            key={b.id}
            href={`/widget-demo?brand=${encodeURIComponent(b.publicId)}`}
            className={`rounded px-2 py-1 ${b.publicId === activeId ? "bg-card font-medium" : "hover:bg-card"}`}
          >
            {b.name}
          </a>
        ))}
        <Link to="/inbox" className="ml-auto underline">Open Inbox →</Link>
      </div>
      <header className="flex items-center gap-3 px-8 py-6">
        <div className="size-9 rounded-lg" style={{ background: brand.color }} />
        <span className="text-lg font-semibold">{brand.name}</span>
        {brand.domain ? (
          <span className="ml-auto text-sm text-muted-foreground">{brand.domain}</span>
        ) : (
          <span className="ml-auto text-sm text-muted-foreground">Public ID · {brand.publicId}</span>
        )}
      </header>
      <section className="mx-auto max-w-3xl px-8 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Welcome to {brand.name}</h1>
        <p className="mt-4 text-muted-foreground">
          This is a pretend brand website. Use the chat button to talk to agents in the Inbox. {note}
        </p>
      </section>
    </div>
  );
}
