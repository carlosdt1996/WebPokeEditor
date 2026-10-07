/**
 * Internacionalización ligera: las claves son los propios textos en español y se traducen con `EN`.
 * `t("¡{0} se debilitó!", nombre)` sustituye {0}, {1}… Si falta la traducción se usa el español.
 * El idioma se guarda en localStorage (`wpe.lang`) ; los textos del proyecto (diálogos, nombres) los escribe el autor.
 */
import { EN } from "./i18n.en";

export type Lang = "es" | "en";
export const LANGS: [Lang, string][] = [["es", "Español"], ["en", "English"]];

let lang: Lang = "es";
try {
  const saved = localStorage.getItem("wpe.lang");
  if (saved === "es" || saved === "en") lang = saved; // sin detección automática: el español es el idioma de referencia
} catch { /* sin almacenamiento */ }

export const getLang = (): Lang => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem("wpe.lang", l); } catch { /* sin almacenamiento */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

export function t(key: string, ...args: (string | number)[]): string {
  const s = lang === "en" ? (EN[key] ?? key) : key;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[+i] ?? "")) : s;
}
