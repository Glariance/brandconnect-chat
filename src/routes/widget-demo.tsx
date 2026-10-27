import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { brands as sampleBrands } from "@/lib/sample-data";
import { isRealChatEnabled } from "@/lib/api";
import { fetchBrands, type ApiBrand } from "@/lib/chat-api";

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
  const { brand: publicId } = Route.useSearch();
  const [apiBrands, setApiBrands] = useState<ApiBrand[]>([]);
  const real = isRealChatEnabled();

  useEffect(() => {
    if (!real) return;
    void fetchBrands().then(setApiBrands).catch(() => setApiBrands([]));
  }, [real]);

  const options = real && apiBrands.length > 0
    ? apiBrands.map((b) => ({ id: String(b.id), name: b.name, domain: b.domain ?? "", color: b.color, publicId: b.public_id }))
    : sampleBrands.map((b) => ({ id: b.id, name: b.name, domain: b.domain, color: b.color, publicId: b.publicId }));

  const brand = options.find((b) => b.publicId === publicId) ?? options[0];

  useEffect(() => {
    if (!brand) return;
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
    s.setAttribute("data-brand-id", brand.publicId);
    s.setAttribute("data-color", brand.color);
    s.setAttribute("data-bc-demo", "1");
    s.defer = true;
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [brand?.publicId, brand?.color]);

  if (!brand) {
    return <div className="p-8 text-sm text-muted-foreground">No brands available. Create one in the dashboard first.</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-xs">
        <span className="text-muted-foreground">Demo site preview — pick a brand:</span>
        {options.map((b) => (
          <a key={b.id} href={`/widget-demo?brand=${b.publicId}`} className={`rounded px-2 py-1 ${b.publicId === brand.publicId ? "bg-card font-medium" : "hover:bg-card"}`}>{b.name}</a>
        ))}
        <Link to="/inbox" className="ml-auto underline">Open Inbox →</Link>
      </div>
      <header className="flex items-center gap-3 px-8 py-6">
        <div className="size-9 rounded-lg" style={{ background: brand.color }} />
        <span className="text-lg font-semibold">{brand.name}</span>
        <span className="ml-auto text-sm text-muted-foreground">{brand.domain}</span>
      </header>
      <section className="mx-auto max-w-3xl px-8 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Welcome to {brand.name}</h1>
        <p className="mt-4 text-muted-foreground">
          This is a pretend brand website. Use the chat button to talk to agents in the Inbox.
          {real ? " Messages persist through the Laravel API." : " Demo mode uses browser-local storage only."}
        </p>
      </section>
    </div>
  );
}
