/** Renderer 3D (WebGPU) estilo DS: terreno por tiles con alturas, billboards y cámara orbital inclinada. */
import { ATLAS_COLS, ATLAS_ROWS, BB_FLOWER, BB_TREE, BB_TUFT, TILE_HEIGHT } from "./tiles";

const SHADER = /* wgsl */ `
struct U { vp: mat4x4<f32>, cam: vec4<f32>, fog: vec4<f32>, range: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
struct VIn { @location(0) pos: vec3<f32>, @location(1) uv: vec2<f32>, @location(2) shade: f32 };
struct VOut { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) shade: f32, @location(2) dist: f32 };
@vertex fn vs(v: VIn) -> VOut {
  var o: VOut;
  o.p = u.vp * vec4<f32>(v.pos, 1.0);
  o.uv = v.uv; o.shade = v.shade;
  o.dist = distance(v.pos, u.cam.xyz);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  let c = textureSample(tex, samp, i.uv);
  if (c.a < 0.5) { discard; }
  let f = clamp((i.dist - u.range.x) / (u.range.y - u.range.x), 0.0, 1.0);
  return vec4<f32>(mix(c.rgb * i.shade, u.fog.rgb, f), 1.0);
}
`;

type M4 = Float32Array;
const mul = (a: M4, b: M4): M4 => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
};
const perspective = (fov: number, aspect: number, n: number, f: number): M4 => {
  const t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
  o[0] = t / aspect; o[5] = t; o[10] = f / (n - f); o[11] = -1; o[14] = (f * n) / (n - f);
  return o;
};
const lookAt = (e: number[], c: number[], up = [0, 1, 0]): M4 => {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const o = new Float32Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[4] = xy; o[5] = yy; o[6] = zy; o[8] = xz; o[9] = yz; o[10] = zz;
  o[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); o[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); o[14] = -(zx * e[0] + zy * e[1] + zz * e[2]); o[15] = 1;
  return o;
};

export interface Cam3D { x: number; z: number; yaw: number; pitch: number; dist: number }
export interface Entity3D {
  /** Posición en tiles (esquina superior-izquierda de la celda). */
  x: number; y: number;
  /** Índice base del grupo de 4 frames (abajo, arriba, izq, der). */
  sprite: number;
  /** Dirección de mirada en el mundo: 0 sur(+z), 1 norte(-z), 2 oeste(-x), 3 este(+x). */
  dir: number;
}

const STRIDE = 6; // pos3 uv2 shade1
const SKY: [number, number, number] = [0.55, 0.76, 0.95];

class MeshBuilder {
  v: number[] = [];
  /** Quad con 4 esquinas en orden CCW visto desde el frente. */
  quad(p: number[][], idx: number, shade: number) {
    const e = 0.02 / 16, cw = 1 / ATLAS_COLS, ch = 1 / ATLAS_ROWS;
    const u0 = (idx % ATLAS_COLS) * cw + e * cw * 16 / 16, v0 = Math.floor(idx / ATLAS_COLS) * ch;
    const u1 = u0 + cw - 2 * e * cw * 16 / 16, v1 = v0 + ch;
    const uv = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    for (const i of [0, 1, 2, 0, 2, 3]) this.v.push(p[i][0], p[i][1], p[i][2], uv[i][0], uv[i][1], shade);
  }
  get data() { return new Float32Array(this.v); }
}

export class Renderer3D {
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private ubuf!: GPUBuffer;
  private bind?: GPUBindGroup;
  private tex?: GPUTexture;
  private sampler!: GPUSampler;
  private depth?: GPUTexture;
  private world?: GPUBuffer;
  private worldCount = 0;
  private dyn!: GPUBuffer;
  private w = 1;
  private h = 1;
  private static DYN_MAX = 4096;

  static async create(canvas: HTMLCanvasElement): Promise<Renderer3D> {
    if (!navigator.gpu) throw new Error("WebGPU no disponible");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Sin adaptador WebGPU");
    const r = new Renderer3D();
    r.device = await adapter.requestDevice();
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("No se pudo crear el contexto WebGPU");
    r.ctx = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: r.device, format, alphaMode: "opaque" });
    const module = r.device.createShaderModule({ code: SHADER });
    r.pipeline = r.device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module, entryPoint: "vs",
        buffers: [{ arrayStride: STRIDE * 4, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x2" },
          { shaderLocation: 2, offset: 20, format: "float32" },
        ] }],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    r.ubuf = r.device.createBuffer({ size: 64 + 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    r.sampler = r.device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    r.dyn = r.device.createBuffer({ size: Renderer3D.DYN_MAX * STRIDE * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    return r;
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.depth?.destroy();
    this.depth = this.device.createTexture({ size: [this.w, this.h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  setAtlas(atlas: HTMLCanvasElement) {
    this.tex?.destroy();
    this.tex = this.device.createTexture({
      size: [atlas.width, atlas.height], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: atlas }, { texture: this.tex }, [atlas.width, atlas.height]);
    this.bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.ubuf } }, { binding: 1, resource: this.tex.createView() }, { binding: 2, resource: this.sampler }],
    });
  }

  /** Construye la malla estática del mapa (terreno, muros, árboles y matas). */
  setWorld(tiles: Uint8Array, w: number, h: number) {
    const m = new MeshBuilder();
    const H = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : (TILE_HEIGHT[tiles[y * w + x]] ?? 0));
    const T = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : tiles[y * w + x]);
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const cross = (cx: number, cz: number, size: number, idx: number, base = 0) => {
      const r = size / 2;
      m.quad([[cx - r, base, cz], [cx + r, base, cz], [cx + r, base + size, cz], [cx - r, base + size, cz]], idx, 1);
      m.quad([[cx, base, cz + r], [cx, base, cz - r], [cx, base + size, cz - r], [cx, base + size, cz + r]], idx, 0.92);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      const top = TILE_HEIGHT[t] ?? 0;
      const topTex = t === 4 ? 0 : t === 8 ? 2 : t;
      const isBlock = t === 5 || t === 11;
      m.quad([[x, top, y + 1], [x + 1, top, y + 1], [x + 1, top, y], [x, top, y]], topTex, isBlock && t === 5 ? 0.7 : 1);
      const sides: [number, number, number, number[][], number][] = [
        [0, 1, 0.9, [[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y + 1], [x, 0, y + 1]], 0], // sur
        [0, -1, 0.78, [[x + 1, 0, y], [x, 0, y], [x, 0, y], [x + 1, 0, y]], 0],               // norte
        [-1, 0, 0.66, [[x, 0, y], [x, 0, y + 1], [x, 0, y + 1], [x, 0, y]], 0],               // oeste
        [1, 0, 0.74, [[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, 0, y], [x + 1, 0, y + 1]], 0], // este
      ];
      for (const [dx, dy, sh, e] of sides) {
        const nh = H(x + dx, y + dy);
        if (nh >= top) continue;
        const tex = T(x + dx, y + dy) === 8 && t === 5 ? 8 : t === 3 || t === 4 || t === 8 ? 0 : t === 5 || t === 11 ? t : 0;
        const bottom = Math.max(nh, -2);
        m.quad([[e[0][0], bottom, e[0][2]], [e[1][0], bottom, e[1][2]], [e[1][0], top, e[1][2]], [e[0][0], top, e[0][2]]], t === 3 ? 3 : tex, sh);
      }
      if (t === 4) cross(x + 0.5, y + 0.5, 1.9, BB_TREE);
      else if (t === 1) for (let k = 0; k < 3; k++) cross(x + 0.2 + rnd() * 0.6, y + 0.2 + rnd() * 0.6, 0.55, BB_TUFT);
      else if (t === 6) for (let k = 0; k < 2; k++) cross(x + 0.2 + rnd() * 0.6, y + 0.2 + rnd() * 0.6, 0.4, BB_FLOWER);
    }
    const data = m.data;
    this.world?.destroy();
    this.world = this.device.createBuffer({ size: Math.max(data.byteLength, 4), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.world, 0, data);
    this.worldCount = data.length / STRIDE;
  }

  draw(cam: Cam3D, entities: Entity3D[]) {
    if (!this.bind || !this.world) return;
    const cp = Math.cos(cam.pitch);
    const eye = [cam.x + Math.sin(cam.yaw) * cp * cam.dist, 0.5 + Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * cp * cam.dist];
    const view = lookAt(eye, [cam.x, 0.5, cam.z]);
    const vp = mul(perspective((40 * Math.PI) / 180, this.w / this.h, 0.1, 80), view);
    this.device.queue.writeBuffer(this.ubuf, 0, vp.buffer as ArrayBuffer, vp.byteOffset, 64);
    this.device.queue.writeBuffer(this.ubuf, 64, new Float32Array([eye[0], eye[1], eye[2], 1, SKY[0], SKY[1], SKY[2], 1, cam.dist + 5, cam.dist + 22, 0, 0]));

    // Billboards: ejes del plano de pantalla (cilíndrico alrededor de Y)
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw); // dirección de la cámara hacia el objetivo
    const dyn = new MeshBuilder();
    // orden de atrás hacia delante no hace falta (alpha-test + depth)
    for (const e of entities) {
      const cx = e.x + 0.5, cz = e.y + 0.5, hw = 0.62, hh = 1.2;
      const dvec = [[0, 1], [0, -1], [-1, 0], [1, 0]][e.dir] ?? [0, 1];
      const toward = -(dvec[0] * fx + dvec[1] * fz); // >0: mira hacia la cámara
      const side = dvec[0] * rx + dvec[1] * rz;       // >0: mira a la derecha de pantalla
      const frame = toward > 0.7071 ? 0 : toward < -0.7071 ? 1 : side > 0 ? 3 : 2;
      dyn.quad([[cx - rx * hw, 0, cz - rz * hw], [cx + rx * hw, 0, cz + rz * hw], [cx + rx * hw, hh, cz + rz * hw], [cx - rx * hw, hh, cz - rz * hw]], e.sprite + frame, 1);
    }
    const dd = dyn.data.subarray(0, Renderer3D.DYN_MAX * STRIDE);
    if (dd.length) this.device.queue.writeBuffer(this.dyn, 0, dd);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: SKY[0], g: SKY[1], b: SKY[2], a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: this.depth!.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.world);
    pass.draw(this.worldCount);
    if (dd.length) { pass.setVertexBuffer(0, this.dyn); pass.draw(dd.length / STRIDE); }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
