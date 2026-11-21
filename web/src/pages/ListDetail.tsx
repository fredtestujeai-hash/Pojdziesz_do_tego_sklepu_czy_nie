import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Minus, Pencil, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { STORE_META, STORES, supabase, zl, type ListItem, type ShoppingList, type Store } from "../lib/supabase";
import { runAi } from "../lib/api";
import { ErrorBox, Progress, StoreBadge } from "../components/ui";

export default function ListDetail() {
  const { id } = useParams();
  const [list, setList] = useState<ShoppingList | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"edit" | "shop">("edit");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const nav = useNavigate();

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return;
    setRenaming(false);
    setList((l) => (l ? { ...l, name: n } : l));
    const { error } = await supabase.from("shopping_lists").update({ name: n }).eq("id", id);
    if (error) setErr("Nie udało się zmienić nazwy: " + error.message);
  }
  async function deleteList() {
    const { error } = await supabase.from("shopping_lists").delete().eq("id", id);
    if (error) { setErr("Nie udało się usunąć listy: " + error.message); setConfirmDel(false); return; }
    nav("/");
  }

  async function load() {
    const [{ data: l }, { data: it }] = await Promise.all([
      supabase.from("shopping_lists").select("*").eq("id", id).single(),
      supabase.from("list_items").select("*").eq("list_id", id).order("position"),
    ]);
    setList(l as ShoppingList);
    setItems((it as ListItem[]) ?? []);
    if (l?.status === "optimized") setView("shop");
  }
  useEffect(() => {
    load();
    const ch = supabase
      .channel("list-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "list_items", filter: `list_id=eq.${id}` }, () => reloadItems())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shopping_lists", filter: `id=eq.${id}` }, (p) => setList(p.new as ShoppingList))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);
  async function reloadItems() {
    const { data } = await supabase.from("list_items").select("*").eq("list_id", id).order("position");
    setItems((data as ListItem[]) ?? []);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const pos = items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0;
    await supabase.from("list_items").insert({ list_id: id, name: name.trim(), quantity: qty, note: note.trim() || null, position: pos });
    setName(""); setQty(1); setNote("");
    reloadItems();
  }
  async function patch(itemId: string, v: Partial<ListItem>) {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, ...v } : x)));
    await supabase.from("list_items").update(v).eq("id", itemId);
  }
  async function remove(itemId: string) {
    setItems((xs) => xs.filter((x) => x.id !== itemId));
    await supabase.from("list_items").delete().eq("id", itemId);
  }
  async function moveTo(itemId: string, store: Store) {
    const it = items.find((i) => i.id === itemId);
    const alt = it?.alternatives?.find((a) => a.store === store);
    await patch(itemId, { assigned_store: store, ...(alt ? { best_price: alt.price, promo_label: alt.label } : { best_price: null, promo_label: "przeniesione ręcznie" }) });
  }

  async function optimize() {
    setErr(""); setBusy("Dobieram oferty…");
    try {
      await runAi({ action: "optimize_list", list_id: id }, setBusy);
      await load();
      setView("shop");
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  const grouped = useMemo(() => {
    const g: Record<string, ListItem[]> = {};
    for (const it of items) (g[it.assigned_store ?? "none"] ??= []).push(it);
    return g;
  }, [items]);

  const totals = useMemo(() => {
    let total = 0, savings = 0;
    for (const i of items) {
      if (i.best_price != null) total += i.best_price * i.quantity;
      if (i.best_price != null && i.regular_price != null && i.regular_price > i.best_price) savings += (i.regular_price - i.best_price) * i.quantity;
    }
    return { total, savings };
  }, [items]);

  const optimized = items.some((i) => i.assigned_store);

  return (
    <>
      <div className="flex items-center gap-3 pt-2 pb-4">
        <Link to="/" className="btn-ghost !p-3"><ArrowLeft size={18} /></Link>
        {renaming ? (
          <form onSubmit={saveName} className="flex-1 min-w-0 flex gap-2">
            <input id="listName" className="input !py-2" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label="Nazwa listy" />
            <button className="btn-primary !px-3 !py-2" aria-label="Zapisz nazwę"><Check size={18} /></button>
            <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => setRenaming(false)} aria-label="Anuluj"><X size={18} /></button>
          </form>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight truncate">{list?.name ?? "…"}</h1>
              <p className="muted text-xs">{items.length} pozycji{list?.optimized_at && ` · oferty z ${new Date(list.optimized_at).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`}</p>
            </div>
            <button className="btn-ghost !p-3" onClick={() => { setNewName(list?.name ?? ""); setRenaming(true); }} aria-label="Zmień nazwę listy" title="Zmień nazwę"><Pencil size={18} /></button>
            <button className="btn-ghost !p-3" onClick={() => setConfirmDel(true)} aria-label="Usuń listę" title="Usuń listę"><Trash2 size={18} /></button>
          </>
        )}
      </div>
      {confirmDel && (
        <div className="card p-4 mb-4 border-red-500/30">
          <p className="font-semibold">Usunąć listę „{list?.name}”?</p>
          <p className="muted text-sm mt-1">Zniknie razem ze wszystkimi pozycjami ({items.length}). Paragony i promocje zostaną.</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn-ghost" onClick={() => setConfirmDel(false)}>Anuluj</button>
            <button className="btn bg-red-600 text-white" onClick={deleteList}>Usuń listę</button>
          </div>
        </div>
      )}

      {optimized && (
        <div className="card p-1 grid grid-cols-2 mb-4 text-sm font-semibold">
          {(["edit", "shop"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`py-2.5 rounded-[20px] transition ${view === v ? "bg-gradient-to-r from-brand to-brand-2 text-white" : "muted"}`}>
              {v === "edit" ? "Lista" : "Gdzie kupić"}
            </button>
          ))}
        </div>
      )}

      {view === "edit" && (
        <>
          <form onSubmit={add} className="card p-3 space-y-2 mb-4">
            <input className="input" placeholder="Co kupić? np. masło 82%" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <div className="flex items-center rounded-2xl bg-black/[.04] dark:bg-white/[.06]">
                <button type="button" className="p-3" onClick={() => setQty(Math.max(1, qty - 1))}><Minus size={16} /></button>
                <span className="w-6 text-center font-bold">{qty}</span>
                <button type="button" className="p-3" onClick={() => setQty(qty + 1)}><Plus size={16} /></button>
              </div>
              <input className="input" placeholder="Uwagi (marka, gramatura)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary !px-4"><Plus size={18} /></button>
            </div>
          </form>
          <div className="space-y-2 mb-5">
            {items.map((it) => (
              <div key={it.id} className="card px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{it.name}</p>
                  <p className="muted text-xs truncate">{it.quantity} {it.unit}{it.note && ` · ${it.note}`}</p>
                </div>
                {it.assigned_store && <StoreBadge store={it.assigned_store} />}
                <button className="muted p-2" onClick={() => remove(it.id)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          {busy ? <Progress text={busy} /> : items.length > 0 && (
            <div className="space-y-2">
              <button className="btn-primary w-full !py-4 text-base" onClick={optimize}><Wand2 size={20} />Znajdź najlepsze oferty</button>
              <p className="muted text-xs text-center">
                Szuka produktów z listy w gazetkach (PDF) i kuponach dodanych w zakładce <Link to="/promocje" className="underline">Promocje</Link>.
                Pozycje bez promocji trafiają do Lidla. Koszt: kilka–kilkanaście groszy.
              </p>
            </div>
          )}
          {err && <div className="mt-3"><ErrorBox text={err} /></div>}
        </>
      )}

      {view === "shop" && (
        <>
          <div className="card p-5 mb-4 bg-gradient-to-br from-brand to-brand-2 !border-0 text-white">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white/80 text-sm">Szacowany koszt</p>
                <p className="text-3xl font-extrabold">{zl(totals.total)}</p>
              </div>
              {totals.savings > 0 && (
                <div className="text-right">
                  <p className="text-white/80 text-sm">Oszczędzasz</p>
                  <p className="text-2xl font-extrabold flex items-center gap-1"><Sparkles size={18} />{zl(totals.savings)}</p>
                </div>
              )}
            </div>
            {list?.summary?.verdict && <p className="mt-3 text-sm bg-white/15 rounded-2xl p-3 leading-relaxed">{list.summary.verdict}</p>}
          </div>

          {STORES.filter((s) => grouped[s]?.length).map((s) => {
            const its = grouped[s];
            const done = its.filter((i) => i.checked).length;
            const sum = its.reduce((a, i) => a + (i.best_price ?? 0) * i.quantity, 0);
            return (
              <section key={s} className="mb-5">
                <div className={`${STORE_META[s].bg} rounded-3xl p-4 flex items-center justify-between text-white`}>
                  <div>
                    <p className={`font-extrabold text-xl ${STORE_META[s].text}`}>{STORE_META[s].name}</p>
                    <p className="text-white/80 text-xs">{done}/{its.length} w koszyku</p>
                  </div>
                  <p className="font-extrabold text-lg">{sum > 0 ? zl(sum) : ""}</p>
                </div>
                <div className="space-y-2 mt-2">
                  {its.map((it) => (
                    <div key={it.id} className={`card p-3 transition ${it.checked ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-3">
                        <button onClick={() => patch(it.id, { checked: !it.checked })} className={`mt-0.5 size-7 shrink-0 rounded-full grid place-items-center border-2 transition ${it.checked ? "bg-emerald-500 border-emerald-500 text-white" : "border-black/15 dark:border-white/20"}`}>
                          {it.checked && <Check size={16} strokeWidth={3} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between gap-2">
                            <p className={`font-semibold ${it.checked ? "line-through" : ""}`}>{it.name} <span className="muted font-normal">×{it.quantity}</span></p>
                            <div className="text-right shrink-0">
                              <p className="font-extrabold">{zl(it.best_price)}</p>
                              {it.regular_price != null && it.best_price != null && it.regular_price > it.best_price && <p className="muted text-xs line-through">{zl(it.regular_price)}</p>}
                            </div>
                          </div>
                          {it.promo_label && <p className="text-xs mt-1 text-brand font-medium">{it.promo_label}</p>}
                          {it.ai_note && <p className="muted text-xs mt-1">{it.ai_note}</p>}
                          {!!it.alternatives?.length && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {it.alternatives.filter((a) => a.store !== s).map((a, i) => (
                                <button key={i} onClick={() => moveTo(it.id, a.store)} className="chip bg-black/[.04] dark:bg-white/[.06]" title={a.label}>
                                  → {STORE_META[a.store]?.name} {zl(a.price)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {grouped.none?.length ? <p className="muted text-sm mb-4">Nowe pozycje bez przypisania: {grouped.none.map((i) => i.name).join(", ")} — uruchom ponownie wyszukiwanie.</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setView("edit")}>Edytuj listę</button>
            <button className="btn-ghost" onClick={() => supabase.from("shopping_lists").update({ status: "done" }).eq("id", id).then(load)}>Zakończ zakupy</button>
          </div>
        </>
      )}
    </>
  );
}
