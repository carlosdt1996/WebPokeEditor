/** Importación/exportación CSV de especies y movimientos (para editarlos en hojas de cálculo). */
import { BATTLE_STATS, STATUS_KINDS, STAT_KEYS, WEATHER_KINDS, type BattleStat, type Move, type MoveEffect, type Project, type Species, type StatusKind, type WeatherKind } from "./project";

export function toCsv(rows: (string | number)[][]): string {
  const q = (v: string | number) => { const s = String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}

/** Parser RFC 4180 mínimo (comillas dobles, saltos de línea dentro de campo). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

const SPECIES_HEAD = ["id", "nombre", "tipo1", "tipo2", ...STAT_KEYS, "movimientos", "evoluciona_nivel", "evoluciona_en", "aprende", "habilidad"];
const SPECIES_OPTIONAL = ["tipo2", "evoluciona_nivel", "evoluciona_en", "aprende", "habilidad"];
const MOVE_HEAD = ["id", "nombre", "tipo", "categoria", "poder", "precision", "prioridad", "estado", "prob_estado", "estadistica", "etapas", "objetivo_estadistica", "prob_estadistica", "drenaje", "retroceso", "cura", "golpes_min", "golpes_max", "critico", "carga", "recarga", "clima", "terreno", "proteccion", "amedrentar", "atrapar", "forzar_cambio"];
const MOVE_OPTIONAL = MOVE_HEAD.slice(6);

export function speciesToCsv(p: Project): string {
  return toCsv([SPECIES_HEAD, ...p.species.map((s) => [
    s.id, s.name, p.types[s.types[0]] ?? "", s.types[1] !== undefined ? p.types[s.types[1]] : "",
    ...STAT_KEYS.map((k) => s.stats[k]), s.moves.join(";"), s.evolve?.level ?? "", s.evolve?.into ?? "",
    (s.learnset ?? []).map((l) => `${l.level}:${l.move}`).join(";"), s.ability ?? "",
  ])]);
}
export function movesToCsv(p: Project): string {
  return toCsv([MOVE_HEAD, ...p.moves.map((m) => {
    const e = m.effect ?? {};
    return [m.id, m.name, p.types[m.type] ?? "", m.category === "physical" ? "fisico" : "especial", m.power, m.accuracy,
      e.priority ?? "", e.status?.kind ?? "", e.status?.chance ?? "", e.stat?.stat ?? "", e.stat?.stages ?? "", e.stat ? (e.stat.target === "foe" ? "rival" : "usuario") : "", e.stat?.chance ?? "",
      e.drain ?? "", e.recoil ?? "", e.heal ?? "",
      e.hits?.min ?? "", e.hits?.max ?? "", e.crit ?? "", e.charge ? 1 : "", e.recharge ? 1 : "", e.weather ?? "", e.terrain ? 1 : "", e.protect ? 1 : "", e.flinch ?? "", e.trap ? 1 : "", e.phaze ? 1 : ""];
  })]);
}

export interface CsvResult<T> { items: T[]; errors: string[] }

function table(text: string, head: string[], optional: string[], errors: string[]) {
  const rows = parseCsv(text);
  if (!rows.length) { errors.push("El CSV está vacío"); return []; }
  const idx = head.map((h) => rows[0].map((x) => x.trim().toLowerCase()).indexOf(h));
  const missing = head.filter((h, i) => idx[i] < 0 && !optional.includes(h));
  if (missing.length) { errors.push("Faltan columnas: " + missing.join(", ")); return []; }
  return rows.slice(1).map((r, n) => ({ n: n + 2, get: (h: string) => (idx[head.indexOf(h)] >= 0 ? (r[idx[head.indexOf(h)]] ?? "").trim() : "") }));
}

export function speciesFromCsv(p: Project, text: string): CsvResult<Species> {
  const errors: string[] = [], items: Species[] = [];
  const typeIdx = (name: string, n: number) => { const i = p.types.findIndex((t) => t.toLowerCase() === name.toLowerCase()); if (i < 0) errors.push(`línea ${n}: tipo desconocido "${name}"`); return Math.max(0, i); };
  for (const r of table(text, SPECIES_HEAD, SPECIES_OPTIONAL, errors)) {
    const id = r.get("id");
    if (!id) { errors.push(`línea ${r.n}: falta el id`); continue; }
    const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(1, Math.min(255, +r.get(k) || 0))])) as unknown as Species["stats"];
    if (STAT_KEYS.some((k) => !+r.get(k))) errors.push(`línea ${r.n}: estadísticas no numéricas`);
    const t2 = r.get("tipo2");
    const sp: Species = { id, name: r.get("nombre") || id, types: [typeIdx(r.get("tipo1"), r.n), ...(t2 ? [typeIdx(t2, r.n)] : [])], stats, moves: r.get("movimientos").split(";").map((x) => x.trim()).filter(Boolean) };
    if (+r.get("evoluciona_nivel") > 0 && r.get("evoluciona_en")) sp.evolve = { level: +r.get("evoluciona_nivel"), into: r.get("evoluciona_en") };
    const ls = r.get("aprende").split(";").map((x) => x.trim().split(":")).filter((a) => a.length === 2 && +a[0] > 0).map((a) => ({ level: +a[0], move: a[1].trim() }));
    if (ls.length) sp.learnset = ls;
    if (r.get("habilidad")) sp.ability = r.get("habilidad");
    const old = p.species.find((s) => s.id === id);
    if (old?.sprite) sp.sprite = old.sprite; // conserva el sprite importado
    items.push(sp);
  }
  return { items, errors };
}

export function movesFromCsv(p: Project, text: string): CsvResult<Move> {
  const errors: string[] = [], items: Move[] = [];
  for (const r of table(text, MOVE_HEAD, MOVE_OPTIONAL, errors)) {
    const id = r.get("id");
    if (!id) { errors.push(`línea ${r.n}: falta el id`); continue; }
    const ti = p.types.findIndex((t) => t.toLowerCase() === r.get("tipo").toLowerCase());
    if (ti < 0) errors.push(`línea ${r.n}: tipo desconocido "${r.get("tipo")}"`);
    const cat = r.get("categoria").toLowerCase();
    const mv: Move = { id, name: r.get("nombre") || id, type: Math.max(0, ti), category: cat.startsWith("esp") || cat === "special" ? "special" : "physical", power: Math.max(0, Math.min(250, +r.get("poder") || 0)), accuracy: Math.max(1, Math.min(100, +r.get("precision") || 100)) };
    const eff: MoveEffect = {};
    const num = (h: string) => (r.get(h) === "" ? undefined : Number(r.get(h)));
    if (num("prioridad")) eff.priority = Math.max(-3, Math.min(3, num("prioridad")!));
    if (r.get("estado")) {
      if (!STATUS_KINDS.includes(r.get("estado") as StatusKind)) errors.push(`línea ${r.n}: estado desconocido "${r.get("estado")}" (${STATUS_KINDS.join(", ")})`);
      else eff.status = { kind: r.get("estado") as StatusKind, chance: Math.max(0, Math.min(100, num("prob_estado") ?? 100)) };
    }
    if (r.get("estadistica")) {
      if (!BATTLE_STATS.includes(r.get("estadistica") as BattleStat)) errors.push(`línea ${r.n}: estadística desconocida "${r.get("estadistica")}" (${BATTLE_STATS.join(", ")})`);
      else eff.stat = { stat: r.get("estadistica") as BattleStat, stages: Math.max(-6, Math.min(6, num("etapas") ?? 1)), target: r.get("objetivo_estadistica") === "rival" ? "foe" : "self", chance: Math.max(0, Math.min(100, num("prob_estadistica") ?? 100)) };
    }
    if (num("drenaje")) eff.drain = Math.max(0, Math.min(100, num("drenaje")!));
    if (num("retroceso")) eff.recoil = Math.max(0, Math.min(100, num("retroceso")!));
    if (num("cura")) eff.heal = Math.max(0, Math.min(100, num("cura")!));
    if (num("golpes_max") && num("golpes_max")! > 1) eff.hits = { min: Math.max(1, Math.min(5, num("golpes_min") ?? 2)), max: Math.max(1, Math.min(5, num("golpes_max")!)) };
    if (num("critico")) eff.crit = Math.max(0, Math.min(3, num("critico")!));
    if (num("carga")) eff.charge = true;
    if (num("recarga")) eff.recharge = true;
    if (r.get("clima")) {
      if (!WEATHER_KINDS.includes(r.get("clima") as WeatherKind)) errors.push(`línea ${r.n}: clima desconocido "${r.get("clima")}" (${WEATHER_KINDS.join(", ")})`);
      else eff.weather = r.get("clima") as WeatherKind;
    }
    if (num("terreno")) eff.terrain = true;
    if (num("proteccion")) eff.protect = true;
    if (num("amedrentar")) eff.flinch = Math.max(0, Math.min(100, num("amedrentar")!));
    if (num("atrapar")) eff.trap = true;
    if (num("forzar_cambio")) eff.phaze = true;
    if (Object.keys(eff).length) mv.effect = eff;
    items.push(mv);
  }
  return { items, errors };
}
