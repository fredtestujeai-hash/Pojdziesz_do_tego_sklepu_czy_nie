import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Store = "lidl" | "biedronka" | "aldi";
export const STORES: Store[] = ["lidl", "biedronka", "aldi"];
export const STORE_META: Record<Store, { name: string; bg: string; text: string; ring: string; hex: string }> = {
  lidl: { name: "Lidl", bg: "bg-lidl", text: "text-lidl-accent", ring: "ring-lidl", hex: "#0050AA" },
  biedronka: { name: "Biedronka", bg: "bg-biedronka", text: "text-white", ring: "ring-biedronka", hex: "#E30613" },
  aldi: { name: "Aldi", bg: "bg-aldi", text: "text-aldi-accent", ring: "ring-aldi", hex: "#F58220" },
};

export type ListItem = {
  id: string; list_id: string; name: string; quantity: number; unit: string | null; note: string | null;
  checked: boolean; position: number; assigned_store: Store | null; best_price: number | null;
  regular_price: number | null; promo_id: string | null; promo_label: string | null; ai_note: string | null;
  alternatives: { store: Store; price: number; label: string }[] | null;
};
export type ShoppingList = {
  id: string; name: string; status: "draft" | "optimized" | "done"; created_at: string; optimized_at: string | null;
  summary: { per_store: Record<string, { items: number; total: number; savings: number }>; verdict: string } | null;
};
export type Promotion = {
  id: string; store: Store; product_name: string; brand: string | null; price: number; regular_price: number | null;
  unit: string | null; conditions: string | null; valid_from: string | null; valid_to: string | null;
  source: "gazetka" | "kupon" | "reczna"; source_url: string | null; created_at: string;
};

export const zl = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(n));
export const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
