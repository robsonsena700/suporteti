import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
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

// ------ Revogacao de token (logout) ------
// O logout antes era um no-op: o token continuava valido pelos 7 dias de
// validade, entao um token capturado (ex.: maquina compartilhada) seguia
// servindo mesmo depois do usuario sair. Aqui cada token recebe um "jti"
// (identificador unico) e o logout guarda esse jti numa lista de revogados ate
// a expiracao natural do token.
//
// Mantida em memoria, no mesmo padrao do rate limiter (lib/rate-limit.ts), de
// proposito: exigir uma coluna nova em "users" seria uma migracao (DDL) em
// producao, e o ganho nao justifica o risco. Limitacoes aceitas:
// - Nao sobrevive a reinicio do processo nem e compartilhada entre instancias.
//   Apos um restart, os tokens revogados voltam a valer ate expirarem sozinhos.
// - Tokens emitidos antes desta mudanca nao tem "jti" e por isso nao podem ser
//   revogados — mas tambem nao podiam antes, entao nao ha regressao.
const revokedTokens = new Map<string, number>(); // jti -> expiracao em ms

function cleanupRevoked(now: number): void {
  for (const [jti, exp] of revokedTokens.entries()) {
    if (exp <= now) revokedTokens.delete(jti);
  }
}

function isRevoked(jti: string): boolean {
  const exp = revokedTokens.get(jti);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    revokedTokens.delete(jti);
    return false;
  }
  return true;
}

// Recebe o token cru (nao verificado, porque no logout ele pode ja estar
// expirado ou invalido) e registra o jti ate a expiracao declarada nele.
// Nunca lanca: se o token for malformado, simplesmente nao ha o que revogar.
export function revokeToken(token: string): void {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === "string") return;
  const { jti, exp } = decoded as { jti?: unknown; exp?: unknown };
  if (typeof jti !== "string" || typeof exp !== "number") return;
  cleanupRevoked(Date.now());
  revokedTokens.set(jti, exp * 1000);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
    algorithm: JWT_ALGORITHM,
    jwtid: randomUUID(),
  });
}

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload & {
    jti?: string;
  };
  if (typeof payload.jti === "string" && isRevoked(payload.jti)) {
    throw new Error("Token revogado");
  }
  return payload;
}

// ------ Revalidacao do usuario a cada requisicao ------
// O JWT carrega role/status/uf/municipio do momento do login e vale 7 dias.
// Antes, requireAuth/requireActive/requireRoles confiavam so no token: um
// usuario DESATIVADO ou REBAIXADO seguia com o acesso antigo ate o token
// expirar (e um usuario recem-aprovado continuava "PENDING" ate relogar).
// Agora o estado atual e lido do banco, com um cache curto por usuario para
// nao gerar uma query por requisicao. Alteracoes feitas pelas rotas de
// usuarios chamam invalidateAuthUserCache(id) e passam a valer na hora;
// qualquer outra alteracao (ex.: SQL manual) vale em ate AUTH_USER_CACHE_TTL_MS.
export type AuthUserSnapshot = Pick<JwtPayload, "email" | "role" | "status" | "uf" | "municipality">;
type AuthUserLoader = (userId: number) => Promise<AuthUserSnapshot | null>;

const AUTH_USER_CACHE_TTL_MS = 30_000;
const AUTH_USER_CACHE_MAX = 5_000;
const authUserCache = new Map<number, { value: AuthUserSnapshot | null; expiresAt: number }>();

// Import dinamico de proposito: mantem este modulo importavel sem DATABASE_URL
// (os testes unitarios de requireRoles importam este arquivo diretamente).
const defaultAuthUserLoader: AuthUserLoader = async (userId) => {
  const [{ db, usersTable }, { eq }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
  ]);
  const [row] = await db
    .select({
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      uf: usersTable.uf,
      municipality: usersTable.municipality,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row ?? null;
};

let authUserLoader: AuthUserLoader = defaultAuthUserLoader;

/** Somente para testes: troca a origem dos dados do usuario (null restaura o padrao). */
export function setAuthUserLoaderForTests(loader: AuthUserLoader | null): void {
  authUserLoader = loader ?? defaultAuthUserLoader;
  authUserCache.clear();
}

/** Descarta o estado em cache de um usuario (ou de todos, sem argumento). */
export function invalidateAuthUserCache(userId?: number): void {
  if (userId === undefined) {
    authUserCache.clear();
    return;
  }
  authUserCache.delete(userId);
}

async function loadAuthUser(userId: number): Promise<AuthUserSnapshot | null> {
  const now = Date.now();
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await authUserLoader(userId);
  if (authUserCache.size >= AUTH_USER_CACHE_MAX) {
    for (const [id, entry] of authUserCache.entries()) {
      if (entry.expiresAt <= now) authUserCache.delete(id);
    }
    if (authUserCache.size >= AUTH_USER_CACHE_MAX) authUserCache.clear();
  }
  authUserCache.set(userId, { value, expiresAt: now + AUTH_USER_CACHE_TTL_MS });
  return value;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  let current: AuthUserSnapshot | null;
  try {
    current = await loadAuthUser(payload.userId);
  } catch (err) {
    logger.error({ err, userId: payload.userId }, "Falha ao revalidar usuario autenticado");
    res.status(503).json({ error: "Serviço temporariamente indisponível" });
    return;
  }
  if (!current) {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  req.user = {
    userId: payload.userId,
    email: current.email,
    role: current.role,
    status: current.status,
    uf: current.uf,
    municipality: current.municipality,
  };
  next();
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
