import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.119.2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { configError, imageBlock, research, structured } from "./llm.ts";

const STORES = ["lidl", "biedronka", "aldi"] as const;
type Store = (typeof STORES)[number];
const STORE_NAMES: Record<Store, string> = { lidl: "Lidl", biedronka: "Biedronka", aldi: "Aldi" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
}
function weekday(): string {
  return new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "long" }).format(new Date());
}

// ---------- schematy JSON ----------
const nNum = { type: ["number", "null"] };
const nStr = { type: ["string", "null"] };
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const storeEnum = { type: "string", enum: [...STORES] };

const promoSchema = obj({
  promotions: {
    type: "array",
    items: obj({
      store: storeEnum,
      product_name: { type: "string" },
      brand: nStr,
      price: { type: "number" },
      regular_price: nNum,
      unit: nStr,
      conditions: nStr,
      valid_from: { ...nStr, description: "YYYY-MM-DD" },
      valid_to: { ...nStr, description: "YYYY-MM-DD" },
      source_url: nStr,
    }),
  },
});

type Promo = {
  store: Store;
  product_name: string;
  brand: string | null;
  price: number;
  regular_price: number | null;
  unit: string | null;
  conditions: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string | null;
};

async function setProgress(jobId: string, progress: string) {
  await admin.from("jobs").update({ progress, updated_at: new Date().toISOString() }).eq("id", jobId);
}

async function insertPromos(promos: Promo[], source: "gazetka" | "kupon", userId: string, imagePath?: string) {
  if (!promos.length) return 0;
  const t = today();
  const { data: existing } = await admin
    .from("promotions")
    .select("store, product_name, price, valid_to")
    .or(`valid_to.gte.${t},valid_to.is.null`);
  const key = (p: { store: string; product_name: string; price: number; valid_to: string | null }) =>
    `${p.store}|${p.product_name.toLowerCase().trim()}|${Number(p.price).toFixed(2)}|${p.valid_to ?? ""}`;
  const seen = new Set((existing ?? []).map(key));
  const rows = promos
    .filter((p) => p.price > 0 && STORES.includes(p.store))
    .filter((p) => {
      const k = key(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p) => ({ ...p, source, created_by: userId, image_path: imagePath ?? null }));
  if (!rows.length) return 0;
  const { error } = await admin.from("promotions").insert(rows);
  if (error) throw error;
  return rows.length;
}

// ---------- 1. Gazetki ----------
async function refreshStore(store: Store, items: string[]): Promise<Promo[]> {
  const t = today();
  const report = await research({
    system:
      "Jesteś asystentem zakupowym polskiego gospodarstwa domowego. Wyszukujesz aktualne promocje z gazetek sieci handlowych w Polsce. " +
      "Korzystaj z oficjalnych stron sklepów i serwisów z gazetkami (np. gazetki na stronie sieci, blix, ding, mojegazetki). " +
      "Podawaj tylko oferty, które znalazłeś w źródłach — nigdy nie zgaduj cen.",
    prompt:
      `Dziś jest ${weekday()}, ${t}. Znajdź oferty z aktualnej gazetki (oraz z następnej, jeśli już opublikowana) sieci ${STORE_NAMES[store]} w Polsce.\n\n` +
      (items.length
        ? `Priorytet — sprawdź, czy w promocji są te produkty (lub ich bliskie odpowiedniki):\n${items.map((i) => `- ${i}`).join("\n")}\n\n`
        : "") +
      `Oprócz tego wypisz do 30 najciekawszych promocji spożywczych i chemii domowej.\n` +
      `Dla każdej oferty podaj: nazwę produktu, markę, cenę promocyjną, cenę regularną (jeśli podana), jednostkę/gramaturę, ` +
      `warunki (np. "przy zakupie 2 szt.", "z aplikacją Lidl Plus", "z Moją Biedronką"), okres ważności (daty) i URL źródła.`,
  });
  const parsed = await structured<{ promotions: Promo[] }>({
    system:
      `Zamień raport o promocjach na listę JSON. Sklep: ${store}. Rok bieżący: ${t.slice(0, 4)}. ` +
      "Daty w formacie YYYY-MM-DD. Cena = cena promocyjna za podaną jednostkę (jeśli promocja wymaga zakupu wielu sztuk, podaj cenę za sztukę w promocji i opisz warunek). " +
      "Pomiń oferty bez konkretnej ceny.",
    content: report,
    schema: promoSchema,
  });
  return parsed.promotions.map((p) => ({ ...p, store }));
}

async function refreshPromotions(jobId: string, userId: string, stores: Store[], items: string[]) {
  let done = 0;
  const results = await Promise.allSettled(
    stores.map(async (s) => {
      const promos = await refreshStore(s, items);
      const n = await insertPromos(promos, "gazetka", userId);
      done++;
      await setProgress(jobId, `Sprawdzono gazetki: ${done}/${stores.length}`);
      return { store: s, found: promos.length, added: n };
    }),
  );
  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { store: stores[i], error: String((r.reason as Error)?.message ?? r.reason) },
  );
}

// ---------- 2. Optymalizacja listy ----------
type Assignment = {
  item_id: string;
  store: Store;
  promo_id: string | null;
  price: number | null;
  regular_price: number | null;
  label: string;
  note: string | null;
  alternatives: { store: Store; price: number; label: string }[];
};

async function optimizeList(jobId: string, userId: string, listId: string, refresh: boolean) {
  const { data: items, error } = await admin.from("list_items").select("*").eq("list_id", listId).order("position");
  if (error) throw error;
  if (!items?.length) throw new Error("Lista jest pusta.");

  let refreshResult: unknown = null;
  if (refresh) {
    await setProgress(jobId, "Przeglądam gazetki Lidla, Biedronki i Aldi…");
    refreshResult = await refreshPromotions(jobId, userId, [...STORES], items.map((i) => `${i.name}${i.note ? ` (${i.note})` : ""}`));
  }

  await setProgress(jobId, "Dobieram najlepsze oferty…");
  const t = today();
  const { data: promos } = await admin
    .from("promotions")
    .select("id, store, product_name, brand, price, regular_price, unit, conditions, valid_from, valid_to, source")
    .or(`valid_to.gte.${t},valid_to.is.null`)
    .order("created_at", { ascending: false })
    .limit(600);

  const promoLines = (promos ?? [])
    .map(
      (p) =>
        `${p.id} | ${p.store} | ${p.product_name}${p.brand ? ` (${p.brand})` : ""} | ${p.price} zł${p.unit ? `/${p.unit}` : ""}` +
        `${p.regular_price ? ` (reg. ${p.regular_price})` : ""} | ${p.conditions ?? "-"} | ${p.valid_from ?? "?"}→${p.valid_to ?? "?"} | ${p.source}`,
    )
    .join("\n");
  const itemLines = items
    .map((i) => `${i.id} | ${i.name} | ${i.quantity} ${i.unit ?? ""}${i.note ? ` | uwaga: ${i.note}` : ""}`)
    .join("\n");

  const schema = obj({
    assignments: {
      type: "array",
      items: obj({
        item_id: { type: "string" },
        store: storeEnum,
        promo_id: nStr,
        price: { ...nNum, description: "cena za jednostkę w wybranym sklepie, null jeśli nieznana" },
        regular_price: nNum,
        label: { type: "string", description: "krótki opis oferty, np. 'Mleko Łaciate 3,2% 1l – 2,99 zł (-25%)' lub 'brak promocji'" },
        note: nStr,
        alternatives: {
          type: "array",
          items: obj({ store: storeEnum, price: { type: "number" }, label: { type: "string" } }),
        },
      }),
    },
    verdict: { type: "string", description: "1–3 zdania: czy warto iść do więcej niż jednego sklepu i ile to daje" },
  });

  const res = await structured<{ assignments: Assignment[]; verdict: string }>({
    system:
      "Jesteś asystentem zakupowym. Dopasowujesz produkty z listy zakupów do aktywnych promocji w sklepach Lidl, Biedronka i Aldi. Zasady:\n" +
      "1. Dla każdej pozycji wybierz najtańszą sensowną ofertę (ten sam typ produktu; uwzględnij uwagi użytkownika co do marki/gramatury).\n" +
      "2. Jeśli żaden sklep nie ma promocji na dany produkt — przypisz Lidl (sklep domyślny), promo_id = null, price = null, label = 'brak promocji – kup w Lidlu'.\n" +
      "3. Promocje ze źródła 'kupon' traktuj jako dostępne dla użytkownika.\n" +
      "4. Jeśli wyjście do dodatkowego sklepu daje łącznie mniej niż ok. 8 zł oszczędności, przenieś te pozycje do Lidla i zaznacz to w note.\n" +
      "5. promo_id musi być dokładnie identyfikatorem z listy promocji albo null. Warunki promocji (np. aplikacja, wielosztuki) opisz w note.\n" +
      "6. alternatives: do 2 innych ofert dla tej pozycji (mogą być puste).",
    content:
      `Dziś: ${t}.\n\nLISTA ZAKUPÓW (id | nazwa | ilość | uwagi):\n${itemLines}\n\n` +
      `AKTYWNE PROMOCJE (id | sklep | produkt | cena | warunki | ważność | źródło):\n${promoLines || "(brak danych)"}`,
    schema,
    effort: "medium",
  });

  const promoIds = new Set((promos ?? []).map((p) => p.id));
  const itemIds = new Set(items.map((i) => i.id));
  for (const a of res.assignments) {
    if (!itemIds.has(a.item_id)) continue;
    await admin
      .from("list_items")
      .update({
        assigned_store: a.store,
        promo_id: a.promo_id && promoIds.has(a.promo_id) ? a.promo_id : null,
        best_price: a.price,
        regular_price: a.regular_price,
        promo_label: a.label,
        ai_note: a.note,
        alternatives: a.alternatives,
      })
      .eq("id", a.item_id);
  }

  // podsumowanie liczone w kodzie
  const qty = new Map(items.map((i) => [i.id, Number(i.quantity) || 1]));
  const perStore: Record<string, { items: number; total: number; savings: number }> = {};
  for (const a of res.assignments.filter((a) => itemIds.has(a.item_id))) {
    const s = (perStore[a.store] ??= { items: 0, total: 0, savings: 0 });
    const q = qty.get(a.item_id) ?? 1;
    s.items++;
    if (a.price != null) s.total += a.price * q;
    if (a.price != null && a.regular_price != null && a.regular_price > a.price) s.savings += (a.regular_price - a.price) * q;
  }
  const summary = { per_store: perStore, verdict: res.verdict, refresh: refreshResult, at: new Date().toISOString() };
  await admin
    .from("shopping_lists")
    .update({ status: "optimized", optimized_at: new Date().toISOString(), summary })
    .eq("id", listId);
  return summary;
}

// ---------- 3. Pliki z Storage ----------
async function loadFile(path: string) {
  const { data, error } = await admin.storage.from("pojdziesz").download(path);
  if (error || !data) throw new Error("Nie mogę pobrać pliku: " + (error?.message ?? path));
  const buf = new Uint8Array(await data.arrayBuffer());
  const type = data.type || (path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  return imageBlock(encodeBase64(buf), type);
}

// ---------- 4. Kupon ----------
async function parseCoupon(userId: string, imagePath: string, storeHint?: Store) {
  const block = await loadFile(imagePath);
  const res = await structured<{ promotions: Promo[] }>({
    system:
      `Odczytujesz kupony i promocje ze zrzutów ekranu aplikacji sklepowych (Lidl Plus, Moja Biedronka, Aldi) lub zdjęć kuponów. Dziś: ${today()}. ` +
      "Daty YYYY-MM-DD. Jeśli kupon daje rabat procentowy bez ceny, oblicz cenę po rabacie tylko gdy cena regularna jest widoczna; w przeciwnym razie pomiń. " +
      (storeHint ? `Sklep wskazany przez użytkownika: ${storeHint}.` : "Rozpoznaj sklep po wyglądzie aplikacji/kuponu."),
    content: [block, { type: "text", text: "Wypisz wszystkie promocje/kupony widoczne na obrazie." }],
    schema: promoSchema,
  });
  const added = await insertPromos(res.promotions, "kupon", userId, imagePath);
  return { found: res.promotions.length, added, promotions: res.promotions };
}

// ---------- 5. Paragon ----------
async function parseReceipt(receiptId: string) {
  const { data: receipt, error } = await admin.from("receipts").select("*").eq("id", receiptId).single();
  if (error || !receipt) throw new Error("Brak paragonu");
  try {
    const block = await loadFile(receipt.image_path);
    const { data: names } = await admin.from("receipt_items").select("product_name").limit(2000);
    const known = [...new Set((names ?? []).map((n) => n.product_name))].slice(0, 500);

    const schema = obj({
      store: { type: ["string", "null"], enum: [...STORES, "inny", null] },
      purchase_date: { ...nStr, description: "YYYY-MM-DD" },
      total: { type: "number" },
      total_discount: { type: "number", description: "suma wszystkich rabatów/upustów na paragonie, 0 jeśli brak" },
      items: {
        type: "array",
        items: obj({
          raw_name: { type: "string" },
          product_name: { type: "string", description: "znormalizowana, czytelna nazwa produktu" },
          category: {
            type: "string",
            enum: ["nabiał", "pieczywo", "mięso i ryby", "owoce i warzywa", "napoje", "słodycze i przekąski", "suche i sypkie", "mrożonki", "chemia i higiena", "dziecko", "zwierzęta", "alkohol", "inne"],
          },
          quantity: { type: "number" },
          unit: nStr,
          unit_price: nNum,
          total_price: { type: "number", description: "kwota za pozycję PO rabacie" },
          discount: { type: "number", description: "rabat na tę pozycję (liczba dodatnia), 0 jeśli brak" },
        }),
      },
    });
    const res = await structured<{
      store: string | null;
      purchase_date: string | null;
      total: number;
      total_discount: number;
      items: {
        raw_name: string;
        product_name: string;
        category: string;
        quantity: number;
        unit: string | null;
        unit_price: number | null;
        total_price: number;
        discount: number;
      }[];
    }>({
      system:
        "Odczytujesz polskie paragony fiskalne (Lidl, Biedronka, Aldi). Skróty z paragonu zamieniasz na czytelne nazwy produktów " +
        "(np. 'MLEKO LAC 3,2%1L' → 'Mleko Łaciate 3,2% 1l'). Rabaty (linie 'Rabat', 'Upust', 'Lidl Plus', 'Moja Biedronka') przypisz do pozycji, których dotyczą. " +
        "unit_price = cena za sztukę/kg PO rabacie. Jeśli produkt pasuje do znanej nazwy, użyj jej dokładnie.\n" +
        (known.length ? `Znane nazwy produktów:\n${known.join("\n")}` : ""),
      content: [block, { type: "text", text: "Odczytaj ten paragon." }],
      schema,
      effort: "medium",
    });

    const store = res.store && (STORES as readonly string[]).includes(res.store) ? res.store : null;
    await admin.from("receipt_items").delete().eq("receipt_id", receiptId);
    if (res.items.length) {
      const { error: e2 } = await admin.from("receipt_items").insert(res.items.map((i) => ({ ...i, receipt_id: receiptId })));
      if (e2) throw e2;
    }
    await admin
      .from("receipts")
      .update({
        store,
        purchase_date: res.purchase_date ?? today(),
        total: res.total,
        total_discount: res.total_discount,
        status: "done",
        error: null,
      })
      .eq("id", receiptId);
    return { items: res.items.length, total: res.total, store };
  } catch (e) {
    await admin.from("receipts").update({ status: "error", error: String((e as Error).message ?? e) }).eq("id", receiptId);
    throw e;
  }
}

// ---------- router ----------
async function getMember(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: prof } = await admin.from("app_members").select("id").eq("id", data.user.id).maybeSingle();
  return prof ? data.user.id : null;
}

function runJob(kind: string, input: unknown, userId: string, work: (jobId: string) => Promise<unknown>) {
  return (async () => {
    const { data: job, error } = await admin
      .from("jobs")
      .insert({ kind, input, created_by: userId, progress: "Start…" })
      .select("id")
      .single();
    if (error) throw error;
    const p = work(job.id)
      .then((result) => admin.from("jobs").update({ status: "done", result, progress: "Gotowe", updated_at: new Date().toISOString() }).eq("id", job.id))
      .catch((e) =>
        admin.from("jobs").update({ status: "error", error: String(e?.message ?? e), updated_at: new Date().toISOString() }).eq("id", job.id),
      );
    EdgeRuntime.waitUntil(p);
    return json({ job_id: job.id });
  })();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cfg = configError();
    if (cfg) return json({ error: cfg }, 500);
    const userId = await getMember(req);
    if (!userId) return json({ error: "Brak dostępu" }, 401);
    const body = await req.json();

    switch (body.action) {
      case "refresh_promotions": {
        const stores = (body.stores?.length ? body.stores : STORES).filter((s: string) => STORES.includes(s as Store));
        return runJob("refresh_promotions", body, userId, (id) => refreshPromotions(id, userId, stores, body.items ?? []));
      }
      case "optimize_list":
        return runJob("optimize_list", body, userId, (id) => optimizeList(id, userId, body.list_id, body.refresh !== false));
      case "parse_coupon":
        return runJob("parse_coupon", body, userId, () => parseCoupon(userId, body.image_path, body.store));
      case "parse_receipt":
        return runJob("parse_receipt", body, userId, () => parseReceipt(body.receipt_id));
      default:
        return json({ error: "Nieznana akcja" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
