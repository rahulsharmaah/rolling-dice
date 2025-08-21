import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type KnowledgeDocInfo = {
  buffer: Buffer | null;
  sourcePath: string | null;
  ext: ".md" | ".pdf" | ".docx" | "";
};

async function readKnowledgeBuffer(): Promise<KnowledgeDocInfo> {
  try {
    const cwd = process.cwd();
    const dir = path.join(cwd, "knowledge");
    const fromEnv = process.env.KNOWLEDGE_PATH
      ? path.isAbsolute(process.env.KNOWLEDGE_PATH)
        ? process.env.KNOWLEDGE_PATH
        : path.join(cwd, process.env.KNOWLEDGE_PATH)
      : null;

    const candidates = [
      fromEnv,
      path.join(dir, "thoughts.md"),
      path.join(dir, "thoughts.pdf"),
      path.join(dir, "thoughts.docx"),
      path.join(cwd, "dice_thoughts.md"),
      path.join(cwd, "dice_thoughts.pdf"),
      path.join(cwd, "dice_thoughts.docx"),
    ].filter(Boolean) as string[];

    let filePath: string | null = null;
    for (const p of candidates) {
      try {
        await fs.access(p);
        filePath = p;
        break;
      } catch {}
    }
    if (!filePath) {
      const entriesK = await fs.readdir(dir).catch(() => [] as string[]);
      const matchK = entriesK.find((f) => /\.(md|pdf|docx)$/i.test(f));
      if (matchK) filePath = path.join(dir, matchK);
      if (!filePath) {
        const entriesRoot = await fs.readdir(cwd).catch(() => [] as string[]);
        const matchR = entriesRoot.find((f) => /\.(md|pdf|docx)$/i.test(f));
        if (matchR) filePath = path.join(cwd, matchR);
      }
    }
    if (!filePath) return { buffer: null, sourcePath: null, ext: "" };

    const ext = path.extname(filePath).toLowerCase() as KnowledgeDocInfo["ext"];
    const buf = await fs.readFile(filePath);
    return { buffer: buf, sourcePath: filePath, ext };
  } catch {
    return { buffer: null, sourcePath: null, ext: "" };
  }
}

function chunkTextIntoPages(text: string, targetChars = 1200): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const pages: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + (current ? "\n\n" : "") + p).length > targetChars && current) {
      pages.push(current.trim());
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length > 0 ? pages : [text];
}

export async function GET() {
  try {
    const info = await readKnowledgeBuffer();
    if (!info.buffer || !info.ext) {
      return NextResponse.json({ pages: [], type: null, sourcePath: null });
    }

    const ext = info.ext;
    const buf = info.buffer;
    let pages: string[] = [];
    let type: "md" | "pdf" | "docx" | "unknown" = "unknown";

    if (ext === ".pdf") {
      // Prefer pdf-parse if available
      const mod = (await import("pdf-parse").catch(() => null)) as any;
      if (mod) {
        const result = await mod(buf);
        const all = (result?.text as string) || "";
        // pdf-parse separates pages by form-feed characters
        pages = all.split(/\f+/g).map((p: string) => p.trim()).filter(Boolean);
      } else {
        pages = [""];
      }
      type = "pdf";
    } else if (ext === ".docx") {
      const mod = (await import("mammoth").catch(() => null)) as any;
      if (mod) {
        const result = await mod.extractRawText({ buffer: buf });
        const text = (result?.value as string) || "";
        // DOCX has no fixed pages; chunk by length with paragraph boundaries
        pages = chunkTextIntoPages(text, 1400);
      } else {
        pages = [""];
      }
      type = "docx";
    } else if (ext === ".md") {
      const text = buf.toString("utf8");
      // Split by top-level headings as pseudo-pages; fallback to chunking
      const byHeadings = text
        .split(/\n(?=#\s+)/g)
        .map((p) => p.trim())
        .filter(Boolean);
      pages = byHeadings.length > 1 ? byHeadings : chunkTextIntoPages(text, 1400);
      type = "md";
    } else {
      pages = [buf.toString("utf8")];
      type = "unknown";
    }

    return NextResponse.json({ pages, type, sourcePath: info.sourcePath });
  } catch {
    return NextResponse.json({ pages: [], type: null, sourcePath: null });
  }
}



