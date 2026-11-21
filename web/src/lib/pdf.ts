// Obsługa PDF-ów z gazetkami — w całości w przeglądarce (pdf.js ładowany dopiero przy pierwszym PDF-ie).
// Najpierw próbujemy wyciągnąć tekst (najtaniej dla AI); gdy PDF to same obrazy — renderujemy strony do JPG.

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;

async function open(file: File): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

export type PdfText = { pages: string[]; numPages: number; hasText: boolean; doc: PdfDoc };

/** Tekst każdej strony, z zachowaniem podziału na linie (ceny zwykle są obok nazw). */
export async function readPdfText(file: File): Promise<PdfText> {
  const doc = await open(file);
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let out = "";
    let lastY: number | null = null;
    for (const it of tc.items) {
      if (!("str" in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) out += "\n";
      else if (out && !out.endsWith(" ")) out += " ";
      out += it.str;
      lastY = y;
    }
    pages.push(out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  }
  const chars = pages.reduce((a, p) => a + p.length, 0);
  // gazetka z warstwą tekstu ma zwykle setki znaków na stronę; skany — prawie zero
  return { pages, numPages: doc.numPages, hasText: chars >= Math.max(300, doc.numPages * 80), doc };
}

/** Dzieli strony na porcje tekstu do jednego wywołania AI (limit po stronie funkcji: 40 tys. znaków). */
export function chunkPages(pages: string[], maxChars = 30000): string[] {
  const chunks: string[] = [];
  let cur = "";
  pages.forEach((p, i) => {
    if (!p) return;
    const block = `--- strona ${i + 1} ---\n${p}\n`;
    if (cur && cur.length + block.length > maxChars) { chunks.push(cur); cur = ""; }
    cur += block.length > maxChars ? block.slice(0, maxChars) : block;
  });
  if (cur) chunks.push(cur);
  return chunks;
}

/** Renderuje strony PDF-a do JPG (dla skanów bez tekstu). */
export async function renderPdfPages(doc: PdfDoc, maxPages: number, maxSide = 1600): Promise<File[]> {
  const files: File[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, maxSide / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.85));
    files.push(new File([blob], `strona-${n}.jpg`, { type: "image/jpeg" }));
  }
  return files;
}
