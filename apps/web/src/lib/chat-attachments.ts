export type ChatAttachment =
  { kind: "text"; name: string; text: string } | { kind: "image"; name: string; dataUrl: string };

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  const name = file.name.slice(0, 120);
  if (/\.(txt|md|csv|json)$/i.test(name)) {
    if (file.size > 20_000) throw new Error(`${name}: text files must be under 20 KB.`);
    const text = await file.text();
    if (!text.trim() || text.includes("\0"))
      throw new Error(`${name}: use a nonempty UTF-8 text file.`);
    return { kind: "text", name, text };
  }
  if (!/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) || file.size > 5_000_000) {
    throw new Error("Use PNG, JPEG or WebP under 5 MB, or TXT, MD, CSV or JSON under 20 KB.");
  }
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 30_000_000)
      throw new Error("Choose a smaller image (under 30 megapixels).");
    const scale = Math.min(1, 768 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser couldn’t prepare the image.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/webp", 0.75);
    if (dataUrl.length > 220_000) throw new Error("Choose a smaller or simpler image.");
    return { kind: "image", name, dataUrl };
  } finally {
    image.close();
  }
}
