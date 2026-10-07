/** Persistencia del proyecto: OPFS (sin la cuota pequeña de localStorage) con respaldo en localStorage. */
import { type Project, loadLocal, parseProject, saveLocal } from "./project";

const FILE = "proyecto.wpe.json";
const T_KEY = "webpokeeditor.savedAt";

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try { return (await navigator.storage?.getDirectory?.()) ?? null; } catch { return null; }
}

export type SaveWhere = "opfs" | "local" | "none";

/** Guarda en OPFS y, si cabe, también en localStorage (respaldo síncrono para el cierre de pestaña). */
export async function saveProject(p: Project): Promise<SaveWhere> {
  const json = JSON.stringify(p);
  let where: SaveWhere = "none";
  try {
    const root = await opfsRoot();
    if (root) {
      const w = await (await root.getFileHandle(FILE, { create: true })).createWritable();
      await w.write(json);
      await w.close();
      where = "opfs";
    }
  } catch { /* sin OPFS (p. ej. Safari sin createWritable) */ }
  if (saveLocal(p)) { try { localStorage.setItem(T_KEY, String(Date.now())); } catch { /* ignore */ } if (where === "none") where = "local"; }
  return where;
}

/** Devuelve el proyecto guardado más reciente entre OPFS y localStorage. */
export async function loadProject(): Promise<Project | null> {
  let fromOpfs: { p: Project; t: number } | null = null;
  try {
    const root = await opfsRoot();
    if (root) {
      const f = await (await root.getFileHandle(FILE)).getFile();
      fromOpfs = { p: parseProject(await f.text()), t: f.lastModified };
    }
  } catch { /* no hay archivo todavía o está corrupto */ }
  const local = loadLocal();
  let tLocal = 0;
  try { tLocal = +(localStorage.getItem(T_KEY) ?? 0); } catch { /* ignore */ }
  if (fromOpfs && (!local || fromOpfs.t >= tLocal)) return fromOpfs.p;
  return local ?? fromOpfs?.p ?? null;
}
