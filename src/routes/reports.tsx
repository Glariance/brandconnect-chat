import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Card, Badge, Btn, Table } from "@/components/app-shell";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { weekly } from "@/lib/sample-data";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · BrandConnect" },
      { name: "description", content: "Chat volume, response times and conversion." },
      { property: "og:title", content: "Reports · BrandConnect" },
      { property: "og:description", content: "Chat volume, response times and conversion." },
    ],
  }),
  component: Page,
});

function Page() {
  return (<>
    <PageHeader title="Reports" desc="Conversion = conversations started ÷ trigger impressions" action={<Btn variant="outline">Export</Btn>} />
    <div className="grid gap-4 sm:grid-cols-3 mb-4">
      {[["Chats", "635"], ["Leads", "167"], ["Chat → lead", "26.3%"]].map(([k, v]) => <Card key={k} className="p-4"><p className="text-sm text-muted-foreground">{k}</p><p className="text-2xl font-semibold">{v}</p></Card>)}
    </div>
    <Card className="p-4"><div className="h-72"><ResponsiveContainer>
      <BarChart data={weekly}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" fontSize={12} /><YAxis fontSize={12} />
        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} />
        <Bar dataKey="chats" fill="var(--chart-1)" radius={4} /><Bar dataKey="leads" fill="var(--chart-2)" radius={4} /></BarChart>
    </ResponsiveContainer></div></Card>
  </>);
}
