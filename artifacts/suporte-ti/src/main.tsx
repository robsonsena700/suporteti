import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// #region debug-point mobile-white-screen.boot
const dbgRunId = (() => {
  try {
    const existing = window.sessionStorage.getItem("ti_dbg_run_id");
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem("ti_dbg_run_id", next);
    return next;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();

function getDbgUrl(): string | null {
  try {
    const url = new URLSearchParams(window.location.search).get("dbg");
    return url && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

async function postDbg(event: Record<string, unknown>): Promise<void> {
  try {
    const buffer = ((window as any).__ti_dbg_buffer ??= []) as Array<Record<string, unknown>>;
    buffer.push({
      sessionId: "mobile-white-screen",
      runId: dbgRunId,
      ts: Date.now(),
      ...event,
    });
    if (buffer.length > 400) buffer.splice(0, buffer.length - 300);
  } catch {}

  const url = getDbgUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "mobile-white-screen",
        runId: dbgRunId,
        ts: Date.now(),
        ...event,
      }),
      keepalive: true,
    });
  } catch {}
}

(window as any).__ti_dbg = postDbg;
(window as any).__ti_dbg_dump = () => {
  try {
    const buffer = ((window as any).__ti_dbg_buffer ??= []) as Array<Record<string, unknown>>;
    return buffer.slice(-200);
  } catch {
    return [];
  }
};

window.addEventListener("error", (ev) => {
  void postDbg({
    level: "error",
    source: "window.error",
    message: String((ev as ErrorEvent).message || "error"),
    filename: String((ev as ErrorEvent).filename || ""),
    lineno: (ev as ErrorEvent).lineno ?? null,
    colno: (ev as ErrorEvent).colno ?? null,
  });
});

window.addEventListener("unhandledrejection", (ev) => {
  const reason = (ev as PromiseRejectionEvent).reason;
  void postDbg({
    level: "error",
    source: "window.unhandledrejection",
    message: typeof reason === "string" ? reason : (reason?.message ?? "unhandledrejection"),
  });
});

void postDbg({
  level: "info",
  source: "boot",
  href: window.location.href,
  ua: navigator.userAgent,
  viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
});
// #endregion debug-point mobile-white-screen.boot

createRoot(document.getElementById("root")!).render(<App />);
