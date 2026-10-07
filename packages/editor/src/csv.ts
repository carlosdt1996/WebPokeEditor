/** Importación/exportación CSV de especies y movimientos (para editarlos en hojas de cálculo). */
import { STAT_KEYS, type Move, type Project, type Species } from "./project";

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

const SPECIES_HEAD = ["id", "nombre", "tipo1", "tipo2", ...STAT_KEYS, "movimientos", "evoluciona_nivel", "evoluciona_en", "aprende"];
const MOVE_HEAD = ["id", "nombre", "tipo", "categoria", "poder", "precision"];

export function speciesToCsv(p: Project): string {
  return toCsv([SPECIES_HEAD, ...p.species.map((s) => [
    s.id, s.name, p.types[s.types[0]] ?? "", s.types[1] !== undefined ? p.types[s.types[1]] : "",
    ...STAT_KEYS.map((k) => s.stats[k]), s.moves.join(";"), s.evolve?.level ?? "", s.evolve?.into ?? "",
    (s.learnset ?? []).map((l) => `${l.level}:${l.move}`).join(";"),
  ])]);
}
export function movesToCsv(p: Project): string {
  return toCsv([MOVE_HEAD, ...p.moves.map((m) => [m.id, m.name, p.types[m.type] ?? "", m.category === "physical" ? "fisico" : "especial", m.power, m.accuracy])]);
}

export interface CsvResult<T> { items: T[]; errors: string[] }

function table(text: string, head: string[], errors: string[]) {
  const rows = parseCsv(text);
  if (!rows.length) { errors.push("El CSV está vacío"); return []; }
  const idx = head.map((h) => rows[0].map((x) => x.trim().toLowerCase()).indexOf(h));
  const missing = head.filter((_, i) => idx[i] < 0 && !["tipo2", "evoluciona_nivel", "evoluciona_en", "aprende"].includes(head[i]));
  if (missing.length) { errors.push("Faltan columnas: " + missing.join(", ")); return []; }
  return rows.slice(1).map((r, n) => ({ n: n + 2, get: (h: string) => (idx[head.indexOf(h)] >= 0 ? (r[idx[head.indexOf(h)]] ?? "").trim() : "") }));
}

export function speciesFromCsv(p: Project, text: string): CsvResult<Species> {
  const errors: string[] = [], items: Species[] = [];
  const typeIdx = (name: string, n: number) => { const i = p.types.findIndex((t) => t.toLowerCase() === name.toLowerCase()); if (i < 0) errors.push(`línea ${n}: tipo desconocido "${name}"`); return Math.max(0, i); };
  for (const r of table(text, SPECIES_HEAD, errors)) {
    const id = r.get("id");
    if (!id) { errors.push(`línea ${r.n}: falta el id`); continue; }
    const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(1, Math.min(255, +r.get(k) || 0))])) as unknown as Species["stats"];
    if (STAT_KEYS.some((k) => !+r.get(k))) errors.push(`línea ${r.n}: estadísticas no numéricas`);
    const t2 = r.get("tipo2");
    const sp: Species = { id, name: r.get("nombre") || id, types: [typeIdx(r.get("tipo1"), r.n), ...(t2 ? [typeIdx(t2, r.n)] : [])], stats, moves: r.get("movimientos").split(";").map((x) => x.trim()).filter(Boolean) };
    if (+r.get("evoluciona_nivel") > 0 && r.get("evoluciona_en")) sp.evolve = { level: +r.get("evoluciona_nivel"), into: r.get("evoluciona_en") };
    const ls = r.get("aprende").split(";").map((x) => x.trim().split(":")).filter((a) => a.length === 2 && +a[0] > 0).map((a) => ({ level: +a[0], move: a[1].trim() }));
    if (ls.length) sp.learnset = ls;
    const old = p.species.find((s) => s.id === id);
    if (old?.sprite) sp.sprite = old.sprite; // conserva el sprite importado
    items.push(sp);
  }
  return { items, errors };
}

export function movesFromCsv(p: Project, text: string): CsvResult<Move> {
  const errors: string[] = [], items: Move[] = [];
  for (const r of table(text, MOVE_HEAD, errors)) {
    const id = r.get("id");
    if (!id) { errors.push(`línea ${r.n}: falta el id`); continue; }
    const ti = p.types.findIndex((t) => t.toLowerCase() === r.get("tipo").toLowerCase());
    if (ti < 0) errors.push(`línea ${r.n}: tipo desconocido "${r.get("tipo")}"`);
    const cat = r.get("categoria").toLowerCase();
    items.push({ id, name: r.get("nombre") || id, type: Math.max(0, ti), category: cat.startsWith("esp") || cat === "special" ? "special" : "physical", power: Math.max(0, Math.min(250, +r.get("poder") || 0)), accuracy: Math.max(1, Math.min(100, +r.get("precision") || 100)) });
  }
  return { items, errors };
}
