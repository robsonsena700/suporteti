import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

const JWT_SECRET = process.env.SESSION_SECRET ?? "suporte-ti-secret";

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  status: string;
  uf: string;
  municipality: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    next();
  };
}

export function requireActive(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (req.user.status !== "ACTIVE") {
    res.status(403).json({ error: "Conta pendente de aprovação" });
    return;
  }
  next();
}
