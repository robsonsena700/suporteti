import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";
import { createRequire } from "node:module";

const rawPort = process.env.PORT ?? "5175";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

const require = createRequire(import.meta.url);
const optionalPlugins: any[] = [];
try {
  const runtime = require("@replit/vite-plugin-runtime-error-modal");
  optionalPlugins.push(runtime.default());
} catch {}
if (process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined) {
  try {
    const cartographer = require("@replit/vite-plugin-cartographer");
    optionalPlugins.push(
      cartographer.cartographer({
        root: path.resolve(import.meta.dirname, ".."),
      }),
    );
  } catch {}
}

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    ...optionalPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
