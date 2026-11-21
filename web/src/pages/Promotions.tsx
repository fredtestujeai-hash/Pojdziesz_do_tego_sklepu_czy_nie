import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, ExternalLink, FileText, Search, Tags, Ticket, Trash2 } from "lucide-react";
import { STORE_META, STORES, supabase, todayStr, zl, type Promotion, type Store } from "../lib/supabase";
import { runAi } from "../lib/api";
import { uploadFile } from "../lib/upload";
import { readPdfText, renderPdfPages } from "../lib/pdf";
import { DropZone, Empty, ErrorBox, PageHeader, Progress, StoreBadge, usePasteImages } from "../components/ui";

const MAX_SCAN_PAGES = 16; // PDF bez tekstu (skan): ile stron maks. wysłać jako obrazy
const ACTIVE_DAYS = 9; // gazetka bierze udział w porównaniu przez tyle dni od wgrania

type Leaflet = { id: string; store: Store; name: string; pages: number; created_at: string };

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.replace(/\s+/g, " ").trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Rozpoznaje sklep po treści gazetki (za darmo, bez AI). */
function detectStore(text: string): Store | null {
  const t = text.toLowerCase();
  const n = { lidl: (t.match(/lidl/g) ?? []).length, biedronka: (t.match(/biedronk/g) ?? []).length, aldi: (t.match(/\baldi\b/g) ?? []).length };
  const best = (Object.entries(n) as [Store, number][]).sort((a, b) => b[1] - a[1]);
  return best[0][1] > 0 && best[0][1] >= 2 * best[1][1] ? best[0][0] : null;
}

const isActive = (l: Leaflet) => Date.now() - new Date(l.created_at).getTime() < ACTIVE_DAYS * 864e5;

export default function Promotions() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [leaflets, setLeaflets] = useState<Leaflet[]>([]);
  const [filter, setFilter] = useState<Store | "all" | "kupon">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [storeHint, setStoreHint] = useState<Store | "">("");
  const [confirmLeaf, setConfirmLeaf] = useState<string | null>(null);

  async function load() {
    const t = todayStr();
    const [{ data }, { data: lf }] = await Promise.all([
      supabase.from("promotions").select("*").or(`valid_to.gte.${t},valid_to.is.null`).order("store").order("price").limit(1000),
      supabase.from("leaflets").select("id, store, name, pages, created_at").order("created_at", { ascending: false }).limit(50),
    ]);
    setPromos((data as Promotion[]) ?? []);
    setLeaflets((lf as Leaflet[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  /** Zapisuje tekst gazetki w bazie — bez AI, za darmo. */
  async function saveLeaflet(name: string, pages: string[]): Promise<string> {
    const all = pages.join("\n");
    const store = storeHint || detectStore(all);
    if (!store) throw new Error(`Nie rozpoznałem sklepu w „${name}”. Wybierz sklep (Lidl / Biedronka / Aldi) nad polami i wgraj ponownie.`);
    const hash = await sha256(all);
    const { data: leaf, error } = await supabase.from("leaflets").insert({ store, name: name.slice(0, 200), pages: pages.length, hash }).select("id").single();
    if (error) {
      if (error.code === "23505") return `„${name}” była już wgrana — pominięto.`;
      throw error;
    }
    const rows = pages.map((text, i) => ({ leaflet_id: leaf.id, page: i + 1, text })).filter((r) => r.text.trim());
    for (let i = 0; i < rows.length; i += 50) {
      const { error: e2 } = await supabase.from("leaflet_pages").insert(rows.slice(i, i + 50));
      if (e2) { await supabase.from("leaflets").delete().eq("id", leaf.id); throw e2; }
    }
    return `„${name}” (${STORE_META[store].name}, ${pages.length} str.) zapisana.`;
  }

  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  async function savePasted() {
    if (pasteText.trim().length < 10 || busy) return;
    setErr(""); setMsg(""); setBusy("Zapisuję tekst gazetki…");
    try {
      const name = `Wklejony tekst ${new Date().toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}`;
      setMsg(await saveLeaflet(name, [pasteText.trim()]));
      setPasteText(""); setShowPaste(false);
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function onFiles(files: File[], kind: "kupon" | "gazetka") {
    if (!files.length || busy) return;
    setErr(""); setMsg("");
    const notes: string[] = [];
    let total = 0;
    try {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      const images = files.filter((f) => f.type !== "application/pdf");

      // PDF z tekstem → zapis tekstu (bez AI). Skan bez tekstu → strony jako obrazy (AI).
      for (const [k, f] of pdfs.entries()) {
        setBusy(`${pdfs.length > 1 ? `PDF ${k + 1}/${pdfs.length} ` : ""}„${f.name}”: odczytuję tekst…`);
        let pdf;
        try { pdf = await readPdfText(f); }
        catch { notes.push(`„${f.name}”: nie udało się otworzyć pliku PDF.`); continue; }
        if (pdf.hasText) {
          try { notes.push(await saveLeaflet(f.name.replace(/\.pdf$/i, ""), pdf.pages)); }
          catch (e: any) { notes.push(e.message); }
        } else {
          const pages = await renderPdfPages(pdf.doc, MAX_SCAN_PAGES);
          notes.push(`„${f.name}” to skan bez tekstu — odczyt przez AI${pdf.numPages > MAX_SCAN_PAGES ? ` (pierwsze ${MAX_SCAN_PAGES} z ${pdf.numPages} stron)` : ""}.`);
          images.push(...pages);
        }
      }

      for (const [i, f] of images.entries()) {
        setBusy(`Muse czyta ${kind === "kupon" ? "kupon" : "stronę gazetki"} ${i + 1}/${images.length}…`);
        const path = await uploadFile(f, "coupons");
        const job = await runAi({ action: "parse_coupon", image_path: path, store: storeHint || undefined, kind });
        total += job.result.added;
      }
      if (images.length) notes.unshift(`${kind === "kupon" ? "Z kuponów" : "Ze zdjęć gazetki"} dodano ${total} promocji.`);
      setMsg(notes.join(" "));
      load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  usePasteImages((f) => onFiles(f, "kupon"), !busy);

  async function delPromo(id: string) {
    setPromos((p) => p.filter((x) => x.id !== id));
    await supabase.from("promotions").delete().eq("id", id);
  }
  async function delLeaflet(id: string) {
    setConfirmLeaf(null);
    setLeaflets((l) => l.filter((x) => x.id !== id));
    await supabase.from("leaflets").delete().eq("id", id);
  }

  const shown = useMemo(() => promos.filter((p) =>
    (filter === "all" || (filter === "kupon" ? p.source === "kupon" : p.store === filter)) &&
    (!q || `${p.product_name} ${p.brand ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [promos, filter, q]);

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) : "?";
  const activeLeaflets = leaflets.filter(isActive);

  return (
    <>
      <PageHeader title="Promocje" subtitle={`${activeLeaflets.length} gazetek · ${promos.length} promocji z kuponów i zdjęć`} />

      <div className="flex items-center gap-2 mb-3 text-xs flex-wrap">
        <span className="muted">Sklep:</span>
        {(["", ...STORES] as const).map((s) => (
          <button key={s} onClick={() => setStoreHint(s)} className={`chip ${storeHint === s ? "bg-brand text-white" : "bg-black/[.04] dark:bg-white/[.06]"}`}>{s ? STORE_META[s].name : "rozpoznaj sam"}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <DropZone title="Gazetka" text="Przeciągnij PDF-y gazetek (kilka naraz) albo kliknij. Zapis bez AI — za darmo." accept="application/pdf,image/*" pdf disabled={!!busy} onFiles={(f) => onFiles(f, "gazetka")} />
        <DropZone title="Kupon" text="Przeciągnij zrzuty kuponów (Lidl Plus, Moja Biedronka, Aldi) albo kliknij" accept="image/*,application/pdf" pdf disabled={!!busy} onFiles={(f) => onFiles(f, "kupon")} />
      </div>
      <p className="muted text-xs mb-2">
        Gazetki w PDF nic nie kosztują — Muse czyta z nich tylko fragmenty z produktami z Waszej listy, przy „Znajdź najlepsze oferty”.
        Zrzuty ekranu i skany czyta AI (kilka groszy za stronę). Ctrl+V wkleja zrzut jako kupon.
      </p>
      <div className="card p-3 mb-3">
        <button className="w-full flex items-center gap-2 font-semibold text-sm" onClick={() => setShowPaste(!showPaste)} aria-expanded={showPaste}>
          <ClipboardPaste size={16} />Wklej tekst gazetki
          <span className="muted font-normal ml-auto">{showPaste ? "zwiń" : "rozwiń"}</span>
        </button>
        {showPaste && (
          <div className="mt-3 space-y-2">
            <textarea id="pasteText" className="input min-h-32" placeholder="Skopiuj tekst ze strony z gazetką (np. lidl.pl, biedronka.pl, blix.pl) i wklej tutaj." value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
            <button className="btn-primary w-full" onClick={savePasted} disabled={!!busy || pasteText.trim().length < 10}>Zapisz jako gazetkę</button>
          </div>
        )}
      </div>

      {busy && <div className="mb-4"><Progress text={busy} /></div>}
      {err && <div className="mb-4"><ErrorBox text={err} /></div>}
      {msg && <div className="mb-4 rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm">{msg}</div>}

      <h2 className="font-bold mt-2 mb-2">Gazetki</h2>
      {leaflets.length === 0 ? (
        <p className="muted text-sm mb-5">Brak wgranych gazetek. Przeciągnij PDF-y do pola „Gazetka”.</p>
      ) : (
        <div className="grid gap-2 mb-5">
          {leaflets.map((l) => (
            <div key={l.id} className={`card p-3 flex items-center gap-3 ${isActive(l) ? "" : "opacity-50"}`}>
              <FileText size={18} className="muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5"><StoreBadge store={l.store} /><span className="muted text-xs">{l.pages} str. · {new Date(l.created_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}{isActive(l) ? "" : " · nieaktywna (starsza niż 9 dni)"}</span></div>
                <p className="font-semibold truncate mt-0.5">{l.name}</p>
              </div>
              {confirmLeaf === l.id ? (
                <div className="flex gap-1 shrink-0">
                  <button className="btn bg-red-600 text-white !px-3 !py-2 text-sm" onClick={() => delLeaflet(l.id)}>Usuń</button>
                  <button className="btn-ghost !px-3 !py-2 text-sm" onClick={() => setConfirmLeaf(null)}>Nie</button>
                </div>
              ) : (
                <button className="muted p-2 shrink-0" onClick={() => setConfirmLeaf(l.id)} aria-label={`Usuń gazetkę ${l.name}`}><Trash2 size={16} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="font-bold mb-2">Promocje z kuponów i zdjęć</h2>
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

      {shown.length === 0 && !busy && <Empty icon={<Tags />} title="Brak promocji z kuponów" text="Tu pojawią się promocje odczytane ze zrzutów kuponów i zdjęć gazetek." />}
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
                  <button className="muted p-1" onClick={() => delPromo(p.id)} aria-label="Usuń promocję"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
