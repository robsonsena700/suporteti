import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export type TicketEmailSummary = { lastSentAt: string; count: number; requesterNotified: boolean };

let missingTableWarned = false;

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } } | null)?.code
    ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "42P01";
}

function warnMissingTable(): void {
  if (missingTableWarned) return;
  missingTableWarned = true;
  logger.warn("Tabela ticket_email_deliveries ausente (aplique a migration 0020); indicador de e-mail desativado");
}

/** Registra um aviso enviado com sucesso. Nunca lança: falha aqui não pode afetar o envio. */
export async function recordTicketEmailDelivery(args: { ticketId: number; recipientUserId: number | null; isRequester: boolean }): Promise<void> {
  try {
    await db.execute(sql`
      insert into public.ticket_email_deliveries (ticket_id, recipient_user_id, is_requester)
      values (${args.ticketId}, ${args.recipientUserId}, ${args.isRequester})
    `);
  } catch (err) {
    if (isMissingTable(err)) {
      warnMissingTable();
      return;
    }
    logger.warn({ err, ticketId: args.ticketId }, "Falha ao registrar envio de e-mail do chamado");
  }
}

/** Resumo de e-mails enviados por chamado (último envio, quantidade, se o solicitante foi avisado). */
export async function loadTicketEmailSummary(ticketIds: number[]): Promise<Map<number, TicketEmailSummary>> {
  const result = new Map<number, TicketEmailSummary>();
  const ids = [...new Set(ticketIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return result;
  try {
    const res = await db.execute(sql`
      select ticket_id,
             max(sent_at) as last_sent_at,
             count(*)::int as total,
             bool_or(is_requester) as requester_notified
      from public.ticket_email_deliveries
      where ticket_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      group by ticket_id
    `);
    for (const row of res.rows as Array<Record<string, unknown>>) {
      const last = row.last_sent_at instanceof Date ? row.last_sent_at.toISOString() : String(row.last_sent_at);
      result.set(Number(row.ticket_id), {
        lastSentAt: last,
        count: Number(row.total ?? 0),
        requesterNotified: row.requester_notified === true,
      });
    }
  } catch (err) {
    if (isMissingTable(err)) warnMissingTable();
    else logger.warn({ err }, "Falha ao carregar resumo de e-mails dos chamados");
  }
  return result;
}
