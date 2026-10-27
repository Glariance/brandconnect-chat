import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, PageHeader, Badge } from "@/components/app-shell";
import { brands, conversations, weekly } from "@/lib/sample-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview · BrandConnect" },
      { name: "description", content: "Live chat and lead overview across all your brands." },
      { property: "og:title", content: "Overview · BrandConnect" },
      { property: "og:description", content: "Live chat and lead overview across all your brands." },
    ],
  }),
  component: Overview,
});

const stats = [
  { label: "Open conversations", value: "23", delta: "+4 today" },
  { label: "Live visitors", value: "148", delta: "12 on pricing pages" },
  { label: "Leads this week", value: "167", delta: "+18% vs last week" },
  { label: "Median first response", value: "38s", delta: "Target: 60s" },
];

function Overview() {
  return (
    <>
      <PageHeader title="Overview" desc="All brands · last 7 days" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-3xl font-semibold">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.delta}</p>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <h2 className="mb-3 font-medium">Conversations & leads</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Area dataKey="chats" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} />
                <Area dataKey="leads" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Brands</h2>
          <ul className="space-y-3">
            {brands.map((b) => (
              <li key={b.id} className="flex items-center gap-3">
                <span className="size-3 rounded-full" style={{ background: b.color }} />
                <span className="flex-1 text-sm">{b.name}</span>
                <span className="text-sm text-muted-foreground">{b.chats} chats</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="mt-4 p-4">
        <h2 className="mb-3 font-medium">Needs attention</h2>
        <ul className="divide-y">
          {conversations.filter((c) => c.status === "open").map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="font-medium">{c.name}</span>
              <span className="truncate text-muted-foreground">{c.last}</span>
              <span className="ml-auto"><Badge tone="primary">{c.brand}</Badge></span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
