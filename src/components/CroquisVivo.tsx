"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Site, RunResult, Finding, Agent,
  FLOOR, WALL, EXIT, OBST, SPK, NOISE, DOOR, WIN, STAIR, FURN,
  SNR_MIN, DT, MAXT, simulate, analyze, rectsOf, passable, zoneOf, fmt,
} from "@/lib/engine";
import { PRESETS, PRESET_LABELS, presetHospital } from "@/lib/sites";

type Tool = number | "person" | "erase";
const TOOLS: { k: Tool; n: string; c: string }[] = [
  { k: WALL, n: "Muro", c: "--c-wall" }, { k: DOOR, n: "Puerta", c: "--c-door" },
  { k: WIN, n: "Ventana", c: "--c-win" }, { k: EXIT, n: "Salida", c: "--c-exit" },
  { k: STAIR, n: "Escalera", c: "--c-stair" }, { k: FURN, n: "Mobiliario", c: "--c-furn" },
  { k: OBST, n: "Estorbo", c: "--c-obs" }, { k: SPK, n: "Alarma", c: "--c-spk" },
  { k: NOISE, n: "Ruido", c: "--c-noise" }, { k: "person", n: "Persona", c: "--c-person" },
  { k: FLOOR, n: "Piso libre", c: "--c-room" }, { k: "erase", n: "Borrar", c: "--muted" },
];
const LEGEND: [string, string][] = [
  ["--c-wall", "Muro"], ["--c-door", "Puerta"], ["--c-win", "Ventana"], ["--c-furn", "Mobiliario"],
  ["--c-exit", "Salida"], ["--c-stair", "Escalera"], ["--c-obs", "Estorbo"], ["--c-spk", "Alarma"],
  ["--c-noise", "Ruido"], ["--c-person-wait", "No reacciona"], ["--c-person", "Evacuando"],
  ["--c-person-run", "En fila"],
];
const SPEEDS = [1, 2, 4];
const NAMES_FALLBACK = "Persona";

interface Snapshot { tLast: number; unheard: number; waited: number; never: number; evacuated: number }
type Rects = Record<"furn" | "obst" | "stair" | "exit", [number, number, number, number][]>;

export default function CroquisVivo() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const siteRef = useRef<Site>(presetHospital());
  const runRef = useRef<RunResult | null>(null);
  const rectsRef = useRef<Rects>({ furn: [], obst: [], stair: [], exit: [] });
  const prevRef = useRef<Snapshot | null>(null);
  const fixesRef = useRef<string[]>([]);
  const frameRef = useRef(0);
  const hoverRef = useRef<number | null>(null);
  const paintingRef = useRef(false);
  const dirtyRef = useRef(false);
  const playingRef = useRef(false);

  const clockRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const statRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [findings, setFindings] = useState<Finding[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [tool, setTool] = useState<Tool>(WALL);
  const [tab, setTab] = useState<"h" | "r">("h");
  const [showSound, setShowSound] = useState(false);
  const [sound, setSound] = useState(false);
  const [readout, setReadout] = useState("Pasa el cursor sobre una persona para ver su estado.");
  const [reportTick, setReportTick] = useState(0);
  const [siteKey, setSiteKey] = useState("hospital");

  /* ---------- dibujo ---------- */
  const theme = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const keys = ["paper", "room", "grid", "wall", "door", "win", "stair", "furn", "furn-line",
                  "exit", "obs", "spk", "noise", "inaud", "person", "person-wait", "person-run"];
    const o: Record<string, string> = {};
    for (const k of keys) o[k] = cs.getPropertyValue("--c-" + k).trim();
    o.ink = cs.getPropertyValue("--ink").trim();
    o.muted = cs.getPropertyValue("--muted").trim();
    return o;
  }, []);

  const sizeCanvas = useCallback(() => {
    const cv = cvRef.current; if (!cv || !cv.parentElement) return;
    const s = siteRef.current;
    const w = cv.parentElement.clientWidth || 900;
    const cell = Math.max(6, w / s.cols);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(s.cols * cell * dpr);
    cv.height = Math.round(s.rows * cell * dpr);
    cv.style.width = "100%";
    cv.style.height = s.rows * cell + "px";
    cv.getContext("2d")!.setTransform(dpr * cell, 0, 0, dpr * cell, 0, 0);
  }, []);

  const draw = useCallback(() => {
    const cv = cvRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const s = siteRef.current, run = runRef.current, R = rectsRef.current, T = theme();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cell = cv.width / s.cols / dpr, u = 1 / cell;

    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore();
    ctx.fillStyle = T.paper; ctx.fillRect(0, 0, s.cols, s.rows);
    ctx.fillStyle = T.room;
    for (const z of s.zones) ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = T.grid; ctx.lineWidth = u;
    for (let gx = 0; gx <= s.cols; gx++) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, s.rows); ctx.stroke() }
    for (let gy = 0; gy <= s.rows; gy++) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(s.cols, gy); ctx.stroke() }

    if (showSound && run) {
      ctx.fillStyle = T.inaud;
      for (let q = 0; q < s.cols * s.rows; q++) {
        const tq = s.g[q];
        if (tq === WALL || tq === WIN || tq === FURN) continue;
        if (run.ac.alarm[q] - run.ac.amb[q] < SNR_MIN) ctx.fillRect(q % s.cols, (q / s.cols) | 0, 1, 1);
      }
    }
    ctx.lineWidth = 1.1 * u;
    for (const r of R.furn) {
      ctx.fillStyle = T.furn; ctx.strokeStyle = T["furn-line"];
      ctx.beginPath(); ctx.rect(r[0] + 0.12, r[1] + 0.12, r[2] - 0.24, r[3] - 0.24); ctx.fill(); ctx.stroke();
    }
    for (const r of R.stair) {
      ctx.fillStyle = T.room; ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.strokeStyle = T.stair; ctx.lineWidth = 1.3 * u;
      ctx.strokeRect(r[0] + 0.1, r[1] + 0.1, r[2] - 0.2, r[3] - 0.2);
      const horiz = r[2] >= r[3], n = horiz ? r[2] : r[3];
      for (let k = 1; k < n; k++) {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(r[0] + k, r[1] + 0.15); ctx.lineTo(r[0] + k, r[1] + r[3] - 0.15) }
        else { ctx.moveTo(r[0] + 0.15, r[1] + k); ctx.lineTo(r[0] + r[2] - 0.15, r[1] + k) }
        ctx.stroke();
      }
    }
    for (let i = 0; i < s.cols * s.rows; i++) {
      const t = s.g[i]; if (t !== WALL && t !== WIN) continue;
      const cx = i % s.cols, cy = (i / s.cols) | 0;
      ctx.fillStyle = T.wall; ctx.fillRect(cx, cy, 1, 1);
      if (t === WIN) {
        ctx.strokeStyle = T.win; ctx.lineWidth = 2.4 * u;
        const vert = (cy > 0 && s.g[i - s.cols] === WIN) || (cy < s.rows - 1 && s.g[i + s.cols] === WIN);
        ctx.beginPath();
        if (vert) { ctx.moveTo(cx + 0.5, cy); ctx.lineTo(cx + 0.5, cy + 1) }
        else { ctx.moveTo(cx, cy + 0.5); ctx.lineTo(cx + 1, cy + 0.5) }
        ctx.stroke();
      }
    }
    for (const r of R.exit) {
      ctx.fillStyle = T.exit; ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.strokeStyle = T.paper; ctx.lineWidth = 1.7 * u;
      const horiz = r[2] >= r[3], mx = r[0] + r[2] / 2, my = r[1] + r[3] / 2;
      ctx.beginPath();
      if (horiz) { ctx.moveTo(mx - 0.45, my); ctx.lineTo(mx + 0.45, my); ctx.moveTo(mx + 0.15, my - 0.3); ctx.lineTo(mx + 0.45, my); ctx.lineTo(mx + 0.15, my + 0.3) }
      else { ctx.moveTo(mx, my - 0.45); ctx.lineTo(mx, my + 0.45); ctx.moveTo(mx - 0.3, my + 0.15); ctx.lineTo(mx, my + 0.45); ctx.lineTo(mx + 0.3, my + 0.15) }
      ctx.stroke();
    }
    ctx.strokeStyle = T.door; ctx.lineWidth = 1.6 * u;
    for (let j = 0; j < s.cols * s.rows; j++) {
      if (s.g[j] !== DOOR) continue;
      const dx = j % s.cols, dy = (j / s.cols) | 0;
      const inHoriz = (dx > 0 && s.g[j - 1] === WALL) || (dx < s.cols - 1 && s.g[j + 1] === WALL);
      ctx.beginPath();
      if (inHoriz) {
        ctx.moveTo(dx, dy + 0.5); ctx.lineTo(dx + 1, dy + 0.5);
        ctx.moveTo(dx, dy + 0.5); ctx.lineTo(dx + 0.17, dy - 0.28);
        ctx.arc(dx, dy + 0.5, 0.8, -1.35, 0);
      } else {
        ctx.moveTo(dx + 0.5, dy); ctx.lineTo(dx + 0.5, dy + 1);
        ctx.moveTo(dx + 0.5, dy); ctx.lineTo(dx + 1.28, dy + 0.17);
        ctx.arc(dx + 0.5, dy, 0.8, 0.22, 1.57);
      }
      ctx.stroke();
    }
    for (const r of R.obst) {
      ctx.fillStyle = T.obs; ctx.globalAlpha = 0.8;
      ctx.fillRect(r[0] + 0.1, r[1] + 0.1, r[2] - 0.2, r[3] - 0.2); ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.5 * u;
      ctx.save(); ctx.beginPath(); ctx.rect(r[0] + 0.1, r[1] + 0.1, r[2] - 0.2, r[3] - 0.2); ctx.clip();
      for (let d = -r[3]; d < r[2] + r[3]; d += 0.55) {
        ctx.beginPath(); ctx.moveTo(r[0] + d, r[1]); ctx.lineTo(r[0] + d + r[3], r[1] + r[3]); ctx.stroke();
      }
      ctx.restore();
    }
    for (let m = 0; m < s.cols * s.rows; m++) {
      const tm = s.g[m]; if (tm !== SPK && tm !== NOISE) continue;
      const mx = m % s.cols, my = (m / s.cols) | 0, col = tm === SPK ? T.spk : T.noise;
      ctx.fillStyle = col; ctx.fillRect(mx + 0.26, my + 0.26, 0.48, 0.48);
      ctx.strokeStyle = col; ctx.lineWidth = 1.4 * u; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(mx + 0.5, my + 0.5, 0.7, -0.85, 0.85); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx + 0.5, my + 0.5, 0.7, Math.PI - 0.85, Math.PI + 0.85); ctx.stroke();
      if (tm === SPK && playingRef.current && run) {
        const ph = (run.frames[Math.min(frameRef.current, run.frames.length - 1)].t % 1.6) / 1.6;
        ctx.globalAlpha = (1 - ph) * 0.5;
        ctx.beginPath(); ctx.arc(mx + 0.5, my + 0.5, 0.7 + ph * 3.2, 0, 6.284); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (run) {
      const f = run.frames[Math.min(frameRef.current, run.frames.length - 1)];
      const atEnd = frameRef.current >= run.frames.length - 1;
      for (let k = 0; k < run.agents.length; k++) {
        if (f.s[k] === 2) continue;
        const st = f.s[k];
        ctx.fillStyle = st === 0 ? T["person-wait"] : st === 3 ? T["person-run"] : T.person;
        ctx.beginPath(); ctx.arc(f.x[k], f.y[k], 0.34, 0, 6.284); ctx.fill();
        ctx.strokeStyle = T.paper; ctx.lineWidth = 1.4 * u; ctx.stroke();
        // al cerrar el simulacro, quien sigue dentro se marca sobre el plano:
        // la respuesta tiene que estar donde está el ojo, no en el panel de al lado.
        if (atEnd && run.agents[k].state !== 2) {
          ctx.strokeStyle = T.obs; ctx.lineWidth = 2.4 * u;
          ctx.beginPath(); ctx.arc(f.x[k], f.y[k], 0.78, 0, 6.284); ctx.stroke();
          ctx.beginPath(); ctx.arc(f.x[k], f.y[k], 1.15, 0, 6.284); ctx.globalAlpha = 0.45; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (hoverRef.current === k) {
          ctx.strokeStyle = T.ink; ctx.lineWidth = 2.2 * u;
          ctx.beginPath(); ctx.arc(f.x[k], f.y[k], 0.62, 0, 6.284); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = T.muted;
    ctx.font = "600 .66px Archivo,system-ui,sans-serif";
    ctx.textBaseline = "top";
    for (const z of s.zones) {
      if (ctx.measureText(z.name).width <= z.w - 0.5) ctx.fillText(z.name, z.x + 0.35, z.y + 0.25);
    }
  }, [showSound, theme]);

  /* ---------- panel de datos en vivo (DOM directo: se actualiza a 60 fps) ---------- */
  const paintStats = useCallback(() => {
    const run = runRef.current;
    const f = run ? run.frames[Math.min(frameRef.current, run.frames.length - 1)] : null;
    let waiting = 0, queued = 0;
    if (f) for (let i = 0; i < f.s.length; i++) { if (f.s[i] === 0) waiting++; else if (f.s[i] === 3) queued++ }
    const vals = [
      f ? fmt(f.t) : "00:00",
      `${f ? f.out : 0}|${run ? run.agents.length : 0}`,
      String(waiting), String(queued), String(run ? run.unheard : 0),
    ];
    statRefs.current.forEach((el, i) => {
      if (!el) return;
      if (i === 1) { const [a, b] = vals[1].split("|"); el.innerHTML = `${a}<small>/${b}</small>` }
      else el.textContent = vals[i];
    });
    if (clockRef.current) clockRef.current.textContent = f ? fmt(f.t) : "00:00";
    if (badgeRef.current) badgeRef.current.classList.toggle("on", !!f && f.t > 0);
    if (scrubRef.current && run) {
      scrubRef.current.max = String(run.frames.length - 1);
      scrubRef.current.value = String(frameRef.current);
    }
  }, []);

  const recompute = useCallback((keepPrev: boolean) => {
    const s = siteRef.current, prevRun = runRef.current;
    if (keepPrev && prevRun) {
      prevRef.current = {
        tLast: prevRun.tLast, unheard: prevRun.unheard, waited: prevRun.waited,
        never: prevRun.never, evacuated: prevRun.evacuated,
      };
    }
    rectsRef.current = {
      furn: rectsOf(s, FURN), obst: rectsOf(s, OBST),
      stair: rectsOf(s, STAIR), exit: rectsOf(s, EXIT),
    };
    const r = simulate(s, 2026);
    runRef.current = r;
    setFindings(analyze(s, r));
    frameRef.current = 0;
    playingRef.current = false;
    setPlaying(false);
    setReportTick((t) => t + 1);
    paintStats();
    draw();
  }, [draw, paintStats]);

  /* ---------- arranque ---------- */
  useEffect(() => {
    sizeCanvas();
    recompute(false);
    const onResize = () => { sizeCanvas(); draw() };
    window.addEventListener("resize", onResize);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => draw();
    mq.addEventListener("change", onTheme);
    return () => { window.removeEventListener("resize", onResize); mq.removeEventListener("change", onTheme) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { draw() }, [showSound, draw]);

  /* ---------- reloj de reproducción ---------- */
  useEffect(() => {
    let raf = 0, last = 0, acc = 0;
    const loop = (ts: number) => {
      if (!last) last = ts;
      const dt = Math.min(0.25, (ts - last) / 1000);
      last = ts;
      const run = runRef.current;
      if (playingRef.current && run) {
        acc += dt * SPEEDS[speedIdx];
        while (acc >= DT) {
          acc -= DT;
          frameRef.current++;
          if (frameRef.current >= run.frames.length - 1) {
            frameRef.current = run.frames.length - 1;
            playingRef.current = false;
            setPlaying(false);
            break;
          }
        }
        paintStats();
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speedIdx, draw, paintStats]);

  /* ---------- alarma audible ---------- */
  const audioRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; lfo: OscillatorNode } | null>(null);
  useEffect(() => {
    const on = playing && sound;
    if (on && !audioRef.current) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = "square"; osc.frequency.value = 880; g.gain.value = 0.03;
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 2.2; lg.gain.value = 260;
        lfo.connect(lg); lg.connect(osc.frequency); lfo.start();
        osc.connect(g); g.connect(ctx.destination); osc.start();
        audioRef.current = { ctx, osc, lfo };
      } catch { audioRef.current = null }
    } else if (!on && audioRef.current) {
      try { audioRef.current.osc.stop(); audioRef.current.lfo.stop(); audioRef.current.ctx.close() } catch {}
      audioRef.current = null;
    }
  }, [playing, sound]);

  /* ---------- edición del croquis ---------- */
  const cellFrom = (e: React.PointerEvent) => {
    const cv = cvRef.current!, s = siteRef.current, r = cv.getBoundingClientRect();
    return [
      Math.max(0, Math.min(s.cols - 1, Math.floor(((e.clientX - r.left) / r.width) * s.cols))),
      Math.max(0, Math.min(s.rows - 1, Math.floor(((e.clientY - r.top) / r.height) * s.rows))),
    ] as [number, number];
  };
  const paintAt = (e: React.PointerEvent) => {
    const s = siteRef.current, [x, y] = cellFrom(e), i = y * s.cols + x;
    if (tool === "person") {
      if (!passable(s, i, false)) return;
      const z = zoneOf(s, x, y);
      s.people.push({ x: x + 0.5, y: y + 0.5, name: `${NAMES_FALLBACK} ${s.people.length + 1}`, role: "persona", zone: z ? z.name : "Sin zona" });
    } else if (tool === "erase") {
      s.g[i] = FLOOR;
      s.people = s.people.filter((p) => Math.floor(p.x) !== x || Math.floor(p.y) !== y);
    } else s.g[i] = tool as number;
    dirtyRef.current = true;
    rectsRef.current = {
      furn: rectsOf(s, FURN), obst: rectsOf(s, OBST),
      stair: rectsOf(s, STAIR), exit: rectsOf(s, EXIT),
    };
    draw();
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    cvRef.current?.setPointerCapture(e.pointerId);
    paintingRef.current = true;
    paintAt(e);
  };
  const onPointerUp = () => {
    const d = dirtyRef.current;
    paintingRef.current = false;
    dirtyRef.current = false;
    if (d) { prevRef.current = null; fixesRef.current = []; recompute(false) }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (paintingRef.current) { paintAt(e); return }
    const run = runRef.current, cv = cvRef.current, s = siteRef.current;
    if (!run || !cv) return;
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * s.cols, my = ((e.clientY - r.top) / r.height) * s.rows;
    const f = run.frames[Math.min(frameRef.current, run.frames.length - 1)];
    let best: number | null = null, bd = 1;
    for (let i = 0; i < run.agents.length; i++) {
      if (f.s[i] === 2) continue;
      const d = Math.hypot(f.x[i] - mx, f.y[i] - my);
      if (d < bd) { bd = d; best = i }
    }
    if (best !== hoverRef.current) { hoverRef.current = best; draw() }
    if (best === null) { setReadout("Pasa el cursor sobre una persona para ver su estado."); return }
    const a: Agent = run.agents[best], st = f.s[best];
    const estado = st === 0
      ? a.heard ? "todavía está reaccionando"
        : `no escuchó la alerta: ${a.alarmDb.toFixed(0)} dB contra ${a.ambDb.toFixed(0)} dB de ruido`
      : st === 3 ? "frenada por aglomeración" : "evacuando";
    setReadout(`${a.name} · ${a.zone} (${a.role}) · ${estado}${a.via && st !== 0 ? ` · la avisó ${a.via}` : ""}`);
  };

  const onBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        const cv = cvRef.current, ctx = cv?.getContext("2d");
        if (!ctx) return;
        draw();
        ctx.globalAlpha = 0.32;
        ctx.drawImage(im, 0, 0, siteRef.current.cols, siteRef.current.rows);
        ctx.globalAlpha = 1;
      };
      im.src = rd.result as string;
    };
    rd.readAsDataURL(file);
  };

  const applyFix = (f: Finding) => {
    if (!f.fix) return;
    fixesRef.current.push(f.fix.label);
    f.fix.apply(siteRef.current);
    recompute(true);
    setTab("r");
  };

  const run = runRef.current;
  const prev = prevRef.current;

  return (
    <div className="pad">
      <div className="sheet"><div className="inner">

        <header className="titlebar">
          <div className="tname">
            <h1>Croquis Vivo</h1>
            <p>Dibuja tu croquis, suena la alarma, y el sistema te dice qué falló.</p>
          </div>
          <div className="blockgrid">
            <div className="bcell"><span className="lbl">Plano</span><b>PC&#8209;01</b></div>
            <div className="bcell"><span className="lbl">Escala</span><b>1 celda = 1 m</b></div>
            <div className="bcell"><span className="lbl">Criterio</span><b>NFPA 72 · +15 dB</b></div>
          </div>
          <div className="stamps">
            <span className="stamp sim">Simulación<br />por agentes</span>
            <span className="stamp legal">No es<br />certificación legal</span>
          </div>
        </header>

        <div className="layout">
          <aside className="col left">
            <h2 className="sec">Sitio</h2>
            <div className="fieldset">
              <label className="lbl" htmlFor="sitio">Cambia de escenario aquí</label>
              <select
                id="sitio" aria-label="Sitio" value={siteKey}
                onChange={(e) => {
                  setSiteKey(e.target.value);
                  siteRef.current = PRESETS[e.target.value]();
                  prevRef.current = null; fixesRef.current = [];
                  sizeCanvas(); recompute(false);
                }}
              >
                {PRESET_LABELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <h2 className="sec">Simbología</h2>
            <div className="leg">
              {TOOLS.map((t) => (
                <button
                  key={String(t.k)} type="button" className="tool"
                  aria-pressed={t.k === tool} onClick={() => setTool(t.k)}
                >
                  <span className="sw" style={{ background: `var(${t.c})` }} />{t.n}
                </button>
              ))}
            </div>
            <div className="fieldset" style={{ marginTop: 14 }}>
              <label className="lbl" htmlFor="bgfile">Calcar mi croquis</label>
              <input type="file" id="bgfile" accept="image/*" onChange={onBg} />
            </div>
            <p className="hint">
              Sube la foto del croquis de tu escuela o negocio y dibújalo encima. Arrastra para pintar;
              el simulacro se vuelve a correr solo al soltar.
            </p>
          </aside>

          <section className="col mid stage">
            <div className="canvas-wrap">
              <canvas
                ref={cvRef} id="cv" width={1040} height={640}
                aria-label="Croquis con simulación de evacuación"
                onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerMove={onPointerMove}
                onPointerLeave={() => { if (hoverRef.current !== null) { hoverRef.current = null; draw() } }}
              />
              <div className="overlay-badge" ref={badgeRef}>
                <span className="bars" /><span className="txt"><span className="dot" />Alarma activa</span>
              </div>
              <div className="clock" ref={clockRef}>00:00</div>
            </div>

            <div className="transport">
              <button
                className="btn primary"
                onClick={() => {
                  const r = runRef.current; if (!r) return;
                  if (frameRef.current >= r.frames.length - 1) frameRef.current = 0;
                  playingRef.current = !playingRef.current;
                  setPlaying(playingRef.current);
                }}
              >
                {playing ? "▮▮  Pausa"
                  : frameRef.current > 0
                    ? (run && frameRef.current >= run.frames.length - 1 ? "▶  Repetir" : "▶  Continuar")
                    : "▶  Activar alarma"}
              </button>
              <button className="btn" onClick={() => {
                frameRef.current = 0; playingRef.current = false; setPlaying(false); paintStats(); draw();
              }}>Reiniciar</button>
              <div className="scrubwrap">
                <input
                  ref={scrubRef} type="range" className="scrub" min={0} max={100} defaultValue={0} step={1}
                  aria-label="Línea de tiempo del simulacro"
                  onInput={(e) => {
                    frameRef.current = +(e.target as HTMLInputElement).value;
                    playingRef.current = false; setPlaying(false); paintStats(); draw();
                  }}
                />
              </div>
              <button className="btn" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
                {SPEEDS[speedIdx]}×
              </button>
              <label className="toggle">
                <input type="checkbox" checked={showSound} onChange={(e) => setShowSound(e.target.checked)} /> Cobertura
              </label>
              <label className="toggle">
                <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sonido
              </label>
            </div>

            <div className="stats">
              {["Tiempo", "Evacuadas", "Aún no reaccionan", "Atoradas en fila", "No oyen la alarma"].map((k, i) => (
                <div className="stat" key={k}>
                  <div className="k">{k}</div>
                  <div className="v" ref={(el) => { statRefs.current[i] = el }}>—</div>
                </div>
              ))}
            </div>
            <div className="readout">{readout}</div>
            <div className="legend">
              {LEGEND.map(([v, n]) => (
                <span key={n}><i style={{ background: `var(${v})` }} />{n}</span>
              ))}
            </div>
          </section>

          <aside className="col">
            <div className="tabs" role="tablist">
              <button className="tab" role="tab" aria-selected={tab === "h"} onClick={() => setTab("h")}>Hallazgos</button>
              <button className="tab" role="tab" aria-selected={tab === "r"} onClick={() => setTab("r")}>Reporte</button>
            </div>

            <div className="tabbody" role="tabpanel" hidden={tab !== "h"}>
              {findings.length === 0 ? (
                <p className="empty">Sin hallazgos en este croquis.</p>
              ) : (
                <>
                  <div className="runhead">
                    <span className="lbl">Simulacro calculado</span>
                    <b>{siteRef.current.name}</b>
                    <span>
                      {run ? `${run.agents.length} personas · ${run.evacuated} evacuadas · última salida ${fmt(run.tLast)}` : ""}
                    </span>
                  </div>
                  <p className="lead">
                    Estos {findings.length} hallazgos son de este croquis y ya están calculados: el botón
                    <b> Activar alarma</b> reproduce lo que pasó, no lo vuelve a calcular. Si cambias el croquis o
                    aplicas una corrección, el simulacro se recalcula y estos hallazgos cambian.
                  </p>
                  {findings.map((f, i) => (
                    <div className={"finding " + f.sev} key={f.title + i}>
                      <div className="fhead">
                        <span className="fid">H-{String(i + 1).padStart(2, "0")}</span>
                        <span className={"sev " + f.sev}>{f.sev}</span>
                      </div>
                      <h3>{f.title}</h3>
                      <p>{f.detail}</p>
                      <div className="ev">
                        {f.ev.map((e, k) => <span key={k}><b>{e[0]}</b> {e[1]}</span>)}
                      </div>
                      {f.fix && <button className="btn fix" onClick={() => applyFix(f)}>{f.fix.label}</button>}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="tabbody" role="tabpanel" hidden={tab !== "r"}>
              <Report run={run} prev={prev} siteName={siteRef.current.name} fixes={fixesRef.current} tick={reportTick} />
            </div>
          </aside>
        </div>

        <p className="foot">
          <b>Cómo funciona el motor.</b> Simulación por agentes sobre el croquis: cada persona busca la salida o
          escalera más cercana con un campo de flujo, rodea muros y mobiliario, pierde velocidad cuando se
          aglomera y sólo arranca si la alerta es audible donde está; si no la oye, puede salir tarde porque
          alguien le avisa. El sonido se atenúa por distancia y por cada barrera que cruza —muro, puerta cerrada
          o ventana pierden distinto— y se considera audible cuando supera el ruido de fondo por 15 dB, el
          criterio de la NFPA 72. Los hallazgos salen de un análisis contrafactual: el simulacro se vuelve a
          calcular quitando cada estorbo o añadiendo cobertura, y se compara contra el original. No interviene
          ningún modelo de lenguaje. Personal, escuelas y hospitales inventados para la demostración.
        </p>

      </div></div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return <div className="delta"><span>{k}</span><b>{v}</b></div>;
}
function Delta({ k, before, after, time }: { k: string; before: number; after: number; time?: boolean }) {
  const cls = after === before ? "" : after < before ? "up" : "down";
  return (
    <div className="delta">
      <span>{k}</span>
      <b>{time ? fmt(before) : before} → <span className={cls}>{time ? fmt(after) : after}</span></b>
    </div>
  );
}
function Report({ run, prev, siteName, fixes }: {
  run: RunResult | null; prev: Snapshot | null; siteName: string; fixes: string[]; tick: number;
}) {
  if (!run) return null;
  const a = [...run.agents].sort((p, q) => (q.wait - p.wait) || ((p.tOut ?? 999) - (q.tOut ?? 999)));
  return (
    <>
      <div className="rep-h">Evidencia del simulacro</div>
      <div style={{ fontSize: "12.5px", color: "var(--ink-2)", marginBottom: 2 }}>{siteName}</div>
      <p className="scope">
        <b>Lo que estos números sí son:</b> el resultado medido del simulacro sobre este croquis —tiempos,
        conteos y decibeles salen del cálculo. <b>Lo que no son:</b> la certificación, que sólo emite
        Protección Civil. Los nombres del personal son inventados; las mediciones no.
      </p>
      <div className="rep-h">Cobertura · medida en este simulacro</div>
      <Row k="Personas en el inmueble" v={run.agents.length} />
      <Row k="Evacuadas" v={run.evacuated} />
      <Row k="Sin evacuar al cierre" v={run.never} />
      <Row k="No escucharon la alerta" v={run.unheard} />
      <Row k="Más de 10 s frenadas en fila" v={run.waited} />
      {run.viaStairs > 0 && <Row k="Salieron por escalera" v={run.viaStairs} />}
      <div className="rep-h">Tiempos</div>
      <Row k="90% del personal fuera" v={fmt(run.t90)} />
      <Row k="Última persona fuera" v={fmt(run.tLast)} />
      {prev && (
        <>
          <div className="rep-h">Antes y después de la corrección</div>
          <Delta k="Última persona fuera" before={prev.tLast} after={run.tLast} time />
          <Delta k="No escucharon la alerta" before={prev.unheard} after={run.unheard} />
          <Delta k="Frenadas en fila" before={prev.waited} after={run.waited} />
          <Delta k="Sin evacuar" before={prev.never} after={run.never} />
          <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "8px 0 0" }}>
            Correcciones aplicadas: {fixes.join(" · ")}
          </p>
        </>
      )}
      <div className="rep-h">Personas · nombres inventados, mediciones reales</div>
      <div className="tscroll">
        <table>
          <tbody>
            <tr><th>Nombre</th><th>Zona</th><th>Oyó</th><th>Salió</th><th>Fila</th></tr>
            {a.slice(0, 14).map((p) => (
              <tr key={p.i}>
                <td>{p.name}</td><td>{p.zone}</td>
                <td>{p.heard ? "sí" : <b style={{ color: "var(--red)" }}>no</b>}</td>
                <td className="n">{p.tOut ? fmt(p.tOut) : "—"}</td>
                <td className="n">{p.wait > 0 ? p.wait.toFixed(0) + "s" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.length > 14 && (
        <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "6px 0 0" }}>
          {a.length - 14} registros más en el reporte completo.
        </p>
      )}
      <p className="note">
        Este reporte documenta evidencia de capacitación: cobertura, decisiones, tiempos, brechas y acciones de
        mejora. No sustituye ni suple la validación de la autoridad de Protección Civil, y no constituye una
        certificación legal.
      </p>
    </>
  );
}
