import { supabase } from "./supabase";

/** Zmniejsza zdjęcie (max 2000 px, JPEG) — szybciej i taniej dla AI. PDF wysyła bez zmian. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.88));
}

export async function uploadFile(file: File, folder: "receipts" | "coupons"): Promise<string> {
  const blob = await shrink(file);
  const isPdf = file.type === "application/pdf";
  const path = `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${isPdf ? "pdf" : "jpg"}`;
  const { error } = await supabase.storage.from("pojdziesz").upload(path, blob, {
    contentType: isPdf ? "application/pdf" : "image/jpeg",
  });
  if (error) throw error;
  return path;
}
