"use client";

import { useEffect, useRef, useState } from "react";

function normalizeDigits(input: string): string[] {
  const digits = Array.from(input).filter((c) => /[1-4]/.test(c));
  return digits;
}

export default function HoraaLookupPage() {
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [typed, setTyped] = useState<string>("");
  const [isOpening, setIsOpening] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string>("");
  const typingTimerRef = useRef<number | null>(null);
  const [fullPages, setFullPages] = useState<string[] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playTurn = () => {
    try {
      const a = audioRef.current;
      if (a) {
        a.currentTime = 0;
        void a.play();
      }
    } catch {}
  };

  const handleLookup = async () => {
    setError("");
    setResult("");
    setTyped("");
    setIsOpening(true);
    window.setTimeout(() => {
      setIsOpening(false);
      setIsOpen(true);
    }, 500);
    const digits = normalizeDigits(input);
    if (digits.length === 0) {
      setError(language === "hi" ? "कृपया 1-4 के अंकों का अनुक्रम दर्ज करें" : "Please enter a sequence using digits 1-4");
      return;
    }
    const sequence = digits.join("");
    const humanSeq = digits.join(" → ");
    try {
      setLoading(true);
      const res = await fetch("/api/thought", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sequence, humanSeq, language }),
      });
      const data = await res.json().catch(() => null as any);
      const text: string = (data?.text && String(data.text)) || "";
      setResult(text);
    } catch (err) {
      setError(language === "hi" ? "त्रुटि हुई—कृपया दुबारा प्रयास करें" : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const placeholder = language === "hi" ? "अनुक्रम दर्ज करें जैसे 3-2 या 32" : "Enter sequence like 3-2 or 32";

  // Typewriter effect
  useEffect(() => {
    if (!result) {
      if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
      setTyped("");
      return;
    }
    setTyped("");
    const text = result;
    let i = 0;
    const baseDelay = 14;
    if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
    typingTimerRef.current = window.setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length) {
        if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    }, baseDelay) as unknown as number;
    return () => {
      if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    };
  }, [result]);

  useEffect(() => {
    // preload page turn audio
    try {
      const a = new Audio("/page-turn.mp3");
      a.preload = "auto";
      audioRef.current = a;
    } catch {}
  }, []);

  return (
    <div className="min-h-screen px-4 py-6 flex flex-col items-center gap-6 relative overflow-hidden">
      {/* Subtle mythic background */}
      <div className="pointer-events-none select-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(255,215,0,0.05),transparent_35%),linear-gradient(180deg,rgba(180,150,100,0.08),transparent)]" />
      </div>

      {/* Controls */}
      <div className="relative z-20 w-full max-w-3xl rounded-xl2 border border-white/10 bg-panel/90 p-4 shadow">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="flex-1 rounded-xl2 border border-white/10 bg-panel px-3 py-2 text-sm outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
          />
          <div className="flex items-center gap-2">
            {(["en", "hi"] as const).map((l) => (
              <button
                key={l}
                className={`rounded-xl2 px-3 py-2 text-sm border ${language === l ? "bg-primary text-black border-transparent" : "bg-panel text-ink/90 border-white/10"}`}
                onClick={() => setLanguage(l)}
              >
                {l === "en" ? "EN" : "HI"}
              </button>
            ))}
            <button
              className="rounded-xl2 bg-accent px-4 py-2 text-black text-sm disabled:opacity-50"
              onClick={handleLookup}
              disabled={loading}
            >
              {loading ? (language === "hi" ? "खोज रहा है…" : "Fetching…") : (language === "hi" ? "ढूँढें" : "Open Book")}
            </button>
            <button
              className="rounded-xl2 bg-primary px-4 py-2 text-black text-sm disabled:opacity-50"
              onClick={async () => {
                try {
                  setLoadingDoc(true);
                  setError("");
                  const res = await fetch("/api/book", { method: "GET" });
                  const data = await res.json().catch(() => null as any);
                  const pages = (data?.pages as string[]) || [];
                  if (!pages.length) {
                    setError(language === "hi" ? "दस्तावेज़ उपलब्ध नहीं" : "Document not available");
                    setFullPages(null);
                    setPageIndex(0);
                  } else {
                    setFullPages(pages);
                    setPageIndex(0);
                    setIsOpening(true);
                    window.setTimeout(() => { setIsOpening(false); setIsOpen(true); }, 400);
                  }
                } catch {
                  setError(language === "hi" ? "दस्तावेज़ लोड नहीं हुआ" : "Failed to load document");
                } finally {
                  setLoadingDoc(false);
                }
              }}
              disabled={loadingDoc}
            >
              {loadingDoc ? (language === "hi" ? "लोड हो रहा…" : "Loading…") : (language === "hi" ? "पूरा दस्तावेज़" : "Load Full Doc")}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 text-sm text-red-500">{error}</div>
        )}
      </div>

      {/* Book container */}
      <div className={`book-perspective w-full flex justify-center mt-2`}>
        <div className={`book ${isOpening ? "opening" : ""} ${isOpen ? "open" : ""}`}>
          {/* Left page */}
          <div className="page left">
            <div className="page-inner">
              <div className="folio-title">रामसत जी</div>
              <div className="carve" aria-hidden>
                <img src="/ganesha.svg" alt="Lord Ganesha carving" />
              </div>
              <div className="page-heading">{language === "hi" ? "अनुक्रम" : "Sequence"}</div>
              <div className="page-seq">{normalizeDigits(input).join(" → ") || (language === "hi" ? "—" : "—")}</div>
              <div className="ornament" aria-hidden>
                <span className="knot" />
              </div>
            </div>
          </div>
          {/* Right page */}
          <div className="page right">
            <div className="page-inner">
              <div className="folio-title">रामसत जी</div>
              <div className="page-heading">{fullPages ? (language === "hi" ? "दस्तावेज़" : "Document") : (language === "hi" ? "होरा" : "Horaa")}</div>
              {!fullPages && (
                <div className="content whitespace-pre-wrap">{typed}</div>
              )}
              {fullPages && (
                <div className="flex h-full flex-col">
                  <div
                    className="content whitespace-pre-wrap flex-1 overflow-auto"
                    onScrollCapture={() => {
                      // noop but keeps smooth scrolling on mobile
                    }}
                  >
                    {fullPages[pageIndex] || ""}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className="rounded-xl2 px-2 py-1 text-sm border bg-panel text-ink/90 border-white/10 disabled:opacity-50"
                      onClick={() => setPageIndex((p) => { const next = Math.max(0, p - 1); playTurn(); return next; })}
                      disabled={pageIndex === 0}
                    >
                      {language === "hi" ? "पिछला" : "Prev"}
                    </button>
                    <div className="text-xs opacity-80">
                      {(pageIndex + 1)} / {fullPages.length}
                    </div>
                    <button
                      className="rounded-xl2 px-2 py-1 text-sm border bg-panel text-ink/90 border-white/10 disabled:opacity-50"
                      onClick={() => setPageIndex((p) => { const next = Math.min((fullPages?.length || 1) - 1, p + 1); playTurn(); return next; })}
                      disabled={!fullPages || pageIndex >= fullPages.length - 1}
                    >
                      {language === "hi" ? "अगला" : "Next"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Cover */}
          <div className="cover" />
        </div>
      </div>
      {/* Hidden audio element for page turn */}
      <audio src="/page-turn.mp3" preload="auto" className="hidden" />

      <style jsx>{`
        .book-perspective { perspective: 1200px; }
        .book {
          position: relative;
          width: min(920px, 96vw);
          height: min(540px, 70vh);
          transform-style: preserve-3d;
        }
        .book .cover {
          position: absolute; inset: 0;
          background: linear-gradient(145deg, #6b4f3b 0%, #3e2d23 100%);
          border-radius: 12px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.35), inset 0 0 0 2px rgba(255,215,0,0.15);
          transform-origin: left center;
          transform: rotateY(-1deg) translateZ(2px);
          transition: transform 700ms ease-in-out, opacity 700ms ease-in-out;
          pointer-events: none;
        }
        .book.open .cover { transform: rotateY(-179deg) translateZ(2px); opacity: 0; }
        .book.opening .cover { transform: rotateY(-60deg) translateZ(2px); }
        .page {
          position: absolute;
          top: 0; bottom: 0;
          width: 50%;
          padding: 18px;
          background: radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.85), rgba(245,235,215,0.9) 60%, rgba(240,220,190,0.85));
          border: 1px solid rgba(120,80,40,0.35);
          box-shadow: inset 0 0 60px rgba(0,0,0,0.06);
          overflow: hidden;
        }
        .page.left { left: 0; border-right-width: 0; border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        .page.right { right: 0; border-left-width: 0; border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        .page .page-inner {
          position: relative;
          width: 100%; height: 100%;
          padding: 18px 22px;
          color: #2b1d16;
          font-family: Georgia, "Times New Roman", serif;
        }
        .folio-title {
          position: absolute;
          top: 8px; left: 0; right: 0;
          text-align: center;
          font-weight: 900;
          letter-spacing: 0.06em;
          color: rgba(60,43,34,0.85);
          text-transform: uppercase;
          font-size: 11px;
          pointer-events: none;
        }
        .page.left .carve {
          position: absolute;
          top: 14%; left: 10px;
          height: 72%; width: auto;
          opacity: 0.14;
          filter: grayscale(1) sepia(0.25) brightness(0.7);
          mix-blend-mode: multiply;
          pointer-events: none;
        }
        .page.left .carve img { height: 100%; width: auto; display: block; }
        .page-heading { font-weight: 800; letter-spacing: 0.04em; color: #5a3f32; text-transform: uppercase; font-size: 12px; opacity: 0.8; }
        .page-seq { margin-top: 8px; font-size: clamp(24px, 5vw, 42px); font-weight: 900; color: #3c2b22; }
        .content { margin-top: 10px; font-size: 14px; line-height: 1.6; }
        .ornament { position: absolute; bottom: 14px; left: 0; right: 0; display: flex; justify-content: center; }
        .knot { width: 120px; height: 10px; background: linear-gradient(90deg, rgba(180,120,60,0.5), rgba(220,170,90,0.8), rgba(180,120,60,0.5)); border-radius: 999px; box-shadow: 0 0 12px rgba(200,150,70,0.4); animation: glow 3s ease-in-out infinite; }
        @keyframes glow { 0%,100% { opacity: 0.7 } 50% { opacity: 1 } }
      `}</style>
    </div>
  );
}


