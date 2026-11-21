import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, LogOut, Plus, ShoppingBasket, Sparkles } from "lucide-react";
import { supabase, zl, type ShoppingList } from "../lib/supabase";
import { Empty, PageHeader } from "../components/ui";

type Row = ShoppingList & { list_items: { count: number }[] };

export default function Lists() {
  const [lists, setLists] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const nav = useNavigate();

  async function load() {
    const { data } = await supabase.from("shopping_lists").select("*, list_items(count)").order("created_at", { ascending: false }).limit(50);
    setLists((data as Row[]) ?? []);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("lists").on("postgres_changes", { event: "*", schema: "public", table: "shopping_lists" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim() || `Zakupy ${new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}`;
    const { data, error } = await supabase.from("shopping_lists").insert({ name: n }).select().single();
    if (!error && data) nav(`/lista/${data.id}`);
  }

  const status = { draft: ["Szkic", "bg-amber-500/15 text-amber-600"], optimized: ["Gotowa trasa", "bg-emerald-500/15 text-emerald-600"], done: ["Zrobione", "bg-black/5 dark:bg-white/10 muted"] } as const;

  return (
    <>
      <PageHeader
        title="Listy zakupów"
        subtitle="Wspólne, na żywo — dla Was dwojga"
        right={<button className="btn-ghost !p-3" onClick={() => supabase.auth.signOut()} title="Wyloguj"><LogOut size={18} /></button>}
      />
      <form onSubmit={create} className="card p-2 flex gap-2 mb-5">
        <input className="input !bg-transparent" placeholder="Nazwa nowej listy, np. Weekend" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary shrink-0"><Plus size={18} />Nowa</button>
      </form>
      {lists?.length === 0 && <Empty icon={<ShoppingBasket />} title="Brak list" text="Utwórz pierwszą listę — AI znajdzie najlepsze promocje." />}
      <div className="space-y-3">
        {lists?.map((l) => {
          const [label, cls] = status[l.status];
          const savings = l.summary ? Object.values(l.summary.per_store).reduce((a, s) => a + s.savings, 0) : 0;
          return (
            <Link key={l.id} to={`/lista/${l.id}`} className="card p-4 flex items-center gap-4 active:scale-[.99] transition">
              <div className="size-12 rounded-2xl grid place-items-center bg-gradient-to-br from-brand/15 to-brand-2/15 text-brand"><ShoppingBasket size={22} /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{l.name}</p>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <span className={`chip ${cls}`}>{label}</span>
                  <span className="muted">{l.list_items?.[0]?.count ?? 0} poz.</span>
                  {savings > 0 && <span className="chip bg-brand/10 text-brand"><Sparkles size={12} />-{zl(savings)}</span>}
                </div>
              </div>
              <ChevronRight className="muted" size={18} />
            </Link>
          );
        })}
      </div>
    </>
  );
}
