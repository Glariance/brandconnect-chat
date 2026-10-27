import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { brands } from "@/lib/sample-data";

export const Route = createFileRoute("/widget-demo")({
  validateSearch: (s: Record<string, unknown>) => ({ brand: String(s["brand"] ?? brands[0]!.publicId) }),
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
  const brand = brands.find((b) => b.publicId === publicId) ?? brands[0]!;
  useEffect(() => {
    const s = document.createElement("script");
    s.src = `${location.origin}/widget.js`;
    s.setAttribute("data-brand-id", brand.publicId);
    document.body.appendChild(s);
  }, [brand.publicId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-xs">
        <span className="text-muted-foreground">Demo site preview — pick a brand:</span>
        {brands.map((b) => (
          <a key={b.id} href={`/widget-demo?brand=${b.publicId}`} className={`rounded px-2 py-1 ${b.id === brand.id ? "bg-card font-medium" : "hover:bg-card"}`}>{b.name}</a>
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
        <p className="mt-4 text-muted-foreground">This is a pretend brand website. The chat button in the bottom-right corner is the BrandConnect widget — send a message and it shows up in the Inbox.</p>
      </section>
    </div>
  );
}
