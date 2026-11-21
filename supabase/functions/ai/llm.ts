// Warstwa AI: domyślnie Meta Muse (Meta Model API, format Responses API).
// Opcjonalnie Claude (LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY).
//
// Sekrety w Supabase → Edge Functions → Secrets:
//   META_API_KEY   – klucz z panelu Meta Model API / Muse Code (wymagany)
//   META_MODEL     – opcjonalnie, domyślnie "muse-spark-1.3"
//   META_BASE_URL  – opcjonalnie, domyślnie "https://api.meta.ai/v1"

export type Part = { type: "text"; text: string } | { type: "file"; data: string; mediaType: string };
type Content = Part[] | string;

const PROVIDER = (Deno.env.get("LLM_PROVIDER") ?? "meta").toLowerCase();
const META_BASE = (Deno.env.get("META_BASE_URL") ?? "https://api.meta.ai/v1").replace(/\/$/, "");
const META_MODEL = Deno.env.get("META_MODEL") ?? "muse-spark-1.3";

export function configError(): string | null {
  if (PROVIDER === "anthropic") return Deno.env.get("ANTHROPIC_API_KEY") ? null : "Brak sekretu ANTHROPIC_API_KEY w Supabase.";
  return Deno.env.get("META_API_KEY") ? null : "Brak sekretu META_API_KEY w Supabase (klucz z Meta Muse).";
}

export function imageBlock(base64: string, mediaType: string): Part {
  return { type: "file", data: base64, mediaType };
}

// ---------- Meta Model API (Responses API) ----------
function metaInput(content: Content) {
  const parts = typeof content === "string" ? [{ type: "text", text: content } as Part] : content;
  return [
    {
      role: "user",
      content: parts.map((p) => {
        if (p.type === "text") return { type: "input_text", text: p.text };
        const url = `data:${p.mediaType};base64,${p.data}`;
        if (p.mediaType === "application/pdf") return { type: "input_file", filename: "paragon.pdf", file_data: url };
        return { type: "input_image", image_url: url };
      }),
    },
  ];
}

// deno-lint-ignore no-explicit-any
function metaText(res: any): string {
  if (typeof res.output_text === "string" && res.output_text) return res.output_text;
  const out: string[] = [];
  for (const item of res.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if ((c.type === "output_text" || c.type === "text") && c.text) out.push(c.text);
        if (c.type === "refusal") throw new Error("Model odmówił odpowiedzi: " + (c.refusal ?? ""));
      }
    }
  }
  // awaryjnie: format Chat Completions
  if (!out.length && res.choices?.[0]?.message?.content) out.push(res.choices[0].message.content);
  return out.join("\n");
}

async function metaCall(body: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${META_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("META_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: META_MODEL, ...body }),
    });
    if (r.ok) {
      const res = await r.json();
      if (res.status === "incomplete") throw new Error("Odpowiedź modelu niepełna: " + JSON.stringify(res.incomplete_details ?? {}));
      return res;
    }
    const txt = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 3000 * (attempt + 1)));
      continue;
    }
    const err = new Error(`Meta API ${r.status}: ${txt.slice(0, 500)}`) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  throw new Error("Meta API: brak odpowiedzi");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[{[]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("Model nie zwrócił JSON-a.");
  return JSON.parse(raw.slice(start, end + 1));
}

async function metaStructured<T>(o: { system: string; content: Content; schema: Record<string, unknown> }): Promise<T> {
  try {
    const res = await metaCall({
      instructions: o.system,
      input: metaInput(o.content),
      text: { format: { type: "json_schema", name: "wynik", schema: o.schema, strict: true } },
    });
    return JSON.parse(metaText(res)) as T;
  } catch (e) {
    // Jeśli API nie przyjmie schematu (400) albo zwróci nie-JSON — prosimy o JSON w treści.
    if ((e as { status?: number }).status && (e as { status?: number }).status !== 400) throw e;
    const res = await metaCall({
      instructions:
        o.system + "\n\nOdpowiedz WYŁĄCZNIE poprawnym JSON-em zgodnym z tym schematem JSON Schema (bez komentarzy):\n" + JSON.stringify(o.schema),
      input: metaInput(o.content),
    });
    return extractJson(metaText(res)) as T;
  }
}

async function metaResearch(o: { system: string; prompt: string }): Promise<string> {
  const res = await metaCall({
    instructions: o.system,
    input: metaInput(o.prompt),
    tools: [{ type: "web_search" }],
  });
  return metaText(res);
}

// ---------- Claude (opcjonalnie) ----------
async function anthropic() {
  const { default: Anthropic } = await import("npm:@anthropic-ai/sdk@1.12.0");
  return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
}
function claudeContent(content: Content) {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : p.mediaType === "application/pdf"
        ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.data } }
        : { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: p.data } },
  );
}
// deno-lint-ignore no-explicit-any
function claudeText(msg: any): string {
  if (msg.stop_reason === "refusal") throw new Error("Model odmówił odpowiedzi.");
  // deno-lint-ignore no-explicit-any
  return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

// ---------- API używane przez index.ts ----------
export async function structured<T>(o: {
  system: string;
  content: Content;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  if (PROVIDER !== "anthropic") return metaStructured<T>(o);
  const c = await anthropic();
  const msg = await c.beta.messages
    .stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: o.system,
      output_config: { effort: o.effort ?? "low", format: { type: "json_schema", schema: o.schema } },
      // deno-lint-ignore no-explicit-any
      messages: [{ role: "user", content: claudeContent(o.content) as any }],
    })
    .finalMessage();
  return JSON.parse(claudeText(msg)) as T;
}

export async function research(o: { system: string; prompt: string }): Promise<string> {
  if (PROVIDER !== "anthropic") return metaResearch(o);
  const c = await anthropic();
  const msg = await c.beta.messages
    .stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: o.system,
      output_config: { effort: "medium" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "PL", timezone: "Europe/Warsaw" } },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      ],
      messages: [{ role: "user", content: o.prompt }],
    })
    .finalMessage();
  return claudeText(msg);
}
