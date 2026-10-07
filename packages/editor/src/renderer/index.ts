import { Canvas2DRenderer } from "./canvas2d";
import type { Renderer } from "./types";
import { WebGPURenderer } from "./webgpu";

export type { Frame, Renderer } from "./types";

/** Intenta WebGPU; si no está disponible cae a Canvas 2D (el canvas no se puede reutilizar entre contextos). */
export async function createRenderer(host: HTMLElement): Promise<{ renderer: Renderer; canvas: HTMLCanvasElement }> {
  const make = () => {
    const c = document.createElement("canvas");
    c.className = "gl";
    host.prepend(c);
    return c;
  };
  let canvas = make();
  try {
    return { renderer: await WebGPURenderer.create(canvas), canvas };
  } catch (e) {
    console.warn("WebGPU no disponible, usando Canvas 2D:", e);
    canvas.remove();
    canvas = make();
    return { renderer: new Canvas2DRenderer(canvas), canvas };
  }
}
