import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

// Antes havia um fallback fixo ("suporte-ti-secret") caso SESSION_SECRET não
// estivesse definido — removido de propósito: um segredo previsível e
// presente no código-fonte permitiria forjar um token válido (inclusive de
// ADMIN) sem senha nenhuma. Agora a aplicação recusa subir sem o segredo
// configurado, do mesmo jeito que lib/db já faz para DATABASE_URL.
// Lida numa função com retorno tipado "string" (em vez de uma checagem solta no
// nível do módulo) porque o TypeScript não propaga o estreitamento de tipo de um
// `if (!x) throw` para dentro de outras funções declaradas depois (signToken/
// verifyToken abaixo) — sem isso, JWT_SECRET continuaria tipado como
// `string | undefined` nelas.
function getJwtSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET deve estar definido no ambiente. A aplicação não deve subir sem um segredo de assinatura de token configurado."
    );
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

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

// Fixa o algoritmo de assinatura/verificação explicitamente. Sem isso, um
// token malicioso poderia tentar forçar outro algoritmo (ex.: um ataque de
// confusão de algoritmo, incluindo "none") caso a biblioteca ou alguma
// configuração futura permitisse; travando em HS256 nos dois lados, qualquer
// token assinado ou apresentado com outro algoritmo é rejeitado.
const JWT_ALGORITHM = "HS256" as const;

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d", algorithm: JWT_ALGORITHM });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
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
