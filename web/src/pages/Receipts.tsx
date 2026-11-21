import { useEffect, useState } from "react";
import { ChevronDown, FileText, Receipt as ReceiptIcon, RotateCw, Trash2 } from "lucide-react";
import { supabase, zl, type Store } from "../lib/supabase";
import { runAi } from "../lib/api";
import { uploadFile } from "../lib/upload";
import { DropZone, Empty, ErrorBox, PageHeader, Progress, Spinner, StoreBadge, usePasteImages } from "../components/ui";

type R = { id: string; store: Store | null; purchase_date: string | null; total: number | null; total_discount: number | null; status: string; error: string | null; created_at: string; image_path: string };
type RI = { id: string; raw_name: string; product_name: string; category: string; quantity: number; unit_price: number | null; total_price: number; discount: number; overpaid?: number; best_known_price?: number };

export default function Receipts() {
  const [rows, setRows] = useState<R[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, RI[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    const { data } = await supabase.from("receipts").select("*").order("purchase_date", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }).limit(100);
    setRows((data as R[]) ?? []);
  }
  useEffect(() => {
    load();
    const ch = supabase.channel("receipts").on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function process(receiptId: string) {
    await supabase.from("receipts").update({ status: "processing", error: null }).eq("id", receiptId);
    await runAi({ action: "parse_receipt", receipt_id: receiptId });
  }

  async function onFiles(files: File[]) {
    if (!files.length || busy) return;
    setErr("");
    try {
      for (const [i, f] of [...files].entries()) {
        setBusy(`Wysyłam i czytam paragon ${i + 1}/${files.length}…`);
        const path = await uploadFile(f, "receipts");
        const { data, error } = await supabase.from("receipts").insert({ image_path: path }).select().single();
        if (error) throw error;
        load();
        await process(data.id);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); load(); }
  }

  usePasteImages(onFiles, !busy);

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    const { data } = await supabase.from("v_receipt_item_stats").select("*").eq("receipt_id", id);
    setItems((x) => ({ ...x, [id]: (data as RI[]) ?? [] }));
  }

  async function del(r: R) {
    if (!confirm("Usunąć paragon?")) return;
    await supabase.storage.from("pojdziesz").remove([r.image_path]);
    await supabase.from("receipts").delete().eq("id", r.id);
    load();
  }

  async function viewImage(path: string) {
    const { data } = await supabase.storage.from("pojdziesz").createSignedUrl(path, 300);
    if (data) window.open(data.signedUrl, "_blank");
  }

  return (
    <>
      <PageHeader title="Paragony" subtitle="Zdjęcie lub PDF — AI odczyta pozycje i ceny" />
      <div className="mb-4">
        <DropZone title="Dodaj paragon" text="Przeciągnij tu zdjęcia lub PDF-y paragonów, wklej Ctrl+V albo kliknij, aby wybrać (na telefonie: aparat lub galeria)" accept="image/*,application/pdf" pdf disabled={!!busy} onFiles={onFiles} />
      </div>
      {busy && <div className="mb-4"><Progress text={busy} /></div>}
      {err && <div className="mb-4"><ErrorBox text={err} /></div>}
      {rows.length === 0 && !busy && <Empty icon={<ReceiptIcon />} title="Brak paragonów" text="Dodaj zdjęcie paragonu, żeby śledzić wydatki i ceny." />}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="card overflow-hidden">
            <button className="w-full p-4 flex items-center gap-3 text-left" onClick={() => r.status === "done" && toggle(r.id)}>
              <div className="size-11 rounded-2xl grid place-items-center bg-black/[.04] dark:bg-white/[.06]">
                {r.status === "processing" ? <Spinner className="text-brand" /> : <FileText size={20} className="muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {r.store ? <StoreBadge store={r.store} /> : <span className="chip bg-black/5 dark:bg-white/10">{r.status === "processing" ? "czytam…" : "inny sklep"}</span>}
                  <span className="muted text-xs">{r.purchase_date ? new Date(r.purchase_date).toLocaleDateString("pl-PL", { dateStyle: "medium" }) : ""}</span>
                </div>
                {r.status === "error" && <p className="text-xs text-red-500 mt-1 truncate">{r.error}</p>}
                {!!r.total_discount && <p className="text-xs text-emerald-600 mt-1">rabaty: {zl(r.total_discount)}</p>}
              </div>
              <p className="font-extrabold">{r.total != null ? zl(r.total) : ""}</p>
              {r.status === "done" && <ChevronDown size={16} className={`muted transition ${open === r.id ? "rotate-180" : ""}`} />}
            </button>
            {open === r.id && (
              <div className="px-4 pb-4 border-t border-black/5 dark:border-white/5">
                <div className="divide-y divide-black/5 dark:divide-white/5">
                  {(items[r.id] ?? []).map((i) => (
                    <div key={i.id} className="py-2 flex justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{i.product_name}</p>
                        <p className="muted text-xs truncate">{i.quantity} × {zl(i.unit_price)} · {i.category}{i.discount > 0 && <span className="text-emerald-600"> · rabat {zl(i.discount)}</span>}</p>
                        {!!i.overpaid && i.overpaid > 0.01 && <p className="text-xs text-orange-500">przepłata {zl(i.overpaid)} (najtaniej {zl(i.best_known_price)})</p>}
                      </div>
                      <p className="font-semibold shrink-0">{zl(i.total_price)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-3">
                  <button className="btn-ghost flex-1 text-sm !py-2" onClick={() => viewImage(r.image_path)}>Zdjęcie</button>
                  <button className="btn-ghost flex-1 text-sm !py-2" onClick={() => process(r.id).then(load)}><RotateCw size={14} />Odczytaj ponownie</button>
                  <button className="btn-ghost text-sm !py-2" onClick={() => del(r)}><Trash2 size={14} /></button>
                </div>
              </div>
            )}
            {r.status === "error" && (
              <div className="px-4 pb-3 flex gap-2">
                <button className="btn-ghost flex-1 text-sm !py-2" onClick={() => process(r.id).then(load).catch((e) => setErr(e.message))}><RotateCw size={14} />Spróbuj ponownie</button>
                <button className="btn-ghost text-sm !py-2" onClick={() => del(r)}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
