import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type Body = {
  sequence: string;
  humanSeq?: string;
  title?: string;
  language?: "en" | "hi";
};

async function parsePdf(buffer: Buffer): Promise<string | null> {
  try {
    const mod = (await import("pdf-parse").catch(() => null)) as any;
    if (!mod) return null;
    const result = await mod(buffer);
    return (result?.text as string) || null;
  } catch {
    return null;
  }
}

async function parseDocx(buffer: Buffer): Promise<string | null> {
  try {
    const mod = (await import("mammoth").catch(() => null)) as any;
    if (!mod) return null;
    const result = await mod.extractRawText({ buffer });
    return (result?.value as string) || null;
  } catch {
    return null;
  }
}

type KnowledgeDoc = { text: string; sourcePath: string | null };

async function readKnowledgeDoc(): Promise<KnowledgeDoc> {
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
      } catch { }
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
    if (!filePath) return { text: "", sourcePath: null };

    const ext = path.extname(filePath).toLowerCase();
    const buf = await fs.readFile(filePath);
    if (ext === ".md") return { text: buf.toString("utf8"), sourcePath: filePath };
    if (ext === ".pdf") return { text: (await parsePdf(buf)) || "", sourcePath: filePath };
    if (ext === ".docx") return { text: (await parseDocx(buf)) || "", sourcePath: filePath };
    return { text: "", sourcePath: filePath };
  } catch {
    return { text: "", sourcePath: null };
  }
}

type GeminiOptions = {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topK?: number;
  topP?: number;
};

async function generateWithGemini(opts: GeminiOptions): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const mod = await import("@google/generative-ai").catch(() => null as any);
    if (!mod) return null;
    const { GoogleGenerativeAI } = mod as any;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
    });
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0,
        topK: opts.topK ?? 1,
        topP: opts.topP ?? 0.9,
      },
    });
    const text =
      result?.response?.text?.() ??
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

function fallbackThought(sequence: string, language: "en" | "hi"): string {
  const hyphen = sequence.split("").join("-");
  return language === "hi"
    ? `विचार संख्या ${hyphen}`
    : `Thought number ${hyphen}`;
}

function extractExactAnswersGroupedByChapter(docText: string, candidateKeys: string[]): string | null {
  if (!docText.trim()) return null;
  const lines = docText.split(/\r?\n/);

  const isHeading = (line: string) => {
    const trimmed = line.trim();
    return (
      /^#{1,6}\s+/.test(trimmed) ||
      /^chapter\b/i.test(trimmed) ||
      /^(?:section|part)\b/i.test(trimmed) ||
      /^\d+\s*[\.)-]?\s+/.test(trimmed)
    );
  };

  const buildPatterns = (seq: string) => {
    const digits = seq.split("");
    if (digits.some((d) => !/[1-4]/.test(d))) return [];
    const reps = [
      digits.join(""),
      digits.join("\\s*-\\s*"),
      digits.join("\\s*(?:→|->)\\s*"),
      digits.join("\\s*,\\s*"),
      digits.join("\\s+"),
    ];
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns: RegExp[] = [];
    for (const rep of reps) {
      // 1) Line-head anchored: starts the line (optionally 'Sequence ' prefix) and not followed by a separator+digit chain
      patterns.push(new RegExp(`^\\s*(?:[Ss]equence\\s*)?${rep}(?!\\s*[,→-]\\s*[1-4])(?![1-4])(?:\\s*[:：–—-]|\\s|$)`, "i"));
      // 2) Token-level: not preceded by a digit and not followed by separator+digit or digit
      patterns.push(new RegExp(`(?:^|[^1-4])(${rep})(?!\\s*[,→-]\\s*[1-4])(?![1-4])`, "i"));
    }
    // Also include exact token equality
    patterns.push(new RegExp(`^\\s*${esc(seq)}\\s*$`, "i"));
    return patterns;
  };

  const keyPatterns = candidateKeys.flatMap(buildPatterns);
  const buckets: { chapter: string; answers: string[] }[] = [];
  let currentChapter = "Untitled";
  let currentIndex = -1;
  const seenBlocks = new Set<string>();

  const collectBlock = (start: number) => {
    const acc: string[] = [];
    let j = start;
    while (j < lines.length && !isHeading(lines[j]) && lines[j].trim()) {
      acc.push(lines[j]);
      j++;
    }
    return { block: acc.join("\n"), end: j };
  };

  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      currentChapter = lines[i].trim();
      buckets.push({ chapter: currentChapter, answers: [] });
      currentIndex = buckets.length - 1;
      continue;
    }
    if (keyPatterns.some((re) => re.test(lines[i]))) {
      const { block, end } = collectBlock(i);
      if (block && !seenBlocks.has(block)) {
        if (currentIndex === -1) {
          buckets.push({ chapter: currentChapter, answers: [] });
          currentIndex = 0;
        }
        buckets[currentIndex].answers.push(block);
        seenBlocks.add(block);
      }
      i = end - 1;
    }
  }

  const nonEmpty = buckets.filter((b) => b.answers.length > 0);
  if (nonEmpty.length === 0) return null;
  const parts: string[] = [];
  for (const b of nonEmpty) {
    for (const ans of b.answers) {
      parts.push(`Chapter: ${b.chapter}\nAnswer:\n${ans}`);
    }
  }
  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const sequence = (body.sequence || "").replace(/[^1-4]/g, "");
    const language = body.language === "hi" ? "hi" : "en";
    const humanSeq = body.humanSeq || sequence.split("").join(" → ");

    if (!sequence) {
      return NextResponse.json({
        text: fallbackThought("", language),
        from: "fallback",
      });
    }

    const knowledgeObj = await readKnowledgeDoc();
    const knowledge = knowledgeObj.text;
    const candidateKeys = Array.from(
      new Set([
        sequence,
        sequence.split("").join("-"),
        sequence.split("").join(" → "),
        sequence.split("").join(" "),
        sequence.split("").join(","),
        sequence.split("").join(", "),
      ])
    );

    // First try regex-based direct extraction
    const extracted = extractExactAnswersGroupedByChapter(knowledge, candidateKeys);
    if (extracted) {
      return NextResponse.json({ text: extracted, from: "document" });
    }

    // If not found, try Gemini AI search in document
    const sysPrompt =
      language === "hi"
        ? "आपका कार्य: केवल दस्तावेज़ से मिलान करने वाले exact (verbatim) अनुच्छेद/पंक्तियाँ निकालना। कोई पैराफ्रेस नहीं। फॉर्मेट का कड़ाई से पालन करें।"
        : "Your job: extract ONLY exact (verbatim) lines/paragraphs from the document that match. No paraphrasing. Follow the output format strictly.";

    const truncatedDoc = knowledge.length > 200_000 ? `${knowledge.slice(0, 200_000)}\n... [TRUNCATED]` : knowledge;
    const prompt = `Sequence: ${humanSeq}
Equivalent formats: ${candidateKeys.join(", ")}

BEGIN DOCUMENT
${truncatedDoc}
END DOCUMENT

RULES
1) Find exact (verbatim) occurrences of ONLY this sequence (any of the equivalent formats). Do NOT match if the sequence is part of a longer sequence (e.g., 32,1, 1-32, 132, etc.).
2) For each match, take the nearest preceding heading as Chapter.
3) Output plain text blocks:
Chapter: <heading line>
Answer:
<exact line or paragraph>

If none found, output exactly: ${language === "hi" ? `"${humanSeq} के लिए कोई स्पष्ट प्रविष्टि नहीं मिली।"` : `"No explicit entry found for ${humanSeq}."`}`;

    const ai = await generateWithGemini({ prompt, systemInstruction: sysPrompt, temperature: 0, topK: 1, topP: 0.9 });
    return NextResponse.json({
      text: ai || fallbackThought(sequence, language),
      from: ai ? "gemini" : "fallback",
      debug: {
        knowledgePath: knowledgeObj.sourcePath,
        knowledgeChars: knowledge.length,
        usedExtraction: false,
      }
    });
  } catch {
    return NextResponse.json(
      { text: fallbackThought("", "en"), from: "error" },
      { status: 200 }
    );
  }
}
