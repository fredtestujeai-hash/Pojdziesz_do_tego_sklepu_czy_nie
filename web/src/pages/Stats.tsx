import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, PiggyBank, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { STORE_META, STORES, supabase, zl, type Store } from "../lib/supabase";
import { Empty, PageHeader } from "../components/ui";

// Paleta wykresów zwalidowana pod CVD (jasny i ciemny motyw)
const CHART: Record<Store, string> = { lidl: "#3b82f6", biedronka: "#ef4444", aldi: "#14a37f" };
const axis = { stroke: "currentColor", strokeOpacity: 0.35, fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = {
  contentStyle: { borderRadius: 16, border: "none", boxShadow: "0 8px 24px -8px rgba(0,0,0,.25)", background: "var(--tip-bg, #fff)", color: "inherit", fontSize: 12 },
  formatter: (v: unknown) => zl(Number(v)),
};

type Item = { product_name: string; category: string; store: Store | null; purchase_date: string; total_price: number; discount: number; overpaid: number | null; best_known_price: number | null; eff_unit_price: number };
type Hist = { product_name: string; store: Store; date: string; price: number; source: string };
type Month = { month: string; store: Store | null; spent: number; saved_discounts: number };

const RANGES = { "3m": 3, "12m": 12, all: 999 } as const;

export default function Stats() {
  const [range, setRange] = useState<keyof typeof RANGES>("12m");
  const [items, setItems] = useState<Item[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [promoSavings, setPromoSavings] = useState(0);
  const [product, setProduct] = useState("");

  useEffect(() => {
    const from = new Date();
    from.setMonth(from.getMonth() - RANGES[range]);
    const f = range === "all" ? "1900-01-01" : from.toISOString().slice(0, 10);
    Promise.all([
      supabase.from("v_receipt_item_stats").select("product_name,category,store,purchase_date,total_price,discount,overpaid,best_known_price,eff_unit_price").gte("purchase_date", f).limit(10000),
      supabase.from("v_monthly_stats").select("*").gte("month", f.slice(0, 8) + "01"),
      supabase.from("list_items").select("best_price,regular_price,quantity,created_at").not("regular_price", "is", null).gte("created_at", f),
    ]).then(([a, b, c]) => {
      setItems((a.data as Item[]) ?? []);
      setMonths((b.data as Month[]) ?? []);
      setPromoSavings((c.data ?? []).reduce((s: number, r: any) => s + Math.max(0, (r.regular_price - (r.best_price ?? r.regular_price)) * r.quantity), 0));
    });
  }, [range]);

  useEffect(() => {
    if (!product) return setHist([]);
    supabase.from("v_price_history").select("*").ilike("product_name", `%${product}%`).order("date").limit(500).then(({ data }) => setHist((data as Hist[]) ?? []));
  }, [product]);

  const kpi = useMemo(() => {
    const spent = months.reduce((a, m) => a + Number(m.spent ?? 0), 0);
    const discounts = months.reduce((a, m) => a + Number(m.saved_discounts ?? 0), 0);
    const overpaid = items.reduce((a, i) => a + Number(i.overpaid ?? 0), 0);
    return { spent, discounts, overpaid };
  }, [months, items]);

  const monthly = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>();
    for (const r of months) {
      const k = r.month.slice(0, 7);
      const row = m.get(k) ?? { month: new Date(r.month).toLocaleDateString("pl-PL", { month: "short", year: "2-digit" }), key: k };
      row[r.store ?? "inne"] = Number(row[r.store ?? "inne"] ?? 0) + Number(r.spent);
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [months]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.category ?? "inne", (m.get(i.category ?? "inne") ?? 0) + Number(i.total_price));
    return [...m.entries()].map(([category, value]) => ({ category, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);
  }, [items]);

  const topOverpaid = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if ((i.overpaid ?? 0) > 0.01) m.set(i.product_name, (m.get(i.product_name) ?? 0) + Number(i.overpaid));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  const products = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) c.set(i.product_name, (c.get(i.product_name) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([p]) => p);
  }, [items]);

  const histData = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>();
    for (const h of hist) {
      const row = m.get(h.date) ?? { date: h.date };
      const prev = row[h.store] as number | undefined;
      row[h.store] = prev == null ? Number(h.price) : Math.min(prev, Number(h.price));
      m.set(h.date, row);
    }
    return [...m.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [hist]);
  const histStores = STORES.filter((s) => hist.some((h) => h.store === s));

  const presentStores = STORES.filter((s) => months.some((m) => m.store === s));

  return (
    <div className="[--tip-bg:#fff] dark:[--tip-bg:#1f2235]">
      <PageHeader title="Statystyki" subtitle="Na podstawie paragonów i list" />
      <div className="card p-1 grid grid-cols-3 mb-4 text-sm font-semibold">
        {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={`py-2 rounded-[20px] ${range === r ? "bg-ink text-white dark:bg-white dark:text-ink" : "muted"}`}>
            {r === "3m" ? "3 mies." : r === "12m" ? "12 mies." : "Wszystko"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <Kpi icon={<Wallet size={18} />} label="Wydano" value={zl(kpi.spent)} />
        <Kpi icon={<PiggyBank size={18} />} label="Zaoszczędzono" value={zl(kpi.discounts + promoSavings)} hint={`rabaty z paragonów ${zl(kpi.discounts)} + promocje z list ${zl(promoSavings)}`} good />
        <Kpi icon={<TrendingUp size={18} />} label="Przepłacono" value={zl(kpi.overpaid)} hint="vs najtańsza znana cena ±7 dni" bad />
        <Kpi icon={<TrendingDown size={18} />} label="Średnio / mies." value={zl(monthly.length ? kpi.spent / monthly.length : 0)} />
      </div>

      {!items.length && !months.length ? (
        <Empty icon={<BarChart3 />} title="Brak danych" text="Dodaj kilka paragonów — tu pojawią się wydatki, oszczędności i historia cen." />
      ) : (
        <>
          <Section title="Wydatki miesięcznie">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} barCategoryGap="30%">
                <CartesianGrid vertical={false} strokeOpacity={0.08} />
                <XAxis dataKey="month" {...axis} />
                <YAxis {...axis} width={44} tickFormatter={(v) => `${v}`} />
                <Tooltip {...tip} cursor={{ fillOpacity: 0.05 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-ink dark:text-white">{v}</span>} />
                {presentStores.map((s, i) => (
                  <Bar key={s} dataKey={s} name={STORE_META[s].name} stackId="a" fill={CHART[s]} stroke="var(--tip-bg)" strokeWidth={2}
                    radius={i === presentStores.length - 1 ? [4, 4, 0, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Section>

          <Section title="Na co idą pieniądze">
            <div className="space-y-2">
              {byCategory.map((c) => (
                <div key={c.category} className="text-sm">
                  <div className="flex justify-between mb-1"><span className="font-medium">{c.category}</span><span className="font-semibold">{zl(c.value)}</span></div>
                  <div className="h-2 rounded-full bg-black/[.05] dark:bg-white/[.07]"><div className="h-2 rounded-full bg-brand" style={{ width: `${(c.value / byCategory[0].value) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </Section>

          {topOverpaid.length > 0 && (
            <Section title="Gdzie przepłacacie najbardziej">
              <div className="divide-y divide-black/5 dark:divide-white/5">
                {topOverpaid.map(([p, v]) => (
                  <button key={p} className="w-full py-2 flex justify-between text-sm text-left" onClick={() => setProduct(p)}>
                    <span>{p}</span><span className="font-semibold text-orange-600 dark:text-orange-400">+{zl(v)}</span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Historia cen produktu">
            <input className="input mb-2" list="products" placeholder="Wpisz lub wybierz produkt, np. masło" value={product} onChange={(e) => setProduct(e.target.value)} />
            <datalist id="products">{products.map((p) => <option key={p} value={p} />)}</datalist>
            {histData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={histData}>
                  <CartesianGrid vertical={false} strokeOpacity={0.08} />
                  <XAxis dataKey="date" {...axis} tickFormatter={(d) => new Date(d).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} />
                  <YAxis {...axis} width={44} domain={["auto", "auto"]} />
                  <Tooltip {...tip} labelFormatter={(d) => new Date(String(d)).toLocaleDateString("pl-PL")} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-ink dark:text-white">{v}</span>} />
                  {histStores.map((s) => (
                    <Line key={s} type="monotone" dataKey={s} name={STORE_META[s].name} stroke={CHART[s]} strokeWidth={2} connectNulls dot={{ r: 4, strokeWidth: 2, stroke: "var(--tip-bg)" }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : product ? <p className="muted text-sm">Brak notowań dla „{product}”.</p> : null}
            <p className="muted text-xs mt-1">Ceny z paragonów i promocji (najniższa danego dnia w sklepie).</p>
          </Section>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, good, bad }: { icon: React.ReactNode; label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="card p-4">
      <div className={`size-8 rounded-xl grid place-items-center mb-2 ${good ? "bg-emerald-500/15 text-emerald-600" : bad ? "bg-orange-500/15 text-orange-600" : "bg-brand/10 text-brand"}`}>{icon}</div>
      <p className="muted text-xs">{label}</p>
      <p className="text-xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="muted text-[10px] leading-tight mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 mb-4">
      <h2 className="font-bold mb-3">{title}</h2>
      {children}
    </section>
  );
}
