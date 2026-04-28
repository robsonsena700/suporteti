import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "node:fs";

function tryLoadDotEnv() {
  try {
    const envPath = path.resolve(import.meta.dirname, "..", "..", ".env");
    const raw = readFileSync(envPath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (!key) continue;
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    return env;
  } catch {
    return null;
  }
}

const dotEnv = tryLoadDotEnv();
if (!process.env.PORT && dotEnv?.WEB_PORT) {
  process.env.PORT = dotEnv.WEB_PORT;
}
if (!process.env.VITE_API_PROXY_TARGET && dotEnv?.VITE_API_PROXY_TARGET) {
  process.env.VITE_API_PROXY_TARGET = dotEnv.VITE_API_PROXY_TARGET;
}

const rawPort = process.env.PORT ?? "5174";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET
  ?? (process.env.API_PORT ? `http://localhost:${process.env.API_PORT}` : undefined)
  ?? "http://localhost:3001";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version?: string };
const appVersion = pkg.version ?? "0.0.0";
const appEnv = process.env.NODE_ENV ?? "development";
const buildTime = new Date().toISOString();

async function loadOptionalPlugins() {
  const plugins: any[] = [];

  try {
    const runtime = await import("@replit/vite-plugin-runtime-error-modal");
    plugins.push(runtime.default());
  } catch {
    // Optional in non-Replit environments.
  }

  if (process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined) {
    try {
      const cartographer = await import("@replit/vite-plugin-cartographer");
      plugins.push(
        cartographer.cartographer({
          root: path.resolve(import.meta.dirname, ".."),
        }),
      );
    } catch {
      // Optional in non-Replit environments.
    }

    try {
      const banner = await import("@replit/vite-plugin-dev-banner");
      plugins.push(banner.devBanner());
    } catch {
      // Optional in non-Replit environments.
    }
  }

  return plugins;
}

export default defineConfig(async () => {
  const optionalPlugins = await loadOptionalPlugins();
  return {
    base: basePath,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_ENV__: JSON.stringify(appEnv),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
    plugins: [
      react(),
      tailwindcss(),
      ...optionalPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
        "@workspace/api-zod": path.resolve(import.meta.dirname, "..", "..", "lib", "api-zod", "src", "index.ts"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
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
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          timeout: 0,
          proxyTimeout: 0,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              try {
                proxyReq.setHeader("Connection", "keep-alive");
              } catch {}
            });
            proxy.on("proxyRes", (proxyRes) => {
              try {
                (proxyRes.headers as any)["connection"] = "keep-alive";
              } catch {}
            });
          },
        },
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
