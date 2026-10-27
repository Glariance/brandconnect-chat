import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { audit } from "@/lib/sample-data";

export const Route = createFileRoute("/audit-log")({
  head: () => ({
    meta: [
      { title: "Audit Log · BrandConnect" },
      { name: "description", content: "Every sensitive action, recorded." },
      { property: "og:title", content: "Audit Log · BrandConnect" },
      { property: "og:description", content: "Every sensitive action, recorded." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Audit Log" desc="Exports, permission changes and settings updates" />
    <Table head={["When","Actor","Action","Target"]} rows={audit.map(a => [<span className="text-muted-foreground">{a.when}</span>, a.actor, a.action, a.target])} />
  </>);
}
