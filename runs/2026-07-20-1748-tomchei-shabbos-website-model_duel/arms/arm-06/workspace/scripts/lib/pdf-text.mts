// pdf-lib Flate-compresses content streams and hex-encodes drawn text; this
// inflates every stream block and decodes <hex> operands so tests and smokes
// can grep what a rendered artifact actually contains.
import { inflateSync } from "node:zlib";

export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [raw];
  const streamStart = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamStart.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    const data = Buffer.from(raw.slice(start, end), "latin1");
    let content: string;
    try {
      content = inflateSync(data).toString("latin1");
    } catch {
      content = data.toString("latin1");
    }
    chunks.push(content);
    for (const hex of content.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      const clean = hex[1].replace(/\s+/g, "");
      if (clean.length > 0 && clean.length % 2 === 0) {
        chunks.push(Buffer.from(clean, "hex").toString("latin1"));
      }
    }
  }
  return chunks.join("\n");
}
