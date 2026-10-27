import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { canned } from "@/lib/sample-data";

export const Route = createFileRoute("/canned-replies")({
  head: () => ({
    meta: [
      { title: "Canned Replies · BrandConnect" },
      { name: "description", content: "Saved responses agents insert with shortcuts." },
      { property: "og:title", content: "Canned Replies · BrandConnect" },
      { property: "og:description", content: "Saved responses agents insert with shortcuts." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Canned Replies" desc="Type the shortcut in the reply box to insert" action={<Btn>New reply</Btn>} />
    <Table head={["Shortcut","Title","Brand","Message"]}
      rows={canned.map(c => [<code className="text-xs text-accent-foreground">{c.shortcut}</code>, <span className="font-medium">{c.title}</span>, c.brand, <span className="text-muted-foreground">{c.text}</span>])} />
  </>);
}
