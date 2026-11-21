import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Tags, Trash2, Ticket, ExternalLink } from "lucide-react";
import { STORE_META, STORES, supabase, todayStr, zl, type Promotion, type Store } from "../lib/supabase";
import { runAi } from "../lib/api";
import { uploadFile } from "../lib/upload";
import { DropZone, Empty, ErrorBox, PageHeader, Progress, StoreBadge, usePasteImages } from "../components/ui";

export default function Promotions() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [filter, setFilter] = useState<Store | "all" | "kupon">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [couponStore, setCouponStore] = useState<Store | "">("");

  async function load() {
    const t = todayStr();
    const { data } = await supabase.from("promotions").select("*").or(`valid_to.gte.${t},valid_to.is.null`).order("store").order("price").limit(1000);
    setPromos((data as Promotion[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setErr(""); setMsg(""); setBusy("Przeglądam gazetki…");
    try {
      const job = await runAi({ action: "refresh_promotions" }, setBusy);
      const added = (job.result as any[]).reduce((a, r) => a + (r.added ?? 0), 0);
      const errs = (job.result as any[]).filter((r) => r.error);
      setMsg(`Dodano ${added} nowych promocji.` + (errs.length ? ` Problem: ${errs.map((e) => STORE_META[e.store as Store].name).join(", ")}.` : ""));
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function onImages(files: File[], kind: "kupon" | "gazetka") {
    if (!files.length || busy) return;
    setErr(""); setMsg("");
    let total = 0;
    try {
      for (const [i, f] of [...files].entries()) {
        setBusy(`Czytam ${kind === "kupon" ? "kupon" : "stronę gazetki"} ${i + 1}/${files.length}…`);
        const path = await uploadFile(f, "coupons");
        const job = await runAi({ action: "parse_coupon", image_path: path, store: couponStore || undefined, kind });
        total += job.result.added;
      }
      setMsg(`${kind === "kupon" ? "Z kuponów" : "Z gazetki"} dodano ${total} promocji.`);
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  usePasteImages((f) => onImages(f, "kupon"), !busy);

  async function del(id: string) {
    setPromos((p) => p.filter((x) => x.id !== id));
    await supabase.from("promotions").delete().eq("id", id);
  }

  const shown = useMemo(() => promos.filter((p) =>
    (filter === "all" || (filter === "kupon" ? p.source === "kupon" : p.store === filter)) &&
    (!q || `${p.product_name} ${p.brand ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [promos, filter, q]);

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "?";

  return (
    <>
      <PageHeader title="Promocje" subtitle={`${promos.length} aktywnych ofert z gazetek i kuponów`} />
      <button className="btn-primary w-full mb-3" onClick={refresh} disabled={!!busy}><RefreshCw size={18} />Odśwież gazetki z internetu</button>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <DropZone title="Kupon" text="Przeciągnij zrzuty kuponów (Lidl Plus, Moja Biedronka, Aldi) albo kliknij" accept="image/*" disabled={!!busy} onFiles={(f) => onImages(f, "kupon")} />
        <DropZone title="Gazetka" text="Przeciągnij zdjęcia lub zrzuty stron gazetki albo kliknij" accept="image/*" disabled={!!busy} onFiles={(f) => onImages(f, "gazetka")} />
      </div>
      <p className="muted text-xs mb-3">Możesz też wkleić zrzut ekranu skrótem Ctrl+V — trafi jako kupon.</p>
      <div className="flex items-center gap-2 mb-4 text-xs">
        <span className="muted">Sklep na zrzucie:</span>
        {(["", ...STORES] as const).map((s) => (
          <button key={s} onClick={() => setCouponStore(s)} className={`chip ${couponStore === s ? "bg-brand text-white" : "bg-black/[.04] dark:bg-white/[.06]"}`}>{s ? STORE_META[s].name : "auto"}</button>
        ))}
      </div>
      {busy && <div className="mb-4"><Progress text={busy} /></div>}
      {err && <div className="mb-4"><ErrorBox text={err} /></div>}
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm">{msg}</div>}

      <div className="relative mb-3">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 muted" />
        <input className="input !pl-10" placeholder="Szukaj produktu…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
        {(["all", ...STORES, "kupon"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip !px-3.5 !py-2 shrink-0 ${filter === f ? "bg-ink text-white dark:bg-white dark:text-ink" : "bg-black/[.04] dark:bg-white/[.06]"}`}>
            {f === "all" ? "Wszystkie" : f === "kupon" ? "Moje kupony" : STORE_META[f].name}
          </button>
        ))}
      </div>

      {shown.length === 0 && !busy && <Empty icon={<Tags />} title="Brak promocji" text="Kliknij „Gazetki”, żeby AI przejrzało aktualne gazetki, albo dodaj zrzut ekranu kuponu." />}
      <div className="grid gap-2">
        {shown.map((p) => {
          const pct = p.regular_price && p.regular_price > p.price ? Math.round((1 - p.price / p.regular_price) * 100) : null;
          return (
            <div key={p.id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <StoreBadge store={p.store} />
                  {p.source === "kupon" && <span className="chip bg-amber-500/15 text-amber-600"><Ticket size={11} />kupon</span>}
                  {pct && <span className="chip bg-emerald-500/15 text-emerald-600">-{pct}%</span>}
                </div>
                <p className="font-semibold leading-snug">{p.product_name}{p.brand && <span className="muted font-normal"> · {p.brand}</span>}</p>
                <p className="muted text-xs mt-0.5">{p.unit && `${p.unit} · `}{fmt(p.valid_from)}–{fmt(p.valid_to)}{p.conditions && ` · ${p.conditions}`}</p>
              </div>
              <div className="text-right">
                <p className="font-extrabold text-lg">{zl(p.price)}</p>
                {p.regular_price && <p className="muted text-xs line-through">{zl(p.regular_price)}</p>}
                <div className="flex justify-end gap-1 mt-1">
                  {p.source_url && <a href={p.source_url} target="_blank" rel="noreferrer" className="muted p-1"><ExternalLink size={14} /></a>}
                  <button className="muted p-1" onClick={() => del(p.id)}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
