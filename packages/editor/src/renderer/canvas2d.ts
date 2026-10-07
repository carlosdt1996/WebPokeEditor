import { ATLAS_COLS, TILE } from "../tiles";
import type { Frame, Renderer } from "./types";

/** Fallback sin WebGPU: misma interfaz, dibuja con Canvas 2D. */
export class Canvas2DRenderer implements Renderer {
  readonly kind = "canvas2d" as const;
  private g: CanvasRenderingContext2D;
  private atlas?: HTMLCanvasElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setAtlas(atlas: HTMLCanvasElement) {
    this.atlas = atlas;
  }

  draw(f: Frame) {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.fillStyle = `rgb(${f.clear.map((c) => Math.round(c * 255)).join(",")})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.atlas) return;
    const s = f.scale;
    const size = Math.ceil(TILE * s);
    for (let i = 0; i < f.count; i++) {
      const x = f.instances[i * 4], y = f.instances[i * 4 + 1], idx = f.instances[i * 4 + 2];
      g.drawImage(
        this.atlas,
        (idx % ATLAS_COLS) * TILE, Math.floor(idx / ATLAS_COLS) * TILE, TILE, TILE,
        Math.round((x - f.offsetX) * s), Math.round((y - f.offsetY) * s), size, size,
      );
    }
  }
}
