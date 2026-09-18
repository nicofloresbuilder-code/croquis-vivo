/**
 * Croquis Vivo — motor de simulacro.
 *
 * Sin DOM y sin dependencias: se puede ejecutar en el navegador o en una prueba.
 * El croquis es una retícula de celdas de 1 m; sobre ella corren tres cosas:
 * acústica (quién oye la alerta), rutas (campo de flujo hacia salidas y
 * escaleras) y agentes (personas que reaccionan, caminan y se aglomeran).
 */

export const FLOOR = 0, WALL = 1, EXIT = 2, OBST = 3, SPK = 4,
             NOISE = 5, DOOR = 6, WIN = 7, STAIR = 8, FURN = 9;
export type CellType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const M_PER_CELL = 1.0;
export const ALARM_SPL = 103;   // dB(A) a 1 m del sonorizador
export const NOISE_SPL = 85;    // dB(A) a 1 m de la máquina
export const BASE_AMBIENT = 45; // ruido de fondo del inmueble
export const SNR_MIN = 15;      // NFPA 72: la alerta debe superar el ruido por 15 dB
export const SPEED = 1.25;      // m/s a paso libre
export const DT = 0.2;
export const MAXT = 300;

/** dB que pierde el sonido al cruzar cada tipo de barrera. */
const ATT: Record<number, number> = { [WALL]: 10, [WIN]: 5, [DOOR]: 4, [OBST]: 2, [FURN]: 1 };

export interface Zone { name: string; x: number; y: number; w: number; h: number }
export interface Person { x: number; y: number; name: string; role: string; zone: string }
export interface Site {
  name: string; cols: number; rows: number;
  g: Uint8Array; zones: Zone[]; people: Person[];
}
export interface Agent {
  i: number; name: string; role: string; zone: string;
  x: number; y: number; sx: number; sy: number;
  heard: boolean; alarmDb: number; ambDb: number;
  tStart: number | null; via: string | null;
  state: 0 | 1 | 2; tOut: number | null; wait: number;
  exit: number | null; exitKind: "salida" | "escalera" | null; slow: boolean;
}
export interface Frame { t: number; x: Float32Array; y: Float32Array; s: Uint8Array; out: number }
export interface Acoustics { alarm: Float32Array; amb: Float32Array; spk: number[][]; noise: number[][] }
export interface RunResult {
  agents: Agent[]; frames: Frame[]; ac: Acoustics; dist: Float64Array;
  evacuated: number; never: number; t90: number; tLast: number;
  exits: Record<number, number>; waited: number; unheard: number; viaStairs: number;
}
export type Severity = "alta" | "media" | "baja";
export interface Finding {
  sev: Severity; title: string; detail: string;
  ev: [string | number, string][];
  fix: { label: string; apply: (s: Site) => void } | null;
}

/* ---------- utilidades ---------- */
export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

class MinHeap {
  private a: [number, number][] = [];
  push(p: number, v: number) {
    const a = this.a; let i = a.length; a.push([p, v]);
    while (i > 0) { const par = (i - 1) >> 1; if (a[par][0] <= a[i][0]) break; [a[par], a[i]] = [a[i], a[par]]; i = par; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop() as [number, number];
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  size() { return this.a.length }
}

/* ---------- acústica ---------- */
/**
 * Atenuación total en el trayecto. Cuenta CRUCES de barrera, no celdas: un muro
 * contiguo atravesado vale una vez, sin importar cuántas de sus celdas toque la
 * línea. Sin esto, una trayectoria casi paralela a una pared cuenta seis muros.
 */
export function attOnLine(s: Site, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, total = 0, inB = false, guard = 0;
  while (guard++ < 500) {
    const a = (x0 === x1 && y0 === y1) ? 0 : (ATT[s.g[y0 * s.cols + x0]] || 0);
    if (a > 0) { if (!inB) { total += a; inB = true } } else inB = false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx) { err += dx; y0 += sy }
  }
  return total;
}
function level(s: Site, sx: number, sy: number, x: number, y: number, spl: number) {
  const d = Math.max(1, Math.hypot(x - sx, y - sy) * M_PER_CELL);
  return spl - 20 * Math.log10(d) - attOnLine(s, sx, sy, x, y);
}
export function acoustics(s: Site): Acoustics {
  const N = s.cols * s.rows;
  const alarm = new Float32Array(N), amb = new Float32Array(N);
  const spk: number[][] = [], noise: number[][] = [];
  for (let i = 0; i < N; i++) {
    if (s.g[i] === SPK) spk.push([i % s.cols, (i / s.cols) | 0]);
    if (s.g[i] === NOISE) noise.push([i % s.cols, (i / s.cols) | 0]);
  }
  for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
    const j = y * s.cols + x;
    let a = -20, n = BASE_AMBIENT;
    for (const p of spk) a = Math.max(a, level(s, p[0], p[1], x, y, ALARM_SPL));
    for (const p of noise) n = Math.max(n, level(s, p[0], p[1], x, y, NOISE_SPL));
    alarm[j] = a; amb[j] = n;
  }
  return { alarm, amb, spk, noise };
}

/* ---------- rutas ---------- */
export function passable(s: Site, i: number, ignoreObst: boolean) {
  const t = s.g[i];
  if (t === WALL || t === WIN || t === FURN) return false;
  if (t === OBST) return ignoreObst;
  return true;
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
/**
 * Campo de flujo hacia cualquier salida o escalera.
 * Float64 a propósito: con Float32 el valor guardado se redondea y al sacar el
 * nodo del heap la comparación d > dist[c] lo descarta, cortando la propagación.
 */
export function flowField(s: Site, ignoreObst: boolean): Float64Array {
  const N = s.cols * s.rows, dist = new Float64Array(N), h = new MinHeap();
  for (let i = 0; i < N; i++) dist[i] = Infinity;
  for (let i = 0; i < N; i++) if (s.g[i] === EXIT || s.g[i] === STAIR) { dist[i] = 0; h.push(0, i) }
  while (h.size()) {
    const [d, c] = h.pop();
    if (d > dist[c]) continue;
    const cx = c % s.cols, cy = (c / s.cols) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) continue;
      const ni = ny * s.cols + nx;
      if (!passable(s, ni, ignoreObst)) continue;
      if (k > 3 && (!passable(s, cy * s.cols + nx, ignoreObst) || !passable(s, ny * s.cols + cx, ignoreObst))) continue;
      const nd = d + (k > 3 ? 1.4142 : 1) + (s.g[ni] === DOOR ? 0.7 : 0);
      if (nd < dist[ni]) { dist[ni] = nd; h.push(nd, ni) }
    }
  }
  return dist;
}
function stepDir(s: Site, dist: Float64Array, cx: number, cy: number): [number, number] {
  let best = dist[cy * s.cols + cx], bx = 0, by = 0;
  for (let k = 0; k < 8; k++) {
    const nx = cx + DX[k], ny = cy + DY[k];
    if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) continue;
    const ni = ny * s.cols + nx;
    if (!passable(s, ni, false)) continue;
    if (k > 3 && (!passable(s, cy * s.cols + nx, false) || !passable(s, ny * s.cols + cx, false))) continue;
    if (dist[ni] < best) { best = dist[ni]; bx = DX[k]; by = DY[k] }
  }
  const m = Math.hypot(bx, by) || 1;
  return [bx / m, by / m];
}

/* ---------- simulación ---------- */
export function simulate(s: Site, seed = 2026): RunResult {
  const rnd = mulberry32(seed), ac = acoustics(s), dist = flowField(s, false);
  const agents: Agent[] = s.people.map((p, i) => {
    const ci = Math.floor(p.y) * s.cols + Math.floor(p.x);
    const heard = ac.alarm[ci] - ac.amb[ci] >= SNR_MIN;
    return {
      i, name: p.name, role: p.role, zone: p.zone,
      x: p.x, y: p.y, sx: p.x, sy: p.y,
      heard, alarmDb: ac.alarm[ci], ambDb: ac.amb[ci],
      tStart: heard ? 3 + rnd() * 7 : null, via: heard ? "la alarma" : null,
      state: 0, tOut: null, wait: 0, exit: null, exitKind: null, slow: false,
    };
  });
  const frames: Frame[] = [];
  let t = 0, out = 0;
  const snap = () => {
    const n = agents.length;
    const xs = new Float32Array(n), ys = new Float32Array(n), st = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = agents[i].x; ys[i] = agents[i].y;
      st[i] = agents[i].state === 1 ? (agents[i].slow ? 3 : 1) : agents[i].state;
    }
    frames.push({ t, x: xs, y: ys, s: st, out });
  };
  snap();
  while (t < MAXT && out < agents.length) {
    t += DT;
    const moving = agents.filter((a) => a.state === 1);
    for (const a of agents) {
      if (a.state === 2) continue;
      if (a.tStart === null) {
        for (const m of moving) {
          if (Math.hypot(m.x - a.x, m.y - a.y) <= 4) { a.tStart = t + 5 + rnd() * 7; a.via = "el aviso de un compañero"; break }
        }
      }
      if (a.state === 0) { if (a.tStart !== null && t >= a.tStart) a.state = 1; else continue }
      const cx = Math.floor(a.x), cy = Math.floor(a.y), ci = cy * s.cols + cx, g = s.g[ci];
      if (g === EXIT || g === STAIR) {
        a.state = 2; a.tOut = t; a.exit = ci;
        a.exitKind = g === STAIR ? "escalera" : "salida"; out++; continue;
      }
      let near = 0;
      for (const b of agents) if (b !== a && b.state === 1 && Math.hypot(b.x - a.x, b.y - a.y) < 1.3) near++;
      let f = near >= 3 ? 0.25 : near === 2 ? 0.5 : near === 1 ? 0.8 : 1;
      if (g === DOOR && near >= 1) f *= 0.7;
      a.slow = f < 0.7;
      if (a.slow) a.wait += DT;
      const d = stepDir(s, dist, cx, cy), step = (SPEED * f * DT) / M_PER_CELL;
      if (d[0] === 0 && d[1] === 0) continue;
      const nx = a.x + d[0] * step, ny = a.y + d[1] * step;
      if (passable(s, cy * s.cols + Math.max(0, Math.min(s.cols - 1, Math.floor(nx))), false)) a.x = nx;
      if (passable(s, Math.max(0, Math.min(s.rows - 1, Math.floor(ny))) * s.cols + Math.floor(a.x), false)) a.y = ny;
    }
    if (frames.length < 1600) snap();
  }
  const evac = agents.filter((a) => a.state === 2);
  const times = evac.map((a) => a.tOut as number).sort((p, q) => p - q);
  const exits: Record<number, number> = {};
  for (const a of evac) exits[a.exit as number] = (exits[a.exit as number] || 0) + 1;
  return {
    agents, frames, ac, dist,
    evacuated: evac.length, never: agents.length - evac.length,
    t90: times.length ? times[Math.max(0, Math.ceil(times.length * 0.9) - 1)] : 0,
    tLast: times.length ? times[times.length - 1] : 0,
    exits,
    waited: agents.filter((a) => a.wait >= 10).length,
    unheard: agents.filter((a) => !a.heard).length,
    viaStairs: evac.filter((a) => a.exitKind === "escalera").length,
  };
}

/* ---------- hallazgos ---------- */
export function zoneOf(s: Site, x: number, y: number): Zone | null {
  for (const z of s.zones) if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
  return null;
}
export function addSpeaker(s: Site, z: Zone) {
  const cx = Math.floor(z.x + z.w / 2), cy = Math.floor(z.y + z.h / 2);
  for (let r = 0; r < Math.max(z.w, z.h); r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h && s.g[y * s.cols + x] === FLOOR) {
        s.g[y * s.cols + x] = SPK; return;
      }
    }
}
export function analyze(s: Site, r: RunResult): Finding[] {
  const F: Finding[] = [], ac = r.ac;
  for (const z of s.zones) {
    let bad = 0, tot = 0, worst = 999, wa = 0, wn = 0;
    for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) {
      const ci = y * s.cols + x, t = s.g[ci];
      if (t === WALL || t === WIN || t === FURN) continue;
      const snr = ac.alarm[ci] - ac.amb[ci]; tot++;
      if (snr < SNR_MIN) bad++;
      if (snr < worst) { worst = snr; wa = ac.alarm[ci]; wn = ac.amb[ci] }
    }
    if (!tot) continue;
    const frac = bad / tot;
    const ppl = r.agents.filter((a) => a.zone === z.name && !a.heard).length;
    const noisy = ac.noise.some((n) => { const q = zoneOf(s, n[0], n[1]); return !!q && q.name === z.name });
    const nearNoise = ac.noise.length > 0 && !noisy && wn > BASE_AMBIENT + 8;
    if (frac >= 0.5) {
      F.push({
        sev: "alta", title: "La alarma no se escucha en " + z.name,
        detail: noisy
          ? `Hay una máquina ruidosa dentro de la zona. La alerta llega a ${wa.toFixed(0)} dB pero el ruido de fondo está en ${wn.toFixed(0)} dB: la gente no la distingue y no inicia la evacuación.`
          : nearNoise
          ? `El ruido de la máquina del cuarto vecino sube el fondo a ${wn.toFixed(0)} dB y la alerta sólo llega a ${wa.toFixed(0)} dB, porque esta zona no tiene altavoz propio.`
          : `La zona no tiene altavoz propio y el sonido pierde nivel al cruzar los muros desde el pasillo: llega a ${wa.toFixed(0)} dB.`,
        ev: [[wa.toFixed(0) + " dB", "alerta"], [wn.toFixed(0) + " dB", "ruido de fondo"],
             [(worst < 0 ? "" : "+") + worst.toFixed(0) + " dB", "margen (mín. +15)"], [ppl, "personas sin oírla"]],
        fix: noisy
          ? { label: "Reubicar la máquina ruidosa", apply: (st) => {
              for (let k = 0; k < st.cols * st.rows; k++) {
                const q = zoneOf(st, k % st.cols, (k / st.cols) | 0);
                if (st.g[k] === NOISE && q && q.name === z.name) st.g[k] = FLOOR;
              }
            } }
          : { label: "Instalar altavoz en " + z.name, apply: (st) => addSpeaker(st, z) },
      });
    } else if (frac >= 0.28) {
      F.push({
        sev: "media", title: "Cobertura al límite en " + z.name,
        detail: "Una parte de la zona queda por debajo del margen de 15 dB sobre el ruido de fondo que exige un sistema de alertamiento audible.",
        ev: [[(frac * 100).toFixed(0) + "%", "del área por debajo"], [(worst < 0 ? "" : "+") + worst.toFixed(0) + " dB", "peor margen"]],
        fix: { label: "Instalar altavoz en " + z.name, apply: (st) => addSpeaker(st, z) },
      });
    }
  }
  const obst: number[] = [];
  for (let i = 0; i < s.cols * s.rows; i++) if (s.g[i] === OBST) obst.push(i);
  if (obst.length) {
    const base = r.dist, free = flowField(s, true);
    let sumB = 0, sumF = 0, blocked = 0, affected = 0;
    for (const a of r.agents) {
      const ci = Math.floor(a.sy) * s.cols + Math.floor(a.sx), b = base[ci], f = free[ci];
      if (!isFinite(b) && isFinite(f)) { blocked++; continue }
      if (isFinite(b) && isFinite(f)) { sumB += b; sumF += f; if (b - f > 2) affected++ }
    }
    const extra = sumB - sumF, pct = sumF > 0 ? (extra / sumF) * 100 : 0;
    if (blocked > 0 || pct > 3 || r.waited > 0) {
      F.push({
        sev: blocked > 0 ? "alta" : "media",
        title: blocked > 0 ? "Un estorbo deja gente sin ruta a la salida" : "Un estorbo bloquea el paso y alarga el recorrido",
        detail: (blocked > 0 ? `${blocked} personas no tienen ninguna ruta libre mientras el estorbo siga ahí. ` : "")
          + `Al quitarlo, la suma de los recorridos baja ${extra.toFixed(0)} m porque vuelve a abrirse la ruta más corta.`
          + (r.waited > 0 ? ` Además ${r.waited} personas pasaron más de 10 s frenadas por la aglomeración que provoca.` : ""),
        ev: [[obst.length, "celdas con estorbo"], [affected, "personas desviadas"],
             ["+" + extra.toFixed(0) + " m", "recorrido extra"], ["+" + pct.toFixed(0) + "%", "sobre la ruta libre"]],
        fix: { label: "Retirar el estorbo y volver a simular", apply: (st) => {
          for (let k = 0; k < st.cols * st.rows; k++) if (st.g[k] === OBST) st.g[k] = FLOOR;
        } },
      });
    }
  }
  if (r.never > 0) {
    const names = r.agents.filter((a) => a.state !== 2).slice(0, 3).map((a) => `${a.name} (${a.zone})`);
    F.push({
      sev: "alta",
      title: r.never + (r.never === 1 ? " persona seguía" : " personas seguían") + " dentro al cerrar el simulacro",
      detail: (r.never === 1 ? "No inició la evacuación ni alcanzó una salida en " : "Nunca iniciaron la evacuación o no alcanzaron una salida en ")
        + Math.round(MAXT / 60) + " minutos. " + names.join(", ") + (r.never > 3 ? " y otras más." : "."),
      ev: [[r.never, "sin evacuar"], [r.agents.length, "total en el inmueble"]], fix: null,
    });
  }
  const keys = Object.keys(r.exits);
  if (keys.length > 1 && r.evacuated > 0) {
    const counts = keys.map((k) => r.exits[+k]).sort((a, b) => b - a);
    const share = counts[0] / r.evacuated;
    if (share >= 0.6) F.push({
      sev: "media", title: "Un solo punto de salida absorbió casi a todos",
      detail: "El reparto desigual concentra el cuello de botella en una sola puerta. Conviene señalizar el segundo punto y asignar brigadistas que dirijan hacia él a las áreas más cercanas.",
      ev: [[(share * 100).toFixed(0) + "%", "por el punto principal"], [counts[0], "personas"], [keys.length, "puntos usados"]],
      fix: null,
    });
  }
  if (r.tLast > 0) {
    const ok = r.tLast <= 180;
    F.push({
      sev: ok ? "baja" : "media",
      title: ok ? "Tiempo de desalojo dentro de lo esperado" : "El desalojo tarda más de 3 minutos",
      detail: (ok ? `La última persona sale en ${fmt(r.tLast)}. `
                  : `La última persona sale en ${fmt(r.tLast)}, por encima de los 3 minutos que se toman como referencia operativa. `)
        + "Es el número contra el que se compara el próximo simulacro.",
      ev: [[fmt(r.t90), "para el 90%"], [fmt(r.tLast), "última persona"], [`${r.evacuated}/${r.agents.length}`, "evacuadas"]],
      fix: null,
    });
  }
  const order: Record<Severity, number> = { alta: 0, media: 1, baja: 2 };
  F.sort((a, b) => order[a.sev] - order[b.sev]);
  return F;
}

/** Descompone las celdas de un tipo en rectángulos, para dibujar una cama como
 *  un mueble y no como dos cuadros sueltos. */
export function rectsOf(s: Site, type: number): [number, number, number, number][] {
  const seen = new Uint8Array(s.cols * s.rows), out: [number, number, number, number][] = [];
  for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
    const i = y * s.cols + x;
    if (seen[i] || s.g[i] !== type) continue;
    let w = 1;
    while (x + w < s.cols && s.g[i + w] === type && !seen[i + w]) w++;
    let h = 1, ok = true;
    while (ok && y + h < s.rows) {
      for (let k = 0; k < w; k++) {
        const j = (y + h) * s.cols + x + k;
        if (s.g[j] !== type || seen[j]) { ok = false; break }
      }
      if (ok) h++;
    }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) seen[(y + b) * s.cols + x + a] = 1;
    out.push([x, y, w, h]);
  }
  return out;
}
