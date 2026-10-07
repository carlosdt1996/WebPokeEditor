import { ATLAS_COLS, ATLAS_ROWS, TILE } from "../tiles";
import { MAX_INSTANCES, type Frame, type Renderer } from "./types";

const SHADER = /* wgsl */ `
struct Uniforms {
  view: vec2<f32>,
  offset: vec2<f32>,
  scale: f32,
  cols: f32,
  rows: f32,
  tile: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> inst: array<vec4<f32>>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2<f32>, 6>(
    vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0));
  let c = corners[vi];
  let d = inst[ii];
  let world = d.xy + c * u.tile;
  let px = (world - u.offset) * u.scale;
  let ndc = vec2(px.x / u.view.x * 2.0 - 1.0, 1.0 - px.y / u.view.y * 2.0);
  let idx = floor(d.z + 0.5);
  let cell = vec2(idx % u.cols, floor(idx / u.cols));
  // pequeño inset para evitar sangrado entre tiles al escalar
  let e = 0.02 / u.tile;
  let local = mix(vec2(e), vec2(1.0 - e), c);
  var o: VOut;
  o.pos = vec4(ndc, 0.0, 1.0);
  o.uv = (cell + local) / vec2(u.cols, u.rows);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  let col = textureSample(atlas, samp, in.uv);
  if (col.a < 0.01) { discard; }
  return col;
}
`;

export class WebGPURenderer implements Renderer {
  readonly kind = "webgpu" as const;
  private ctx!: GPUCanvasContext;
  private device!: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private uniforms!: GPUBuffer;
  private instances!: GPUBuffer;
  private sampler!: GPUSampler;
  private texture?: GPUTexture;
  private bind?: GPUBindGroup;
  private w = 1;
  private h = 1;

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
    if (!navigator.gpu) throw new Error("WebGPU no disponible");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("Sin adaptador WebGPU");
    const device = await adapter.requestDevice();
    const r = new WebGPURenderer();
    r.device = device;
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("No se pudo crear el contexto WebGPU");
    r.ctx = ctx;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });

    const module = device.createShaderModule({ code: SHADER });
    r.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
    r.uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    r.instances = device.createBuffer({
      size: MAX_INSTANCES * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    r.sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    return r;
  }

  resize(width: number, height: number) {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
  }

  setAtlas(atlas: HTMLCanvasElement) {
    this.texture?.destroy();
    this.texture = this.device.createTexture({
      size: [atlas.width, atlas.height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: atlas }, { texture: this.texture }, [atlas.width, atlas.height]);
    this.bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: this.instances } },
        { binding: 2, resource: this.texture.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  draw(f: Frame) {
    if (!this.bind) return;
    const count = Math.min(f.count, MAX_INSTANCES);
    this.device.queue.writeBuffer(
      this.uniforms, 0,
      new Float32Array([this.w, this.h, f.offsetX, f.offsetY, f.scale, ATLAS_COLS, ATLAS_ROWS, TILE]),
    );
    if (count > 0) this.device.queue.writeBuffer(this.instances, 0, f.instances.buffer, f.instances.byteOffset, count * 16);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: f.clear[0], g: f.clear[1], b: f.clear[2], a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    if (count > 0) pass.draw(6, count);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
