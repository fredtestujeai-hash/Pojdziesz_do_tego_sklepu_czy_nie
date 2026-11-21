import { useState } from "react";
import { supabase } from "../lib/supabase";
import { ErrorBox, Spinner } from "../components/ui";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setInfo("");
    try {
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: window.location.origin } });
        if (error && !/already registered/i.test(error.message)) throw error;
        if (data?.user && !data.session && !error) {
          setInfo("Wysłaliśmy e-mail z linkiem potwierdzającym. Kliknij go, a potem wróć tu i zaloguj się.");
          setMode("in");
          return;
        }
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e: any) {
      const m = String(e.message ?? e);
      setErr(m.includes("dwóch") || m.includes("Database error") ? "Ta aplikacja jest tylko dla dwóch osób — oba konta już istnieją." : m === "Invalid login credentials" ? "Nieprawidłowy e-mail lub hasło." : /not confirmed/i.test(m) ? "Najpierw potwierdź adres e-mail (link w skrzynce)." : m);
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
        <form onSubmit={submit} className="card p-5 mt-8 space-y-3">
          {mode === "up" && <input className="input" placeholder="Imię" value={name} onChange={(e) => setName(e.target.value)} />}
          <input className="input" type="email" placeholder="E-mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Hasło (min. 6 znaków)" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          {err && <ErrorBox text={err} />}
          {info && <div className="rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3 text-sm">{info}</div>}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{mode === "in" ? "Zaloguj się" : "Załóż konto"}</button>
          <button type="button" className="w-full text-sm muted py-1" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Pierwszy raz? Załóż konto (max 2 osoby). Masz już konto w innej naszej aplikacji? Po prostu się zaloguj." : "Mam już konto — zaloguj"}
          </button>
        </form>
      </div>
    </div>
  );
}
