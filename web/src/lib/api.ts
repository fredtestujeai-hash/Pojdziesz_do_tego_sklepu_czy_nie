import { supabase } from "./supabase";

export type Job = { id: string; status: "running" | "done" | "error"; progress: string | null; result: any; error: string | null };

export async function startJob(body: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await (error as any).context?.json())?.error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.job_id as string;
}

/** Czeka na zakończenie zadania (polling co 2,5 s, limit 10 min). */
export async function waitJob(id: string, onProgress?: (p: string) => void): Promise<Job> {
  const start = Date.now();
  while (Date.now() - start < 10 * 60_000) {
    const { data } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (data) {
      if (data.progress) onProgress?.(data.progress);
      if (data.status === "done") return data as Job;
      if (data.status === "error") throw new Error(data.error ?? "Błąd zadania");
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("Przekroczono czas oczekiwania");
}

export async function runAi(body: Record<string, unknown>, onProgress?: (p: string) => void) {
  const id = await startJob(body);
  return waitJob(id, onProgress);
}
