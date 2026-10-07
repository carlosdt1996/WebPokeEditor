import { defineConfig } from "vite";

export default defineConfig({
  // Ruta relativa: funciona en GitHub Pages (/<repo>/) y en local.
  base: "./",
  build: { target: "es2022", outDir: "dist" },
  test: { environment: "node" },
});
