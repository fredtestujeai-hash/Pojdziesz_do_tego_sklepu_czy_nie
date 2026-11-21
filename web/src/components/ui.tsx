import { useEffect, useRef, useState } from "react";
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

const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Pole do przeciągania plików (i kliknięcia, aby wybrać). */
export function DropZone({ title, text, accept, onFiles, disabled, pdf = false }: {
  title: string; text: string; accept: string; onFiles: (files: File[]) => void; disabled?: boolean; pdf?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const ok = (f: File) => IMG_TYPES.includes(f.type) || (pdf && f.type === "application/pdf");
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter(ok);
    if (files.length) onFiles(files);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
      onDragEnter={(e) => { e.preventDefault(); depth.current++; setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false); if (!disabled) take(e.dataTransfer.files); }}
      className={`rounded-3xl border-2 border-dashed p-4 text-center cursor-pointer transition select-none ${
        over ? "border-brand bg-brand/10" : "border-black/10 dark:border-white/15 hover:border-brand/50"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
    >
      <p className="font-bold">{title}</p>
      <p className="muted text-xs mt-1">{text}</p>
      <input ref={input} type="file" accept={accept} multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

/** Ctrl+V ze zrzutem ekranu (poza polami tekstowymi). */
export function usePasteImages(onFiles: (files: File[]) => void, enabled: boolean) {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f && IMG_TYPES.includes(f.type));
      if (files.length) { e.preventDefault(); cb.current(files); }
    };
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, [enabled]);
}
