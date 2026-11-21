import { useState } from "react";
import { supabase } from "../lib/supabase";
import { ErrorBox, Spinner } from "../components/ui";

type Mode = "in" | "up" | "reset";

function plError(m: string): string {
  if (m.includes("dwóch") || m.includes("Database error")) return "Ta aplikacja jest tylko dla dwóch osób — oba konta już istnieją.";
  if (m === "Invalid login credentials") return "Nieprawidłowy e-mail lub hasło. Nie masz jeszcze konta? Wybierz „Załóż konto”. Nie pamiętasz hasła? Kliknij „Nie pamiętasz hasła?”.";
  if (/not confirmed/i.test(m)) return "Najpierw potwierdź adres e-mail — kliknij link w wiadomości od Supabase (sprawdź też spam).";
  if (/signups not allowed/i.test(m)) return "Rejestracja nowych kont jest wyłączona w ustawieniach Supabase (Authentication → Sign In / Providers → Allow new users to sign up).";
  if (/rate limit|too many/i.test(m)) return "Za dużo prób w krótkim czasie. Odczekaj kilka minut i spróbuj ponownie.";
  if (/at least 6/i.test(m)) return "Hasło musi mieć co najmniej 6 znaków.";
  return m;
}

export default function Login() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  function go(m: Mode) { setMode(m); setErr(""); setInfo(""); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setInfo("");
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo("Jeśli to konto istnieje, wysłaliśmy e-mail z linkiem do ustawienia nowego hasła. Otwórz go na tym urządzeniu.");
        return;
      }
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: window.location.origin } });
        if (error) {
          if (/already registered|already exists/i.test(error.message)) { go("in"); setErr("To konto już istnieje. Zaloguj się jego hasłem albo użyj „Nie pamiętasz hasła?”."); return; }
          throw error;
        }
        // Supabase dla istniejącego adresu zwraca użytkownika bez tożsamości (ochrona przed wykrywaniem kont)
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          go("in");
          setErr("Ten e-mail ma już konto (np. z innej aplikacji w tym projekcie). Zaloguj się tamtym hasłem albo kliknij „Nie pamiętasz hasła?”.");
          return;
        }
        if (!data.session) {
          go("in");
          setInfo("Konto założone. Wysłaliśmy e-mail z linkiem potwierdzającym — kliknij go (sprawdź też spam), a potem zaloguj się tutaj.");
          return;
        }
        return; // zalogowano od razu
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e: any) {
      setErr(plError(String(e?.message ?? e)));
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-dvh grid place-items-center px-5 bg-[radial-gradient(1200px_600px_at_10%_-10%,#7c3aed33,transparent),radial-gradient(900px_500px_at_110%_110%,#ec489933,transparent)]">
      <div className="w-full max-w-sm">
        <img src="/icon.svg" className="size-20 mx-auto rounded-[26px] shadow-xl shadow-brand/30" alt="" />
        <h1 className="mt-6 text-center text-3xl font-extrabold tracking-tight leading-tight">
          Pójdziesz do tego<br />
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">sklepu, czy nie?</span>
        </h1>
        <p className="muted text-center mt-2 text-sm">Lista zakupów, która sama wie, gdzie jest taniej.</p>

        <div className="card p-1 mt-8 grid grid-cols-2 text-sm font-semibold">
          {(["in", "up"] as const).map((m) => (
            <button key={m} type="button" onClick={() => go(m)} className={`py-2.5 rounded-[20px] transition ${mode === m ? "bg-gradient-to-r from-brand to-brand-2 text-white" : "muted"}`}>
              {m === "in" ? "Logowanie" : "Załóż konto"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="card p-5 mt-3 space-y-3">
          {mode === "reset" && <p className="text-sm">Podaj e-mail — wyślemy link do ustawienia nowego hasła.</p>}
          {mode === "up" && <input className="input" placeholder="Imię" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className="input" type="email" placeholder="E-mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {mode !== "reset" && (
            <input className="input" type="password" placeholder="Hasło (min. 6 znaków)" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          )}
          {err && <ErrorBox text={err} />}
          {info && <div className="rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm">{info}</div>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />}{mode === "in" ? "Zaloguj się" : mode === "up" ? "Załóż konto" : "Wyślij link"}
          </button>
          <button type="button" className="w-full text-sm muted py-1" onClick={() => go(mode === "reset" ? "in" : "reset")}>
            {mode === "reset" ? "Wróć do logowania" : "Nie pamiętasz hasła?"}
          </button>
          <p className="muted text-xs text-center">Aplikacja dla dwóch osób. Konto z innej aplikacji w tym samym projekcie też działa.</p>
        </form>
      </div>
    </div>
  );
}
