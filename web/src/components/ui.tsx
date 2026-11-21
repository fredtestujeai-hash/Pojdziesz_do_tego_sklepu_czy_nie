import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { STORE_META, type Store } from "../lib/supabase";

export function StoreBadge({ store, size = "sm" }: { store: Store | null; size?: "sm" | "lg" }) {
  if (!store) return null;
  const m = STORE_META[store];
  return (
    <span className={`${m.bg} ${m.text} chip ${size === "lg" ? "text-sm px-3 py-1.5" : ""} font-extrabold tracking-wide`}>
      {m.name}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} />;
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-2 pb-5">
      <div>
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="muted text-sm mt-1">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="mx-auto mb-3 grid place-items-center size-14 rounded-2xl bg-gradient-to-br from-brand/15 to-brand-2/15 text-brand">{icon}</div>
      <p className="font-bold">{title}</p>
      <p className="muted text-sm mt-1">{text}</p>
    </div>
  );
}

export function Progress({ text }: { text: string }) {
  return (
    <div className="card p-4 flex items-center gap-3 border-brand/30">
      <div className="relative size-9 grid place-items-center">
        <span className="absolute inset-0 rounded-full bg-gradient-to-r from-brand to-brand-2 animate-ping opacity-30" />
        <Spinner className="text-brand" />
      </div>
      <div className="text-sm">
        <p className="font-semibold">AI pracuje…</p>
        <p className="muted">{text}</p>
      </div>
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 p-3 text-sm">{text}</div>;
}
