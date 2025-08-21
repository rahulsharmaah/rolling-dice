"use client";

import { useEffect, useRef, useState } from "react";

type BookResponse = {
  pages: string[];
  type: "md" | "pdf" | "docx" | "unknown" | null;
  sourcePath: string | null;
};

export default function SanchaPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [fontSize, setFontSize] = useState<number>(16);
  const [lineHeight, setLineHeight] = useState<number>(26);
  const [meta, setMeta] = useState<{ type: string | null; sourcePath: string | null }>({ type: null, sourcePath: null });

  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
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

  const [isAnimating, setIsAnimating] = useState(false);
  const [animDirection, setAnimDirection] = useState<"next" | "prev">("next");
  const [animToIndex, setAnimToIndex] = useState<number | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [totalSub, setTotalSub] = useState(1);
  const [subPages, setSubPages] = useState<string[]>([]);
  const rightFrameRef = useRef<HTMLDivElement | null>(null);

  const triggerTurn = (dir: "next" | "prev") => {
    if (!pages.length) return;
    // page/column navigation
    if (dir === "next") {
      if (subIndex < totalSub - 1) {
        setSubIndex((v) => v + 1);
        playTurn();
        return;
      }
      if (pageIndex >= pages.length - 1) return;
      const target = pageIndex + 1;
      setAnimDirection(dir);
      setAnimToIndex(target);
      setIsAnimating(true);
      playTurn();
      window.setTimeout(() => {
        setPageIndex(target);
        setSubIndex(0);
        setIsAnimating(false);
        setAnimToIndex(null);
      }, 380);
      return;
    } else {
      if (subIndex > 0) {
        setSubIndex((v) => Math.max(0, v - 1));
        playTurn();
        return;
      }
      if (pageIndex <= 0) return;
      const target = pageIndex - 1;
      setAnimDirection(dir);
      setAnimToIndex(target);
      setIsAnimating(true);
      playTurn();
      window.setTimeout(() => {
        setPageIndex(target);
        // subIndex will be set after measuring new page
        setIsAnimating(false);
        setAnimToIndex(null);
      }, 380);
      return;
    }
  };

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/book", { method: "GET" });
        const data = (await res.json()) as BookResponse;
        if (!data.pages || data.pages.length === 0) {
          setError("Document not available");
          setPages([]);
          return;
        }
        setPages(data.pages);
        setMeta({ type: data.type, sourcePath: data.sourcePath });
        setPageIndex(0);
      } catch {
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    };
    fetchDoc();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") triggerTurn("next");
      else if (e.key === "ArrowLeft") triggerTurn("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    swipeStartXRef.current = e.clientX;
    swipeStartYRef.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const sx = swipeStartXRef.current;
    const sy = swipeStartYRef.current;
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    if (sx == null || sy == null) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
      if (dx < 0) triggerTurn("next"); else triggerTurn("prev");
    }
  };

  const showTwoPages = typeof window !== "undefined" && window.innerWidth >= 1024;
  const rightPageIdx = Math.min(pages.length - 1, pageIndex);
  const leftPageIdx = showTwoPages ? (pageIndex > 0 ? pageIndex - 1 : -1) : rightPageIdx;
  const backgroundSnippet = pages[pageIndex] ? pages[pageIndex].slice(0, 500) : "";

  // Client-side pagination: exactly 10 non-empty lines per subpage
  useEffect(() => {
    const text = pages[Math.min(pages.length - 1, pageIndex)] || "";
    const allLines = text.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/\s+$/,'')).filter(l => l.trim().length > 0);
    const chunks: string[] = [];
    for (let i = 0; i < allLines.length; i += 10) {
      chunks.push(allLines.slice(i, i + 10).join("\n"));
    }
    const finalPages = chunks.length ? chunks : [text];
    setSubPages(finalPages);
    setTotalSub(finalPages.length);
    setSubIndex(idx => Math.min(idx, Math.max(0, finalPages.length - 1)));
  }, [pageIndex, pages]);

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Background Book UI (like /horaa) */}
      <div className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none select-none">
        <div className="book-perspective opacity-[0.10]">
          <div className="book open">
            {/* Left page (match /horaa) */}
            <div className="page left">
              <div className="page-inner">
                <div className="folio-title">रामसत जी</div>
                <div className="carve" aria-hidden>
                  <img src="/ganesha.svg" alt="Lord Ganesha carving" />
                </div>
                <div className="page-heading">Sequence</div>
                <div className="page-seq">{pages.length ? String(pageIndex + 1) : "—"}</div>
                <div className="ornament" aria-hidden>
                  <span className="knot" />
                </div>
              </div>
            </div>
            {/* Right page (match /horaa) */}
            <div className="page right">
              <div className="page-inner">
                <div className="folio-title">रामसत जी</div>
                <div className="page-heading">Horaa</div>
                <div className="content whitespace-pre-wrap text-sm max-h-[46vh] overflow-hidden">{backgroundSnippet}</div>
              </div>
            </div>
            <div className="cover" />
          </div>
        </div>
      </div>
      {/* Book container (same as /horaa, now main UI) */}
      <div className="book-perspective w-full h-screen flex justify-center px-2 py-2">
        <div className={`book open`}>
          {/* Left page: previous content (blank for first page) */}
          <div className="page left">
            <div className="page-inner">
              <div className="folio-title">रामसत जी</div>
              <div className="carve" aria-hidden>
                <img src="/ganesha.svg" alt="Lord Ganesha carving" />
              </div>
              <div className="page-heading">DOCUMENT</div>
              {leftPageIdx >= 0 ? (
                <div className="content-frame flex-1">
                  <div className={`content scrollable whitespace-pre-wrap overflow-auto ${isAnimating ? 'invisible' : ''}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                    {pages[leftPageIdx] || ""}
                  </div>
                  {isAnimating && animToIndex !== null && (
                    <div className="turn-layer">
                      <div className={`page-snap from ${animDirection === 'next' ? 'slide-left-out' : 'slide-right-out'}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                        {pages[leftPageIdx] || ""}
                      </div>
                      <div className={`page-snap to ${animDirection === 'next' ? 'slide-left-in' : 'slide-right-in'}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                        {pages[Math.max(0, animToIndex - 1)] || ""}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="content opacity-0 select-none">&nbsp;</div>
              )}
              <div className="ornament" aria-hidden>
                <span className="knot" />
              </div>
            </div>
          </div>
          {/* Right page */}
          <div className="page right">
            <div className="page-inner">
              <div className="folio-title">रामसत जी</div>
              <div className="page-heading">DOCUMENT</div>
              <div className="content-frame flex-1" ref={rightFrameRef}>
                <div className={`content scrollable whitespace-pre-wrap overflow-auto ${isAnimating ? 'invisible' : ''}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                  {error ? `Error: ${error}` : (loading ? "Loading…" : (subPages[subIndex] || ""))}
                </div>
                {/* measurer removed (no longer needed) */}
                {isAnimating && animToIndex !== null && (
                  <div className="turn-layer">
                    <div className={`page-snap from ${animDirection === 'next' ? 'slide-left-out' : 'slide-right-out'}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                      {subPages[subIndex] || pages[rightPageIdx] || ""}
                    </div>
                    <div className={`page-snap to ${animDirection === 'next' ? 'slide-left-in' : 'slide-right-in'}`} style={{ fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px` }}>
                      {subPages[Math.min(subIndex + (animDirection==='next'?1:-1), subPages.length - 1)] || pages[animToIndex ?? rightPageIdx] || ""}
                    </div>
                  </div>
                )}
              </div>
              {/* Top-right font controls */}
              <div className="text-row flex items-center gap-2">
                <span className="text-xs opacity-75">Text</span>
                <button className="rounded-xl2 btn-pill px-3 py-1.5 text-sm" onClick={() => { setFontSize((s) => Math.max(12, s - 1)); setLineHeight((l) => Math.max(18, l - 1)); }}>A-</button>
                <button className="rounded-xl2 btn-pill px-3 py-1.5 text-sm" onClick={() => { setFontSize((s) => Math.min(22, s + 1)); setLineHeight((l) => Math.min(34, l + 1)); }}>A+</button>
              </div>
              {/* Bottom-right navigation controls */}
              <div className="nav-row flex items-center gap-2">
                <button
                  className="rounded-xl2 btn-pill px-3 py-1.5 text-sm disabled:opacity-60"
                  onClick={() => triggerTurn('prev')}
                  disabled={pageIndex === 0}
                >
                  Prev
                </button>
                <div className="text-xs opacity-80">{pages.length ? `${pageIndex + 1}-${subIndex + 1} / ${pages.length}-${totalSub}` : "—"}</div>
                <button
                  className="rounded-xl2 btn-pill px-3 py-1.5 text-sm disabled:opacity-60"
                  onClick={() => triggerTurn('next')}
                  disabled={pages.length === 0 || pageIndex >= pages.length - 1}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          {/* Cover */}
          <div className="cover" />
        </div>
      </div>
      <style jsx>{`
        /* Background book styles (mirrors /horaa) */
        .book-perspective { perspective: 1200px; transform: scale(0.92); }
        .book { position: relative; width: min(980px, 98vw); height: calc(100vh - 24px); transform-style: preserve-3d; }
        .book .cover { position: absolute; inset: 0; background: linear-gradient(145deg, #6b4f3b 0%, #3e2d23 100%); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.35), inset 0 0 0 2px rgba(255,215,0,0.15); transform-origin: left center; transform: rotateY(-1deg) translateZ(2px); transition: transform 700ms ease-in-out, opacity 700ms ease-in-out; pointer-events: none; }
        .book.open .cover { transform: rotateY(-179deg) translateZ(2px); opacity: 0; }
        .page { position: absolute; top: 0; bottom: 0; width: 50%; padding: 18px; background: radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.85), rgba(245,235,215,0.9) 60%, rgba(240,220,190,0.85)); border: 1px solid rgba(120,80,40,0.35); box-shadow: inset 0 0 60px rgba(0,0,0,0.06); overflow: hidden; }
        .page.left { left: 0; border-right-width: 0; border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        .page.right { right: 0; border-left-width: 0; border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        .page .page-inner { position: relative; width: 100%; height: 100%; padding: 18px 22px 40px 22px; color: #2b1d16; font-family: Georgia, "Times New Roman", serif; display: flex; flex-direction: column; }
        .folio-title { position: absolute; top: 8px; left: 0; right: 0; text-align: center; font-weight: 900; letter-spacing: 0.06em; color: rgba(60,43,34,0.85); text-transform: uppercase; font-size: 11px; pointer-events: none; }
        .page.left .carve { position: absolute; top: 14%; left: 10px; height: 72%; width: auto; opacity: 0.14; filter: grayscale(1) sepia(0.25) brightness(0.7); mix-blend-mode: multiply; pointer-events: none; }
        .page.left .carve img { height: 100%; width: auto; display: block; }
        .page-heading { font-weight: 800; letter-spacing: 0.04em; color: #5a3f32; text-transform: uppercase; font-size: 12px; opacity: 0.8; }
        .page-seq { margin-top: 8px; font-size: clamp(24px, 5vw, 42px); font-weight: 900; color: #3c2b22; }
        .content { margin-top: 10px; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; hyphens: auto; max-width: 100%; }
        /* column css removed; using client-side pagination instead */
        .scrollable { -ms-overflow-style: none; scrollbar-width: none; }
        .scrollable::-webkit-scrollbar { width: 0; height: 0; }
        .content-frame { position: relative; width: 100%; height: 100%; }
        .turn-layer { position: absolute; inset: 0; overflow: hidden; }
        .page-snap { position: absolute; inset: 0; padding-right: 6px; }
        .controls-row { position: absolute; right: 18px; bottom: 14px; display: none; }
        .text-row { position: absolute; right: 18px; top: 14px; display: flex; align-items: center; gap: 8px; background: rgba(245,235,215,0.7); backdrop-filter: blur(2px); padding: 6px 8px; border-radius: 12px; border: 1px solid rgba(120,80,40,0.25); }
        .nav-row { position: absolute; right: 18px; bottom: 14px; display: flex; align-items: center; gap: 8px; background: rgba(245,235,215,0.7); backdrop-filter: blur(2px); padding: 6px 8px; border-radius: 12px; border: 1px solid rgba(120,80,40,0.25); }
        @media (max-width: 640px) {
          .text-row { left: 18px; right: 18px; justify-content: center; }
          .nav-row { left: 18px; right: 18px; justify-content: space-between; }
        }
        .page-snap.from { z-index: 2; }
        .page-snap.to { z-index: 3; }
        .slide-left-out { animation: slideLeftOut 380ms ease forwards; }
        .slide-left-in { animation: slideLeftIn 380ms ease forwards; }
        .slide-right-out { animation: slideRightOut 380ms ease forwards; }
        .slide-right-in { animation: slideRightIn 380ms ease forwards; }
        @keyframes slideLeftOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(-12%); opacity: 0.2; } }
        @keyframes slideLeftIn { from { transform: translateX(12%); opacity: 0.2; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideRightOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(12%); opacity: 0.2; } }
        @keyframes slideRightIn { from { transform: translateX(-12%); opacity: 0.2; } to { transform: translateX(0); opacity: 1; } }
        .ornament { position: absolute; bottom: 14px; left: 0; right: 0; display: flex; justify-content: center; }
        .knot { width: 120px; height: 10px; background: linear-gradient(90deg, rgba(180,120,60,0.5), rgba(220,170,90,0.8), rgba(180,120,60,0.5)); border-radius: 999px; box-shadow: 0 0 12px rgba(200,150,70,0.4); animation: glow 3s ease-in-out infinite; }
        @keyframes glow { 0%,100% { opacity: 0.7 } 50% { opacity: 1 } }
        /* Responsive: single page on mobile */
        @media (max-width: 1023px) {
          .page.left { display: none; }
          .page.right { width: 100%; }
          .book { width: min(740px, 98vw); height: calc(100vh - 24px); }
        }
        .btn-pill { background: rgba(255,255,255,0.94); color: #2b1d16; border: 1px solid rgba(120,80,40,0.35); box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
        .btn-pill:hover { background: rgba(255,255,255,1); }
      `}</style>
    </div>
  );
}



