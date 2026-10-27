import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { team } from "@/lib/sample-data";
const dot = { online: "bg-success", away: "bg-warning", offline: "bg-muted-foreground" } as const;

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team · BrandConnect" },
      { name: "description", content: "Agents, roles and brand access." },
      { property: "og:title", content: "Team · BrandConnect" },
      { property: "og:description", content: "Agents, roles and brand access." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Team" desc="Roles: owner, admin, brand manager, agent, read-only analyst" action={<Btn>Invite member</Btn>} />
    <Table head={["Name","Email","Role","Brands","Status"]}
      rows={team.map(t => [<span className="font-medium">{t.name}</span>, t.email, <Badge tone="primary">{t.role}</Badge>, t.brands, <span className="flex items-center gap-2 capitalize"><span className={`size-2 rounded-full ${dot[t.status as keyof typeof dot]}`} />{t.status}</span>])} />
  </>);
}
