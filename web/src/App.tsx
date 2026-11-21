import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { BarChart3, ListChecks, Receipt, Tags } from "lucide-react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Lists from "./pages/Lists";
import ListDetail from "./pages/ListDetail";
import Promotions from "./pages/Promotions";
import Receipts from "./pages/Receipts";
import { Spinner } from "./components/ui";

const Stats = lazy(() => import("./pages/Stats"));

const tabs = [
  { to: "/", label: "Listy", icon: ListChecks },
  { to: "/promocje", label: "Promocje", icon: Tags },
  { to: "/paragony", label: "Paragony", icon: Receipt },
  { to: "/statystyki", label: "Statystyki", icon: BarChart3 },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [member, setMember] = useState<"checking" | "ok" | string>("checking");

  useEffect(() => {
    if (!session) return;
    setMember("checking");
    supabase.rpc("join_app").then(({ error }) => setMember(error ? (error.message.includes("dwóch") ? "Ta aplikacja jest tylko dla dwóch osób — oba miejsca są już zajęte." : error.message) : "ok"));
  }, [session?.user.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return <div className="min-h-dvh grid place-items-center"><Spinner className="text-brand" /></div>;
  if (!session) return <Login />;
  if (member === "checking")
    return <div className="min-h-dvh grid place-items-center"><Spinner className="text-brand" /></div>;
  if (member !== "ok")
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-center">
        <div className="card p-6 max-w-sm">
          <p className="font-bold mb-2">Brak dostępu</p>
          <p className="muted text-sm mb-4">{member}</p>
          <button className="btn-ghost w-full" onClick={() => supabase.auth.signOut()}>Wyloguj</button>
        </div>
      </div>
    );

  return (
    <div className="min-h-dvh pb-28">
      <main className="mx-auto max-w-2xl px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <Routes>
          <Route path="/" element={<Lists />} />
          <Route path="/lista/:id" element={<ListDetail />} />
          <Route path="/promocje" element={<Promotions />} />
          <Route path="/paragony" element={<Receipts />} />
          <Route path="/statystyki" element={<Suspense fallback={<Spinner className="text-brand" />}><Stats /></Suspense>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-20 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 px-4">
        <div className="mx-auto max-w-md card !rounded-[28px] backdrop-blur-xl bg-white/85 dark:bg-[#151726]/85 grid grid-cols-4 p-1.5">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 rounded-[22px] text-[11px] font-semibold transition ${
                  isActive ? "bg-gradient-to-r from-brand to-brand-2 text-white shadow-md shadow-brand/30" : "muted"
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
