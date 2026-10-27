import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { contacts } from "@/lib/sample-data";
const tone = { New: "primary", Qualified: "warning", Callback: "default", Won: "success", Lost: "danger" } as const;

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts & Leads · BrandConnect" },
      { name: "description", content: "Leads and contacts captured from chats." },
      { property: "og:title", content: "Contacts & Leads · BrandConnect" },
      { property: "og:description", content: "Leads and contacts captured from chats." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Contacts & Leads" desc="Captured from conversations and offline messages" action={<Btn variant="outline">Export CSV</Btn>} />
    <Table head={["Name","Email","Brand","Stage","Owner","Created"]}
      rows={contacts.map(c => [<span className="font-medium">{c.name}</span>, c.email, c.brand, <Badge tone={tone[c.stage as keyof typeof tone]}>{c.stage}</Badge>, c.owner, c.created])} />
  </>);
}
