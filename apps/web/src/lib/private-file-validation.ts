export const PRIVATE_FILE_MAX = 3_000_000;
export function validatePrivateFile(
  name: string,
  content: Uint8Array,
): { name: string; mime: string; extension: string } {
  if (!content.length || content.length > PRIVATE_FILE_MAX)
    throw Error("Choose a nonempty file under 3 MB.");
  const clean = Array.from(name, (c) =>
    c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\" ? "_" : c,
  )
    .join("")
    .slice(0, 120);
  const ext = clean.split(".").pop()?.toLowerCase();
  const starts = (values: number[]) => values.every((v, i) => content[i] === v);
  if (ext === "png" && starts([137, 80, 78, 71, 13, 10, 26, 10]))
    return { name: clean, mime: "image/png", extension: "png" };
  if (["jpg", "jpeg"].includes(ext ?? "") && starts([255, 216, 255]))
    return { name: clean, mime: "image/jpeg", extension: "jpg" };
  if (
    ext === "webp" &&
    starts([82, 73, 70, 70]) &&
    String.fromCharCode(...content.slice(8, 12)) === "WEBP"
  )
    return { name: clean, mime: "image/webp", extension: "webp" };
  if (ext === "pdf" && starts([37, 80, 68, 70, 45]))
    return { name: clean, mime: "application/pdf", extension: "pdf" };
  const types: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
  };
  if (ext && types[ext]) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw Error("Text files must use UTF-8.");
    }
    if (text.includes("\0")) throw Error("Text files cannot contain binary data.");
    if (ext === "json")
      try {
        JSON.parse(text);
      } catch {
        throw Error("Choose a valid JSON file.");
      }
    return { name: clean, mime: types[ext], extension: ext };
  }
  throw Error(
    "Use PNG, JPEG, WebP, PDF, TXT, MD, CSV or JSON. The contents must match the file type.",
  );
}
