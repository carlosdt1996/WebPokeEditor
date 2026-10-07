export interface Frame {
  /** Instancias: [x, y, atlasIndex, 0] por quad, en píxeles de mundo. */
  instances: Float32Array;
  count: number;
  offsetX: number;
  offsetY: number;
  /** Píxeles de pantalla por píxel de mundo. */
  scale: number;
  clear: [number, number, number];
}

export interface Renderer {
  readonly kind: "webgpu" | "canvas2d";
  /** Tamaño del canvas en píxeles de dispositivo. */
  resize(width: number, height: number): void;
  setAtlas(atlas: HTMLCanvasElement): void;
  draw(frame: Frame): void;
}

export const MAX_INSTANCES = 20000;
