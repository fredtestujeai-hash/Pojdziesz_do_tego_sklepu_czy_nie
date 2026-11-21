# Pójdziesz do tego sklepu, czy nie

Wspólna lista zakupów dla dwóch osób. AI (Meta Muse) przegląda aktualne gazetki Lidla, Biedronki i Aldi,
dobiera najtańszy sklep dla każdej pozycji (domyślnie Lidl), czyta kupony ze zrzutów ekranu
i paragony (zdjęcie/PDF) do statystyk: wydatki, oszczędności, przepłaty, historia cen.

## Architektura
- `web/` — React + Vite + Tailwind (PWA, instalowalna na Androidzie). Hosting: Cloudflare Pages.
- `supabase/migrations/0001_init.sql` — tabele, RLS (dostęp tylko dla 2 członków z `app_members`), widoki statystyk, bucket `pojdziesz`.
- `supabase/functions/ai/` — Edge Function: `refresh_promotions`, `optimize_list`, `parse_coupon`, `parse_receipt`.
  AI: Meta Muse przez Meta Model API (`https://api.meta.ai/v1/responses`, wyszukiwanie w sieci dla gazetek, rozpoznawanie obrazu dla kuponów/paragonów, JSON schema).
  Opcjonalnie Claude: sekret `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`.
  Zadania działają w tle (`jobs`), frontend odpytuje status.

## Konfiguracja
1. Supabase → Edge Functions → Secrets: `META_API_KEY` = klucz z panelu Meta (Muse Code / Model API).
   Opcjonalnie `META_MODEL` (domyślnie `muse-spark-1.3`).
2. Supabase → Authentication → URL Configuration: dodaj adres strony (np. `https://pojdziesz.pages.dev`) do *Redirect URLs*.
3. Frontend: `web/.env` (patrz `.env.example`), potem `npm install && npm run build`, wgraj `web/dist` do Cloudflare Pages
   (lub podłącz repo GitHub: root `web`, build `npm run build`, output `dist`, zmienne `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Koszty AI
Zależą od tego, czy klucz Meta jest objęty subskrypcją Muse Code, czy rozliczany za użycie (sprawdź w panelu Meta).
Przycisk „Szybko” używa tylko zapisanych promocji (bez wyszukiwania w sieci).

## Wdrażanie
- Frontend: Cloudflare Pages połączone z tym repo (gałąź `main`), root `web`, build `npm run build`, output `dist`.
  Konfiguracja Supabase jest w `web/.env.production` (to klucz publiczny — bezpieczny do commitowania; dostęp chroni RLS).
- Funkcja AI: `supabase/functions/ai` — wdrażana do Supabase (projekt `ltkqbazrjxivvyeghnkh`).
- `artifact/pojdziesz.html` — wersja jako artefakt Claude (alternatywa bez Supabase).
