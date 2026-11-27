// Rotina que envia por e-mail as interacoes em chamados.
//
// Como funciona: a cada ciclo (padrao 60s) le os registros novos da
// auditoria (ticket_audit_logs), agrupa por chamado e envia UM e-mail por
// destinatario com tudo o que mudou. Assim o envio nao atrasa as telas
// (roda fora da requisicao) e varias acoes seguidas (ex.: resolver + mensagem)
// viram um unico aviso. O progresso fica em ticket_notification_cursor
// (migration 0019), entao um reinicio nao reenvia nem perde avisos.
//
// Variaveis de ambiente:
//   TICKET_EMAIL_NOTIFICATIONS=false     desliga a rotina
//   TICKET_NOTIFY_INTERVAL_SECONDS=60    intervalo entre ciclos
//   TICKET_NOTIFY_SETTLE_SECONDS=30      espera antes de enviar (agrupa acoes)
//   TICKET_NOTIFY_REDIRECT_TO=email      TESTE: manda TODOS os avisos so para
//                                        este endereco (use com banco copiado
//                                        da producao para nao avisar usuarios reais)
// O envio usa o mesmo mailer da recuperacao de senha (MAIL_MODE/SMTP_*).

import { sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { sendEmail } from "./mailer";
import { recordTicketEmailDelivery } from "./ticket-email-deliveries";
import { getAppPublicUrl } from "./password-reset";
import {
  buildTicketNotificationEmail,
  planRecipients,
  type NotificationAuditEvent,
  type NotificationTicket,
  type NotificationUser,
} from "./ticket-notification-email";

const BATCH_LIMIT = 500;

function intEnv(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

let running = false;

/** Executa um ciclo. Exportada para teste/manual; normalmente chamada pelo agendador. */
export async function runTicketNotificationCycle(): Promise<{ events: number; emails: number; failures: number }> {
  const settle = intEnv("TICKET_NOTIFY_SETTLE_SECONDS", 30, 0);

  // Cursor: na primeira execucao comeca no registro mais recente (nao avisa
  // sobre o historico antigo).
  const cur = await db.execute(sql`select last_audit_id from public.ticket_notification_cursor where id = 1`);
  if (cur.rows.length === 0) {
    await db.execute(sql`
      insert into public.ticket_notification_cursor (id, last_audit_id)
      select 1, coalesce(max(id), 0) from public.ticket_audit_logs
      on conflict (id) do nothing
    `);
    logger.info("Notificacao de chamados: cursor iniciado no registro mais recente da auditoria");
    return { events: 0, emails: 0, failures: 0 };
  }
  const lastId = Number((cur.rows[0] as any).last_audit_id);

  const evRes = await db.execute(sql`
    select a.id, a.ticket_id, a.type::text as type, a.actor_user_id, a.detail, a.created_at,
           actor.name as actor_name, ta.name as to_assigned_to_name
    from public.ticket_audit_logs a
    join public.users actor on actor.id = a.actor_user_id
    left join public.users ta on ta.id = a.to_assigned_to_id
    where a.id > ${lastId}
      and a.created_at <= now() - make_interval(secs => ${settle})
    order by a.id
    limit ${BATCH_LIMIT}
  `);
  const events: NotificationAuditEvent[] = (evRes.rows as any[]).map((r) => ({
    id: Number(r.id),
    ticketId: Number(r.ticket_id),
    type: String(r.type),
    actorUserId: Number(r.actor_user_id),
    actorName: String(r.actor_name ?? ""),
    detail: r.detail ?? null,
    toAssignedToName: r.to_assigned_to_name ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at)),
  }));
  if (events.length === 0) return { events: 0, emails: 0, failures: 0 };

  let baseUrl: string;
  try {
    baseUrl = getAppPublicUrl();
  } catch (err) {
    // Sem URL publica nao da para montar o link; tenta de novo no proximo ciclo.
    logger.warn({ err }, "Notificacao de chamados: APP_PUBLIC_URL ausente/invalida; envio adiado");
    return { events: events.length, emails: 0, failures: 0 };
  }

  const byTicket = new Map<number, NotificationAuditEvent[]>();
  for (const e of events) {
    const list = byTicket.get(e.ticketId) ?? [];
    list.push(e);
    byTicket.set(e.ticketId, list);
  }

  let emails = 0;
  let failures = 0;
  for (const [ticketId, ticketEvents] of byTicket) {
    try {
      const tRes = await db.execute(sql`
        select id, title, type::text as type, priority::text as priority, status::text as status,
               created_by_id, assigned_to_id
        from public.tickets where id = ${ticketId}
      `);
      const tr = tRes.rows[0] as any;
      if (!tr) continue; // chamado removido
      const ticket: NotificationTicket = {
        id: Number(tr.id),
        title: String(tr.title ?? ""),
        type: String(tr.type),
        priority: String(tr.priority),
        status: String(tr.status),
        createdById: Number(tr.created_by_id),
        assignedToId: tr.assigned_to_id == null ? null : Number(tr.assigned_to_id),
      };

      const cRes = await db.execute(sql`select user_id from public.ticket_collaborators where ticket_id = ${ticketId}`);
      const collaboratorIds = (cRes.rows as any[]).map((r) => Number(r.user_id));

      const ids = [...new Set([ticket.createdById, ticket.assignedToId, ...collaboratorIds].filter((v): v is number => v != null))];
      const uRes = await db.execute(sql`
        select id, name, email, role::text as role, status::text as status
        from public.users where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `);
      const users = new Map<number, NotificationUser>(
        (uRes.rows as any[]).map((u) => [Number(u.id), { id: Number(u.id), name: String(u.name), email: String(u.email), role: String(u.role), status: String(u.status) }]),
      );

      const plan = planRecipients({ ticket, events: ticketEvents, users, collaboratorIds });
      if (plan.length === 0) continue;

      const ticketUrl = `${baseUrl}/chamados/${ticket.id}`;
      let qrPng: Buffer | null = null;
      try {
        qrPng = await QRCode.toBuffer(ticketUrl, { type: "png", width: 240, margin: 1, errorCorrectionLevel: "M" });
      } catch (err) {
        logger.warn({ err, ticketId }, "Notificacao de chamados: falha ao gerar QR Code (e-mail segue sem ele)");
      }

      for (const p of plan) {
        const mail = buildTicketNotificationEmail({
          recipient: p.user,
          isRequester: p.isRequester,
          ticket,
          events: p.events,
          ticketUrl,
          qrCid: qrPng ? "qr-chamado" : null,
          timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
        });
        const redirectTo = String(process.env.TICKET_NOTIFY_REDIRECT_TO ?? "").trim();
        try {
          await sendEmail({
            to: redirectTo || p.user.email,
            subject: redirectTo ? `[TESTE p/ ${p.user.email}] ${mail.subject}` : mail.subject,
            text: mail.text,
            html: mail.html,
            attachments: qrPng ? [{ filename: `chamado-${ticket.id}.png`, content: qrPng, contentType: "image/png", cid: "qr-chamado" }] : undefined,
          });
          emails++;
          await recordTicketEmailDelivery({ ticketId: ticket.id, recipientUserId: p.user.id, isRequester: p.isRequester });
        } catch (err) {
          failures++;
          logger.error({ err, ticketId, userId: p.user.id, trackingId: mail.trackingId }, "Notificacao de chamados: falha no envio");
        }
      }
    } catch (err) {
      failures++;
      logger.error({ err, ticketId }, "Notificacao de chamados: falha ao processar chamado");
    }
  }

  // Avanca o cursor mesmo com falhas de envio (registradas no log): uma falha
  // de SMTP nao pode travar a fila nem gerar reenvio em massa depois.
  const maxId = events[events.length - 1].id;
  await db.execute(sql`update public.ticket_notification_cursor set last_audit_id = ${maxId}, updated_at = now() where id = 1`);
  if (emails > 0 || failures > 0) {
    logger.info({ events: events.length, emails, failures }, "Notificacao de chamados: ciclo concluido");
  }
  return { events: events.length, emails, failures };
}

export function startTicketNotificationWorker(): () => void {
  if (String(process.env.TICKET_EMAIL_NOTIFICATIONS ?? "").toLowerCase() === "false") {
    logger.info("Notificacao de chamados por e-mail desligada (TICKET_EMAIL_NOTIFICATIONS=false)");
    return () => {};
  }
  const intervalMs = intEnv("TICKET_NOTIFY_INTERVAL_SECONDS", 60, 10) * 1000;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTicketNotificationCycle();
    } catch (err) {
      const code = (err as any)?.code;
      if (code === "42P01") {
        logger.error("Notificacao de chamados: tabela ticket_notification_cursor ausente (aplique a migration 0019)");
      } else {
        logger.error({ err }, "Notificacao de chamados: erro no ciclo");
      }
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 15_000);
  const handle = setInterval(() => void tick(), intervalMs);
  first.unref?.();
  handle.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(handle);
  };
}
