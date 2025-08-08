import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type Body = {
  sequence: string; // e.g. "2431"
  humanSeq?: string; // e.g. "2 → 4 → 3 → 1"
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

async function readKnowledgeDoc(): Promise<string> {
  try {
    const cwd = process.cwd();
    const dir = path.join(cwd, "knowledge");
    const fromEnv = process.env.KNOWLEDGE_PATH ? path.isAbsolute(process.env.KNOWLEDGE_PATH) ? process.env.KNOWLEDGE_PATH : path.join(cwd, process.env.KNOWLEDGE_PATH) : null;
    const candidates = [
      // explicit env path first
      fromEnv,
      // preferred names inside knowledge/
      path.join(dir, "thoughts.md"),
      path.join(dir, "thoughts.pdf"),
      path.join(dir, "thoughts.docx"),
      // root-level preferred names
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
      // fallback: first .md/.pdf/.docx in knowledge/ then project root
      const entriesK = await fs.readdir(dir).catch(() => [] as string[]);
      const matchK = entriesK.find((f) => /\.(md|pdf|docx)$/i.test(f));
      if (matchK) filePath = path.join(dir, matchK);
      if (!filePath) {
        const entriesRoot = await fs.readdir(cwd).catch(() => [] as string[]);
        const matchR = entriesRoot.find((f) => /\.(md|pdf|docx)$/i.test(f));
        if (matchR) filePath = path.join(cwd, matchR);
      }
    }
    if (!filePath) return "";

    const ext = path.extname(filePath).toLowerCase();
    const buf = await fs.readFile(filePath);
    if (ext === ".md") return buf.toString("utf8");
    if (ext === ".pdf") return (await parsePdf(buf)) || "";
    if (ext === ".docx") return (await parseDocx(buf)) || "";
    return "";
  } catch {
    return "";
  }
}

async function generateWithGemini(prompt: string): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    // Lazy import so the project builds even if SDK isn't installed
    const mod = await import("@google/generative-ai").catch(() => null as any);
    if (!mod) return null;
    const { GoogleGenerativeAI } = mod as any;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() ?? result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text === "string" && text.trim()) return text.trim();
    return null;
  } catch {
    return null;
  }
}

function fallbackThought(sequence: string, language: "en" | "hi"): string {
  const hyphen = sequence.split("").join("-");
  if (language === "hi") {
    return `विचार संख्या ${hyphen}`;
  }
  return `Thought number ${hyphen}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const sequence = (body.sequence || "").replace(/[^1-4]/g, "");
    const language: "en" | "hi" = body.language === "hi" ? "hi" : "en";
    const title = (body.title || "").slice(0, 200);
    const humanSeq = body.humanSeq || sequence.split("").join(" → ");
    const keyNoSep = sequence;
    const keyHyphen = sequence.split("").join("-");
    const keyArrow = humanSeq;

    if (!sequence) {
      return NextResponse.json({ text: fallbackThought("", language), from: "fallback" });
    }

    const knowledge = await readKnowledgeDoc();
    const sys = language === "hi" ? "आप एक सहायक विश्लेषक हैं जो संदर्भ दस्तावेज़ से कुंजी खोजकर मनुष्यों को समझ में आने वाला उत्तर लिखते हैं।" : "You are a helpful analyst who searches a reference document for keys and writes a human-friendly answer.";
    const ask = language === "hi"
      ? `कार्य: नीचे दिए गए दस्तावेज़ को देख कर इस अनुक्रम के लिए (एक या दो वाक्य में) स्पष्ट, मानवीय भाषा में विचार लिखें।
कुंजियाँ जिनके आधार पर मिलान करें: "${keyNoSep}", "${keyHyphen}", "${keyArrow}"।
यदि दस्तावेज़ में इस अनुक्रम का स्पष्ट विचार नहीं मिलता, तो पहले यह लिखें: "${humanSeq} के लिए कोई स्पष्ट प्रविष्टि नहीं मिली।" और फिर दस्तावेज़ की भावना के अनुरूप एक संक्षिप्त, व्यावहारिक विचार दें।
उत्तर केवल अंतिम विचार के रूप में दें (अनावश्यक प्रस्तावना/शीर्षक नहीं)। भाषा: हिंदी।`
      : `Task: Using the document below, produce a clear, human-friendly thought (1–2 sentences) for the sequence.
Match using keys: "${keyNoSep}", "${keyHyphen}", "${keyArrow}".
If no explicit entry exists for this sequence, first state: "No explicit entry found for ${humanSeq}." then provide a concise, practical thought aligned with the document's spirit.
Return only the final thought (no headers). Language: English.`;
    const titleLine = title ? (language === "hi" ? `प्रश्न: ${title}\n` : `Question: ${title}\n`) : "";
    const prompt = `${sys}\n${ask}\n${titleLine}\nSequence: ${humanSeq}\n\n--- Document ---\n${knowledge}\n-----------------\n`;

    const ai = await generateWithGemini(prompt);
    const text = (ai && ai.trim()) || fallbackThought(sequence, language);

    return NextResponse.json({ text, from: ai ? "gemini" : "fallback", prompt });
  } catch (err) {
    return NextResponse.json({ text: fallbackThought("", "en"), from: "error" }, { status: 200 });
  }
}


