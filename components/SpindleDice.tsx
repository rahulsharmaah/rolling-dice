"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { thoughtForSequence } from "@/lib/thoughts";

const angs = [0, Math.PI/2, Math.PI, 3*Math.PI/2]; // local angles for sides 1..4
const rotationForResult = (res: number) => {
  const a = angs[res-1];
  return Math.PI/2 - a;
};

type RollItem = { n: number; ts: string; roll: number; group: number; inGroup: number; groupSize: number };

export default function SpindleDice() {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [rolls, setRolls] = useState(0);
  const [history, setHistory] = useState<RollItem[]>([]);
  const [bigNum, setBigNum] = useState<string>("—");
  const [thought, setThought] = useState<string>("");
  const [sequence, setSequence] = useState<string>("—");
  const [histOpen, setHistOpen] = useState(false);
  const [thoughtLogged, setThoughtLogged] = useState(false);
  const [thoughtAfter, setThoughtAfter] = useState<number>(2); // show thought after N rolls
  const [thoughtHistory, setThoughtHistory] = useState<{ seq: string; text: string; ts: string; title?: string; size: number }[]>([]);
  const [showOverlay, setShowOverlay] = useState(false);
  // grouping is derived from history length; no external counters needed
  const [sessionTitle, setSessionTitle] = useState<string>("");
  const [language, setLanguage] = useState<"en"|"hi">("en");
  const speakingRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[] | null>(null);
  // Ensure we always use the latest group size and allow resetting group on change
  const thoughtAfterRef = useRef<number>(thoughtAfter);
  const groupStartIndexRef = useRef<number>(0);

  // Local ref state for three
  const stateRef = useRef({ idle: true, spinning: false, settling: false, spinTicks: 0, settleTicks: 0, targetRotation: 0, startRotation: 0, extraSpinFrames: 30 });
  const threeRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; diceObj: THREE.Mesh; edgeLines: THREE.LineSegments } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    const canvas = canvasRef.current;
    if (!mount || !canvas) return;

    // Renderer / Scene / Camera
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(2.2, 1.6, 2.6);
    camera.lookAt(0, 0, 0);

    // Lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1e2a, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 4, 2);
    scene.add(dir);

    // Geometry: spindle / pen
    const diceGroup = new THREE.Group();
    scene.add(diceGroup);
    function makeSpindleGeometry(height=1.2, radius=0.28, power=0.6, radialSegments=10, heightSegments=10){
      const pts: THREE.Vector2[] = [];
      const half = height/2;
      for(let i=0;i<=heightSegments;i++){
        const t = i/heightSegments;
        const y = -half + t*height;
        const k = 1 - Math.pow(Math.abs(y/half), power);
        const r = Math.max(0.001, radius * Math.sqrt(Math.max(0, k)));
        pts.push(new THREE.Vector2(r, y));
      }
      return new THREE.LatheGeometry(pts, radialSegments);
    }

    // Slightly thinner dice by using a smaller base radius in geometry
    const baseRadius = 0.48; // was 0.55
    const geo = makeSpindleGeometry(2.2, baseRadius, 1.6);
    geo.center();
    // Skin-like dice with brownish accents
    const diceMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#f0c7a0"), roughness: 0.5, metalness: 0.08 } as any);
    const diceObj = new THREE.Mesh(geo, diceMat);
    diceGroup.add(diceObj);

    const edges = new THREE.EdgesGeometry(geo, 25);
    const edgeLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x8b6b55, opacity: 0.28, transparent: true })
    );
    diceGroup.add(edgeLines);

    // Pips
    function makeDots(num: number, angle: number, surfaceRadius: number){
      const group = new THREE.Group();
      const dotGeo = new THREE.SphereGeometry(0.05, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#6b4f3b") } as any);
      const radius = surfaceRadius;
      for(let i=0;i<num;i++){
        const a = angle + (i - (num-1)/2) * 0.15;
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(Math.cos(a)*radius, 0, Math.sin(a)*radius);
        group.add(dot);
      }
      return group;
    }
    // Keep dots sitting slightly above the surface at y=0 (equator)
    const dotSurfaceRadius = baseRadius + 0.10; // small offset from geometry radius so dots are visible
    const dotsGroups = [1,2,3,4].map((n, i)=>{ const g = makeDots(n, angs[i], dotSurfaceRadius); diceGroup.add(g); return g; });

    // Keep dots locked to dice rotation
    const baseRender = renderer.render.bind(renderer);
    renderer.render = function(sc: THREE.Scene, cam: THREE.PerspectiveCamera){
      dotsGroups.forEach(g => g.rotation.copy(diceObj.rotation));
      baseRender(sc, cam);
    };

    // Resize
    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Scale down a bit on small screens
      const mobileScale = width <= 480 ? 0.82 : width <= 640 ? 0.9 : 1.0;
      diceGroup.scale.set(mobileScale, mobileScale, mobileScale);
    };
    window.addEventListener("resize", resize);
    resize();

    // Animation loop
    const s = stateRef.current;
    const raf = () => {
      requestAnimationFrame(raf);
      if(s.idle){
        // gentle idle spin
        diceObj.rotation.y += 0.01;
        diceObj.rotation.x += 0.004;
      }
      if(s.spinning){
        s.spinTicks++;
        diceObj.rotation.y += 0.45;
        if(s.spinTicks > s.extraSpinFrames){ s.spinning = false; s.settling = true; s.settleTicks = 0; s.startRotation = diceObj.rotation.y; }
      } else if(s.settling){
        s.settleTicks++;
        const dur = 28; const t = Math.min(1, s.settleTicks/dur);
        const ease = t*t*(3-2*t);
        diceObj.rotation.y = s.startRotation + (s.targetRotation - s.startRotation) * ease;
        if(t>=1){ s.settling = false; s.idle = true; }
      }
      edgeLines.rotation.copy(diceObj.rotation);
      renderer.render(scene, camera);
    };
    raf();

    threeRef.current = { renderer, scene, camera, diceObj, edgeLines };

    // Flick input
    let dragStartX = 0, dragStartY = 0, dragStartTime = 0, dragging = false;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY; dragStartTime = performance.now();
      canvas.setPointerCapture(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      if(!dragging) return;
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const dt = Math.max(1, performance.now() - dragStartTime);
      const speed = Math.hypot(dx, dy) / dt;
      // perform roll
      if(stateRef.current.idle){
        performRoll(undefined, speed);
        if((navigator as any).vibrate) (navigator as any).vibrate(15);
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      renderer.dispose();
      geo.dispose();
      dotsGroups.forEach(g => g.clear());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performRoll = (forced?: number, flickSpeed?: number) => {
    // Hide any previous overlay until (and unless) a new group completes
    setShowOverlay(false);
    setRolls(r => {
      const s = stateRef.current;
      if(!s.idle) return r;
      const n = forced ?? (1 + Math.floor(Math.random()*4));
      const ts = new Date().toLocaleTimeString();
      setHistory(h => {
        const m = h.length; // rolls before adding this one
        const currentGroupSize = thoughtAfterRef.current;
        const base = groupStartIndexRef.current;
        const delta = Math.max(0, m - base);
        const inGroupLocal = (delta % currentGroupSize) + 1;
        const groupLocal = Math.floor(delta / currentGroupSize) + 1;
        const item: RollItem = { n, ts, roll: r + 1, group: groupLocal, inGroup: inGroupLocal, groupSize: currentGroupSize };
        const next = [...h, item];
        const meetsThreshold = inGroupLocal === currentGroupSize;
        if (meetsThreshold) {
          const lastK = next.slice(-currentGroupSize);
          const seqStr = lastK.map(x => x.n).join("");
          const human = lastK.map(x => x.n).join(" → ");
          setSequence(human || "—");
          setThought(language === 'hi' ? 'सोच रहा है…' : 'Thinking…');
          setThoughtLogged(true);
          setShowOverlay(true);
          fetch('/api/thought', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sequence: seqStr, humanSeq: human, title: sessionTitle, language })
          }).then(async r => {
            const data = await r.json().catch(()=>null as any);
            const text: string = (data?.text && String(data.text)) || thoughtForSequence(seqStr);
            setThought(text);
            setThoughtHistory(prev => [{ seq: human, text, ts, title: sessionTitle || undefined, size: currentGroupSize }, ...prev]);
          }).catch(() => {
            const text = thoughtForSequence(seqStr);
            setThought(text);
            setThoughtHistory(prev => [{ seq: human, text, ts, title: sessionTitle || undefined, size: currentGroupSize }, ...prev]);
          });
        } else {
          setThoughtLogged(false);
        }
        return next;
      });
      setBigNum(String(n));
      // Spin plan
      s.idle = false; s.spinning = true; s.settling = false;
      s.spinTicks = 0; s.extraSpinFrames = flickSpeed ? Math.min(90, 20 + Math.floor(flickSpeed*120)) : 30;
      s.targetRotation = rotationForResult(n);
      return r+1;
    });
  };

  useEffect(() => {
    // When threshold changes, record the latest value and start a fresh group from the next roll
    thoughtAfterRef.current = thoughtAfter;
    groupStartIndexRef.current = history.length;
    setThoughtLogged(false);
    setShowOverlay(false);
  }, [thoughtAfter]);

  // Voice: speak helper
  useEffect(() => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const updateVoices = () => {
        voicesRef.current = window.speechSynthesis.getVoices();
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
      return () => {
        window.speechSynthesis.onvoiceschanged = undefined as any;
      };
    } catch {}
  }, []);

  const pickVoice = (target: "en" | "hi"): SpeechSynthesisVoice | null => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = voicesRef.current || window.speechSynthesis.getVoices() || [];
    const preferLangs = target === "hi"
      ? ["hi-IN", "hi_IN", "hi"]
      : ["en-IN", "en-GB", "en-US", "en_US", "en"];
    // exact lang match
    for (const code of preferLangs) {
      const v = voices.find(v => v.lang && v.lang.toLowerCase() === code.toLowerCase());
      if (v) return v;
    }
    // startsWith match
    for (const code of preferLangs) {
      const base = code.split(/[\-_]/)[0].toLowerCase();
      const v = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(base));
      if (v) return v;
    }
    // name hint
    const nameRe = target === "hi" ? /(hi|hindi|india)/i : /(en|english|us|uk|india)/i;
    const byName = voices.find(v => nameRe.test(v.name));
    return byName || null;
  };

  const speak = (text: string, lang?: "en"|"hi") => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      // Normalize symbols for better pronunciation
      const sanitizeForSpeech = (s: string) => s
        .replace(/[→↔↦➔➜⟶]/g, " to ")
        .replace(/[–—-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const content = sanitizeForSpeech(text);
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(content);
      const target = lang === "hi" ? "hi" : "en";
      const v = pickVoice(target);
      if (v) utter.voice = v;
      utter.lang = v?.lang || (target === "hi" ? "hi-IN" : "en-US");
      // Slightly slower for Hindi for clarity
      utter.rate = target === "hi" ? 0.95 : 1.0;
      utter.pitch = 1.0;
      utter.onstart = () => { speakingRef.current = true; };
      utter.onend = () => { speakingRef.current = false; };
      window.speechSynthesis.speak(utter);
    } catch {}
  };

  // Voice: setup recognition (for dictating session title)
  const startDictation = () => {
    try {
      const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return;
      const rec = new SR();
      rec.lang = language === 'hi' ? 'hi-IN' : 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript as string;
        setSessionTitle(prev => (prev ? `${prev} ${transcript}` : transcript));
      };
      rec.onend = () => { recognitionRef.current = null; };
      recognitionRef.current = rec;
      rec.start();
    } catch {}
  };

  const reset = () => {
    setRolls(0); setHistory([]); setBigNum("—"); setThought(""); setSequence("—"); setThoughtLogged(false); setThoughtHistory([]); setSessionTitle("");
    const s = stateRef.current;
    s.idle = true; s.spinning = false; s.settling = false; s.spinTicks = 0; s.settleTicks = 0;
  };

  // Derived group progress for footer summary, respecting group start index and current size
  const currentGroupSizeRender = thoughtAfter;
  const baseIndex = groupStartIndexRef.current;
  const progress = history.length === 0
    ? 0
    : (((Math.max(0, history.length - baseIndex)) % currentGroupSizeRender) || currentGroupSizeRender);

  return (
    <div className="relative flex min-h-screen flex-col">
      <div ref={mountRef} className="relative flex-1 flex items-center justify-center overflow-hidden">
        {/* Background Book UI */}
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none select-none">
          <div className="book-perspective opacity-[0.12] hidden sm:block">
            <div className="book open">
              <div className="page left">
                <div className="page-inner">
                  <div className="folio-title">रामसत जी</div>
                  <div className="page-heading">Sequence</div>
                  <div className="page-seq text-2xl font-black tracking-tight">{sequence}</div>
                </div>
              </div>
              <div className="page right">
                <div className="page-inner">
                  <div className="folio-title">रामसत जी</div>
                  <div className="page-heading">Thought</div>
                  <div className="content whitespace-pre-wrap text-sm max-h-[46vh] overflow-hidden">
                    {thought}
                  </div>
                </div>
              </div>
              <div className="cover" />
            </div>
          </div>
        </div>
        <button
          className="absolute top-3 right-3 z-10 rounded-xl2 border border-white/10 bg-panel px-3 py-2 text-sm"
          onClick={() => setHistOpen(v => !v)}
        >
          History
        </button>
        {/* Background text behind the dice */}
        <div className="absolute top-0 left-0 right-0 z-0 flex items-start justify-center pointer-events-none select-none overflow-hidden pt-4">
          <div className="bg-drift text-[min(18vw,120px)] font-black tracking-tight text-white/80 opacity-10">
            रामसत जी
          </div>
        </div>
        <canvas ref={canvasRef} className="relative z-10 block h-full w-full max-w-full max-h-full" />
        {/* Big number HUD */}
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
          <div
            key={bigNum}
            className="text-[clamp(32px,7vw,84px)] font-extrabold leading-none text-ink drop-shadow [transition:opacity_.25s,transform_.25s] opacity-100"
          >
            {bigNum}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-80">Lang:</span>
          {(['en','hi'] as const).map(l => (
            <button
              key={l}
              className={`rounded-xl2 px-2 py-1 text-sm border ${language===l ? 'bg-primary text-black border-transparent' : 'bg-panel text-ink/90 border-white/10'}`}
              onClick={()=>setLanguage(l)}
            >{l === 'en' ? 'EN' : 'HI'}</button>
          ))}
        </div>

        {/* Thought Overlay */}
        {showOverlay && (
          <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 max-w-[min(720px,86vw)] rounded-xl2 border border-white/10 bg-panel/90 p-3 shadow-hud backdrop-blur-md">
            <div className="text-xs opacity-80">Thought</div>
            {!!sessionTitle && <div className="text-xs opacity-75">Question: {sessionTitle}</div>}
            <div className="font-mono text-sm opacity-85">Sequence: {sequence}</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{thought}</div>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded-xl2 bg-primary px-3 py-2 text-black disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!thought || thought === 'Thinking…' || thought === 'सोच रहा है…'}
                onClick={() => speak(`${language === 'hi' ? 'अनुक्रम' : 'Sequence'} ${sequence}. ${thought}`, language)}
                aria-label="Speak thought"
                title={!thought || thought === 'Thinking…' || thought === 'सोच रहा है…' ? (language === 'hi' ? 'सोच तैयार हो रही है…' : 'Preparing thought…') : (language === 'hi' ? 'विचार सुनें' : 'Speak thought')}
              >🔊 Speak</button>
            </div>
          </div>
        )}

        {/* History Panel */}
        <aside className={`absolute right-0 top-0 h-full w-72 border-l border-white/10 bg-panel/95 transition-transform ${histOpen ? "translate-x-0" : "translate-x-full"}`}>
          <div className="border-b border-white/10 p-3 font-bold">Roll History</div>
          <div className="max-h-full overflow-auto p-2 space-y-2">
            {[...thoughtHistory].map((t,i)=> (
              <div key={`${t.ts}-${i}`} className="border-b border-white/10 pb-2 text-sm">
                <div className="font-semibold">Thought for {t.seq} {t.size ? `(×${t.size})` : ""}</div>
                {t.title && <div className="opacity-80 text-xs">Question: {t.title}</div>}
                <div className="mt-1">{t.text}</div>
                <div className="mt-1 flex items-center gap-2">
                  <button className="rounded-xl2 bg-primary/80 px-2 py-1 text-black" onClick={() => speak(`Sequence ${t.seq}. ${t.text}`, language)}>🔊 Speak</button>
                  <span className="opacity-70 text-xs ml-auto">{t.ts}</span>
                </div>
              </div>
            ))}
            {[...history].slice().reverse().map((item,i)=>{
              const rollNumber = item.roll;
              return (
                <div key={`${rollNumber}-${item.ts}`} className="border-b border-white/10 pb-2 text-sm">
                  <div><strong>Rollfor {item.group} : Roll {item.inGroup}:</strong> {item.n} <span className="opacity-60 text-xs">/ {item.groupSize}</span></div>
                  <div className="opacity-70 text-xs">{item.ts}</div>
                </div>
              );
            })}
            {history.length===0 && <div className="text-sm opacity-70">No rolls yet.</div>}
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="flex min-h-16 flex-wrap items-center gap-3 border-t border-white/10 px-4 py-2">
        <button className="rounded-xl2 bg-primary px-3 py-2 text-black" onClick={()=>performRoll()}>🎲 Roll</button>
        <button className="rounded-xl2 bg-accent px-3 py-2 text-black" onClick={reset}>↻ Reset</button>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-80">Show Thought After:</span>
          {[1,2,3,4].map(n => (
            <button
              key={n}
              className={`rounded-xl2 px-2 py-1 text-sm border ${thoughtAfter===n ? 'bg-primary text-black border-transparent' : 'bg-panel text-ink/90 border-white/10'}`}
              onClick={()=>setThoughtAfter(n)}
            >{n}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 min-w-[200px] flex-1">
          <input
            className="min-w-[200px] flex-1 rounded-xl2 border border-white/10 bg-panel px-2 py-2 text-sm outline-none"
            placeholder="Question / session title (optional)"
            value={sessionTitle}
            onChange={e=>setSessionTitle(e.target.value)}
          />
          <button className="rounded-xl2 bg-panel px-2 py-2 text-sm border border-white/10" onClick={startDictation}>🎤</button>
        </div>
        <span className="ml-auto text-sm opacity-90">
          {`Last: ${history[history.length-1]?.n ?? "—"} | Rolls: ${history.length} | Group: ${progress}/${currentGroupSizeRender} | History: ${history.map(h=>h.n).join(", ")}`}
        </span>
      </footer>
      <style jsx>{`
        @keyframes bg-drift {
          0% { transform: translate(-12%, -6%) rotate(-4deg); }
          50% { transform: translate(12%, 6%) rotate(4deg); }
          100% { transform: translate(-12%, -6%) rotate(-4deg); }
        }
        .bg-drift {
          animation: bg-drift 22s ease-in-out infinite;
          will-change: transform;
          text-shadow: 0 1px 2px rgba(0,0,0,0.08);
        }
        /* Background book styles */
        .book-perspective { perspective: 1000px; transform: scale(0.9); }
        .book { position: relative; width: min(920px, 96vw); height: min(520px, 64vh); transform-style: preserve-3d; }
        .book .cover { position: absolute; inset: 0; background: linear-gradient(145deg, #6b4f3b 0%, #3e2d23 100%); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.2), inset 0 0 0 2px rgba(255,215,0,0.12); transform-origin: left center; transform: rotateY(-2deg) translateZ(2px); }
        .book.open .cover { transform: rotateY(-178deg) translateZ(2px); opacity: 0; }
        .page { position: absolute; top: 0; bottom: 0; width: 50%; padding: 18px; background: radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.7), rgba(245,235,215,0.7) 60%, rgba(240,220,190,0.7)); border: 1px solid rgba(120,80,40,0.25); box-shadow: inset 0 0 60px rgba(0,0,0,0.04); overflow: hidden; }
        .page.left { left: 0; border-right-width: 0; border-top-left-radius: 12px; border-bottom-left-radius: 12px; }
        .page.right { right: 0; border-left-width: 0; border-top-right-radius: 12px; border-bottom-right-radius: 12px; }
        .page .page-inner { position: relative; width: 100%; height: 100%; padding: 18px 22px; color: #2b1d16; font-family: Georgia, "Times New Roman", serif; }
        .folio-title { position: absolute; top: 8px; left: 0; right: 0; text-align: center; font-weight: 900; letter-spacing: 0.06em; color: rgba(60,43,34,0.8); text-transform: uppercase; font-size: 10px; }
        .page-heading { font-weight: 800; letter-spacing: 0.04em; color: #5a3f32; text-transform: uppercase; font-size: 11px; opacity: 0.85; }
        .page-seq { margin-top: 8px; font-size: clamp(18px, 3.6vw, 34px); font-weight: 900; color: #3c2b22; }
        .content { margin-top: 8px; font-size: 13px; line-height: 1.55; }
      `}</style>
    </div>
  );
}
