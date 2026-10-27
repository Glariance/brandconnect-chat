import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { brands } from "@/lib/sample-data";

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
  const [origin, setOrigin] = useState("https://your-app-address");
  useEffect(() => setOrigin(window.location.origin), []);
  return (<>
    <PageHeader title="Brands" desc="Each brand has its own widget, team, rules and reports" action={<Btn>Add brand</Btn>} />
    <div className="grid gap-4 lg:grid-cols-3">
      {brands.map(b => (
        <Card key={b.id} className="p-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg" style={{ background: b.color }} />
            <div><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">{b.domain} · {b.tz}</p></div>
          </div>
          <div className="mt-4 flex gap-4 text-sm"><span>{b.agents} agents</span><span>{b.chats} chats</span></div>
          <p className="mt-4 text-xs text-muted-foreground">Install snippet</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{`<script src="${origin}/widget.js" data-brand-id="${b.publicId}" defer></script>`}</pre>
          <Link to="/widget-demo" search={{ brand: b.publicId }} reloadDocument className="mt-3 inline-block text-sm font-medium text-primary underline">Preview on demo site →</Link>
        </Card>
      ))}
    </div>
  </>);
}
