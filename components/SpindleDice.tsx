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
    function makeSpindleGeometry(height=2.2, radius=0.55, power=1.6, radialSegments=180, heightSegments=160){
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

    const geo = makeSpindleGeometry();
    geo.center();
    const diceMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("oklch(85% 0.04 75)"), roughness: 0.4, metalness: 0.1 } as any);
    const diceObj = new THREE.Mesh(geo, diceMat);
    scene.add(diceObj);

    const edges = new THREE.EdgesGeometry(geo, 25);
    const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe5edff, opacity:0.22, transparent:true }));
    scene.add(edgeLines);

    // Pips
    function makeDots(num: number, angle: number){
      const group = new THREE.Group();
      const dotGeo = new THREE.SphereGeometry(0.05, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("oklch(40% 0.12 48)") } as any);
      const radius = 0.65;
      for(let i=0;i<num;i++){
        const a = angle + (i - (num-1)/2) * 0.15;
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.set(Math.cos(a)*radius, 0, Math.sin(a)*radius);
        group.add(dot);
      }
      return group;
    }
    const dotsGroups = [1,2,3,4].map((n, i)=>{ const g = makeDots(n, angs[i]); scene.add(g); return g; });

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
        const inGroupLocal = (m % thoughtAfter) + 1;
        const groupLocal = Math.floor(m / thoughtAfter) + 1;
        const item: RollItem = { n, ts, roll: r + 1, group: groupLocal, inGroup: inGroupLocal, groupSize: thoughtAfter };
        const next = [...h, item];
        const meetsThreshold = inGroupLocal === thoughtAfter;
        if (meetsThreshold) {
          const lastK = next.slice(-thoughtAfter);
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
            setThoughtHistory(prev => [{ seq: human, text, ts, title: sessionTitle || undefined, size: thoughtAfter }, ...prev]);
          }).catch(() => {
            const text = thoughtForSequence(seqStr);
            setThought(text);
            setThoughtHistory(prev => [{ seq: human, text, ts, title: sessionTitle || undefined, size: thoughtAfter }, ...prev]);
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
    // When threshold changes, start a new group from next roll by clearing any pending overlay
    setThoughtLogged(false);
    setShowOverlay(false);
  }, [thoughtAfter]);

  // Voice: speak helper
  const speak = (text: string, lang?: "en"|"hi") => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === "hi" ? "hi-IN" : "en-US";
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

  return (
    <div className="relative flex min-h-screen flex-col">
      <div ref={mountRef} className="relative flex-1 flex items-center justify-center overflow-hidden">
        <button
          className="absolute top-3 right-3 z-10 rounded-xl2 border border-white/10 bg-panel px-3 py-2 text-sm"
          onClick={() => setHistOpen(v => !v)}
        >
          History
        </button>
        <canvas ref={canvasRef} className="block h-full w-full max-w-full max-h-full" />
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
            <div className="mt-1 text-sm">{thought}</div>
            <div className="mt-2 flex gap-2">
              <button className="rounded-xl2 bg-primary px-3 py-2 text-black" onClick={() => speak(`Sequence ${sequence}. ${thought}`, language)}>🔊 Speak</button>
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
          {`Last: ${history[history.length-1]?.n ?? "—"} | Rolls: ${history.length} | Group: ${history.length===0 ? 0 : ((history.length % thoughtAfter) || thoughtAfter)}/${thoughtAfter} | History: ${history.map(h=>h.n).join(", ")}`}
        </span>
      </footer>
    </div>
  );
}
