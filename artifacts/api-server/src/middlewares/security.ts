import type { Request, Response, NextFunction } from "express";

export function requireHttpsInProduction(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim().toLowerCase();
  const isHttps = req.secure || forwarded === "https";
  if (!isHttps) {
    res.status(403).json({ error: "HTTPS obrigatório" });
    return;
  }
  next();
}

export function requireSameOriginInProduction(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const appUrl = String(process.env.APP_PUBLIC_URL || "").trim();
  if (!appUrl) {
    res.status(403).json({ error: "Origem inválida" });
    return;
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(appUrl).origin;
  } catch {
    res.status(403).json({ error: "Origem inválida" });
    return;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";

  if (origin) {
    if (origin !== expectedOrigin) {
      res.status(403).json({ error: "CSRF bloqueado" });
      return;
    }
    next();
    return;
  }

  if (referer) {
    if (!referer.startsWith(expectedOrigin)) {
      res.status(403).json({ error: "CSRF bloqueado" });
      return;
    }
    next();
    return;
  }

  res.status(403).json({ error: "CSRF bloqueado" });
}

