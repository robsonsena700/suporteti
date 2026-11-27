import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRoles } from "../middlewares/auth";
import { createInMemoryRateLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  PRIVACY_DOCUMENTS,
  PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_TYPES,
  buildPrivacyProtocol,
  getPrivacyContacts,
  hashPrivacyDocument,
  pendingPrivacyDocuments,
  type PrivacyDocumentType,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "../lib/privacy-documents";

const router: IRouter = Router();

const exportLimiter = createInMemoryRateLimiter({ windowMs: 60 * 60_000, max: 5 }); // 5 exportações/hora/usuário
const requestLimiter = createInMemoryRateLimiter({ windowMs: 24 * 60 * 60_000, max: 10 }); // 10 solicitações/dia/usuário

const DESCRIPTION_MAX = 2000;
const RESPONSE_MAX = 4000;

function limited(limiter: ReturnType<typeof createInMemoryRateLimiter>, key: string, res: Response): boolean {
  const r = limiter.check(key);
  if (r.allowed) return false;
  res.setHeader("Retry-After", String(r.retryAfterSeconds));
  res.status(429).json({ error: "Muitas solicitações. Tente novamente mais tarde." });
  return true;
}

function clientIp(req: Request): string | null {
  const ip = String(req.ip || "").trim();
  return ip ? ip.slice(0, 100) : null;
}

function publicDocuments() {
  return PRIVACY_DOCUMENTS.map((d) => ({
    type: d.type,
    slug: d.slug,
    title: d.title,
    version: d.version,
    effectiveDate: d.effectiveDate,
    requiresAcknowledgement: d.requiresAcknowledgement,
    legallyValidated: d.legallyValidated,
    hash: hashPrivacyDocument(d),
    content: d.content,
  }));
}

async function acceptedVersions(userId: number): Promise<Partial<Record<PrivacyDocumentType, number>>> {
  const res = await db.execute(sql`
    select document_type, max(document_version)::int as version
    from public.privacy_acceptances
    where user_id = ${userId}
    group by document_type
  `);
  const out: Partial<Record<PrivacyDocumentType, number>> = {};
  for (const row of res.rows as Array<{ document_type: PrivacyDocumentType; version: number }>) {
    out[row.document_type] = Number(row.version);
  }
  return out;
}

/** Registra aceite/ciência das versões vigentes. Usado no cadastro e no aviso de ciência. */
export async function recordPrivacyAcceptance(args: {
  userId: number;
  kind: "ACEITE_CADASTRO" | "CIENCIA";
  ip: string | null;
  types?: PrivacyDocumentType[];
}): Promise<void> {
  const docs = PRIVACY_DOCUMENTS.filter((d) => !args.types || args.types.includes(d.type));
  for (const d of docs) {
    await db.execute(sql`
      insert into public.privacy_acceptances (user_id, document_type, document_version, content_hash, kind, ip)
      values (${args.userId}, ${d.type}, ${d.version}, ${hashPrivacyDocument(d)}, ${args.kind}, ${args.ip})
    `);
  }
}

// Público: textos vigentes + contato do encarregado (sem login, usado na tela de cadastro).
router.get("/privacy/documents", (_req, res): void => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ documents: publicDocuments(), contacts: getPrivacyContacts() });
});

router.get("/privacy/me", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  try {
    const versions = await acceptedVersions(user.userId);
    const pending = pendingPrivacyDocuments(versions).map((d) => ({ type: d.type, title: d.title, version: d.version, slug: d.slug }));
    const history = await db.execute(sql`
      select document_type, document_version, kind, created_at
      from public.privacy_acceptances
      where user_id = ${user.userId}
      order by created_at desc
      limit 50
    `);
    res.json({
      pending,
      acceptances: (history.rows as any[]).map((r) => ({
        documentType: r.document_type,
        version: Number(r.document_version),
        kind: r.kind,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao consultar situação do usuário");
    res.status(503).json({ error: "Privacidade indisponível no momento (migration 0021 aplicada?)." });
  }
});

router.post("/privacy/me/acknowledge", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const body = (req.body ?? {}) as { documents?: Array<{ type?: unknown; version?: unknown; hash?: unknown }> };
  const items = Array.isArray(body.documents) ? body.documents : [];
  if (items.length === 0) {
    res.status(400).json({ error: "Informe os documentos confirmados." });
    return;
  }
  const types: PrivacyDocumentType[] = [];
  for (const it of items) {
    const doc = PRIVACY_DOCUMENTS.find((d) => d.type === it.type);
    // A confirmação só vale para a versão e o texto exatamente exibidos ao usuário.
    if (!doc || Number(it.version) !== doc.version || String(it.hash ?? "") !== hashPrivacyDocument(doc)) {
      res.status(409).json({ error: "O documento foi atualizado. Recarregue a página e leia a versão vigente." });
      return;
    }
    types.push(doc.type);
  }
  try {
    const versions = await acceptedVersions(user.userId);
    const stillPending = new Set(pendingPrivacyDocuments(versions).map((d) => d.type));
    const toRecord = types.filter((t) => stillPending.has(t));
    if (toRecord.length > 0) {
      await recordPrivacyAcceptance({ userId: user.userId, kind: "CIENCIA", ip: clientIp(req), types: toRecord });
    }
    res.json({ ok: true, recorded: toRecord.length });
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao registrar ciência");
    res.status(503).json({ error: "Não foi possível registrar a ciência agora." });
  }
});

// Portabilidade/acesso (art. 18, II e V): cópia dos dados do próprio usuário, gerada sob demanda.
router.get("/privacy/me/export", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  if (limited(exportLimiter, `export:${user.userId}`, res)) return;
  try {
    const [profile, tickets, messages, ratings, acceptances, requests, security] = await Promise.all([
      db.execute(sql`
        select id, name, email, cpf, birth_date, contact_phone, prefers_whatsapp, prefers_telegram,
               establishment, uf, municipality, role::text as role, status::text as status,
               (avatar_data is not null) as has_avatar, terms_accepted, terms_accepted_at,
               created_at, last_login_at, updated_at
        from public.users where id = ${user.userId}
      `),
      db.execute(sql`
        select t.id, t.title, t.description, t.type::text as type, t.hardware_subtype, t.status::text as status,
               t.priority::text as priority, t.uf, t.municipality, t.establishment, t.created_at, t.updated_at,
               coalesce((select json_agg(json_build_object('arquivo', a.filename, 'tipo', a.mime_type, 'tamanho', a.size, 'enviadoEm', a.created_at) order by a.id)
                         from public.ticket_attachments a where a.ticket_id = t.id), '[]'::json) as anexos
        from public.tickets t
        where t.created_by_id = ${user.userId}
        order by t.id desc
        limit 2000
      `),
      db.execute(sql`
        select m.ticket_id, m.message, m.created_at
        from public.messages m
        where m.sender_id = ${user.userId}
        order by m.id desc
        limit 5000
      `),
      db.execute(sql`
        select r.ticket_id, r.rating, r.reason_low_rating, r.comment, r.created_at
        from public.ticket_ratings r
        join public.tickets t on t.id = r.ticket_id
        where t.created_by_id = ${user.userId}
        order by r.id desc
      `),
      db.execute(sql`
        select document_type, document_version, kind, ip, created_at
        from public.privacy_acceptances where user_id = ${user.userId} order by created_at
      `),
      db.execute(sql`
        select protocol, request_type, description, status, response, created_at, resolved_at
        from public.privacy_requests where user_id = ${user.userId} order by id
      `),
      db.execute(sql`
        select event_type, ip, user_agent, created_at
        from public.security_audit_logs
        where actor_user_id = ${user.userId} or target_user_id = ${user.userId}
        order by id desc
        limit 500
      `),
    ]);

    const payload = {
      geradoEm: new Date().toISOString(),
      observacao:
        "Cópia dos seus dados pessoais no SuporteTI (LGPD, art. 18). Senhas não são incluídas porque são guardadas apenas cifradas. "
        + "Os arquivos anexados aparecem listados; o conteúdo pode ser baixado em cada chamado.",
      cadastro: profile.rows[0] ?? null,
      chamadosAbertos: tickets.rows,
      mensagensEnviadas: messages.rows,
      avaliacoes: ratings.rows,
      aceitesPrivacidade: acceptances.rows,
      solicitacoesPrivacidade: requests.rows,
      eventosDeSeguranca: security.rows,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="meus-dados-suporteti-${stamp}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(payload, null, 2));
    logger.info({ userId: user.userId }, "Privacidade: exportação de dados do titular");
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao exportar dados");
    res.status(503).json({ error: "Não foi possível gerar a cópia dos dados agora." });
  }
});

router.get("/privacy/me/requests", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  try {
    const rows = await db.execute(sql`
      select id, protocol, request_type, description, status, response, created_at, updated_at, resolved_at
      from public.privacy_requests where user_id = ${user.userId} order by id desc limit 100
    `);
    res.json(rows.rows.map(mapRequest));
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao listar solicitações");
    res.status(503).json({ error: "Solicitações indisponíveis no momento." });
  }
});

router.post("/privacy/me/requests", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const body = (req.body ?? {}) as { type?: unknown; description?: unknown };
  const type = String(body.type ?? "") as PrivacyRequestType;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!(type in PRIVACY_REQUEST_TYPES)) {
    res.status(400).json({ error: "Tipo de solicitação inválido." });
    return;
  }
  if (description.length < 10 || description.length > DESCRIPTION_MAX) {
    res.status(400).json({ error: `Descreva o pedido (entre 10 e ${DESCRIPTION_MAX} caracteres).` });
    return;
  }
  if (limited(requestLimiter, `req:${user.userId}`, res)) return;
  try {
    const created = await db.transaction(async (tx) => {
      const ins = await tx.execute(sql`
        insert into public.privacy_requests (protocol, user_id, request_type, description)
        values (${`TMP-${user.userId}-${Date.now()}`}, ${user.userId}, ${type}, ${description})
        returning id, created_at
      `);
      const row = ins.rows[0] as { id: number; created_at: string };
      const protocol = buildPrivacyProtocol(Number(row.id), new Date(row.created_at));
      const upd = await tx.execute(sql`
        update public.privacy_requests set protocol = ${protocol} where id = ${row.id}
        returning id, protocol, request_type, description, status, response, created_at, updated_at, resolved_at
      `);
      await tx.execute(sql`
        insert into public.privacy_request_history (request_id, actor_user_id, from_status, to_status, note)
        values (${row.id}, ${user.userId}, null, 'ABERTA', 'Solicitação registrada pelo titular')
      `);
      return upd.rows[0];
    });
    // Log sem o texto livre do pedido (pode conter dados pessoais).
    logger.info({ userId: user.userId, type, protocol: (created as any).protocol }, "Privacidade: nova solicitação do titular");
    res.status(201).json(mapRequest(created));
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao registrar solicitação");
    res.status(503).json({ error: "Não foi possível registrar a solicitação agora." });
  }
});

// Administração das solicitações: somente ADMIN.
router.get("/privacy/requests", requireAuth, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const status = String(req.query.status ?? "");
  const statusFilter = (PRIVACY_REQUEST_STATUS as readonly string[]).includes(status) ? status : null;
  try {
    const rows = await db.execute(sql`
      select r.id, r.protocol, r.request_type, r.description, r.status, r.response, r.created_at, r.updated_at, r.resolved_at,
             u.id as user_id, u.name as user_name, u.email as user_email,
             rb.name as resolved_by_name
      from public.privacy_requests r
      left join public.users u on u.id = r.user_id
      left join public.users rb on rb.id = r.resolved_by_id
      where (${statusFilter}::text is null or r.status = ${statusFilter})
      order by (r.status in ('ABERTA','EM_ANALISE')) desc, r.id desc
      limit 300
    `);
    res.json(rows.rows.map((r: any) => ({
      ...mapRequest(r),
      user: r.user_id ? { id: Number(r.user_id), name: r.user_name, email: r.user_email } : null,
      resolvedByName: r.resolved_by_name ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao listar solicitações (admin)");
    res.status(503).json({ error: "Solicitações indisponíveis no momento." });
  }
});

router.patch("/privacy/requests/:id", requireAuth, requireRoles("ADMIN"), async (req, res): Promise<void> => {
  const user = req.user!;
  const id = Number.parseInt(String(req.params.id), 10);
  const body = (req.body ?? {}) as { status?: unknown; response?: unknown };
  const status = String(body.status ?? "") as PrivacyRequestStatus;
  const response = typeof body.response === "string" ? body.response.trim() : "";
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }
  if (!(PRIVACY_REQUEST_STATUS as readonly string[]).includes(status) || status === "ABERTA") {
    res.status(400).json({ error: "Status inválido." });
    return;
  }
  const finishing = status === "CONCLUIDA" || status === "INDEFERIDA";
  if (finishing && response.length < 10) {
    res.status(400).json({ error: "Para concluir ou indeferir, escreva a resposta/justificativa ao titular." });
    return;
  }
  if (response.length > RESPONSE_MAX) {
    res.status(400).json({ error: `Resposta muito longa (máx. ${RESPONSE_MAX} caracteres).` });
    return;
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const cur = await tx.execute(sql`select id, status from public.privacy_requests where id = ${id} for update`);
      const row = cur.rows[0] as { id: number; status: PrivacyRequestStatus } | undefined;
      if (!row) return null;
      if (row.status === "CONCLUIDA" || row.status === "INDEFERIDA") return "closed" as const;
      const upd = await tx.execute(sql`
        update public.privacy_requests
           set status = ${status},
               response = ${response || null},
               resolved_by_id = ${finishing ? user.userId : null},
               resolved_at = ${finishing ? sql`now()` : sql`null`},
               updated_at = now()
         where id = ${id}
        returning id, protocol, request_type, description, status, response, created_at, updated_at, resolved_at
      `);
      await tx.execute(sql`
        insert into public.privacy_request_history (request_id, actor_user_id, from_status, to_status, note)
        values (${id}, ${user.userId}, ${row.status}, ${status}, ${finishing ? "Resposta registrada" : "Em análise"})
      `);
      return upd.rows[0];
    });
    if (updated === null) {
      res.status(404).json({ error: "Solicitação não encontrada." });
      return;
    }
    if (updated === "closed") {
      res.status(409).json({ error: "Solicitação já encerrada; o histórico não pode ser alterado." });
      return;
    }
    logger.info({ actorUserId: user.userId, requestId: id, status }, "Privacidade: solicitação atualizada");
    res.json(mapRequest(updated));
  } catch (err) {
    logger.error({ err }, "Privacidade: falha ao atualizar solicitação");
    res.status(503).json({ error: "Não foi possível atualizar a solicitação agora." });
  }
});

function mapRequest(r: any) {
  return {
    id: Number(r.id),
    protocol: String(r.protocol),
    type: String(r.request_type),
    typeLabel: PRIVACY_REQUEST_TYPES[r.request_type as PrivacyRequestType] ?? String(r.request_type),
    description: String(r.description ?? ""),
    status: String(r.status),
    response: r.response ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at ?? null,
  };
}

export default router;
