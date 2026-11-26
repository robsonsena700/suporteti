// Notificacao por e-mail de interacoes em chamados - parte PURA (sem banco),
// testada em scripts/src/test-ticket-notification-unit.ts. O agendamento e a
// leitura da auditoria ficam em ticket-notification-worker.ts.
//
// Privacidade (LGPD): o e-mail informa QUEM fez O QUE, mas nunca o conteudo
// das mensagens, valores de campos livres ou anexos. Interacoes podem conter
// dados pessoais e ate credenciais; o detalhe so e visto no sistema, com login.

export type NotificationAuditEvent = {
  id: number;
  ticketId: number;
  type: string;
  actorUserId: number;
  actorName: string;
  detail: string | null;
  toAssignedToName: string | null;
  createdAt: Date;
};

export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
};

export type NotificationTicket = {
  id: number;
  title: string;
  type: string;
  priority: string;
  status: string;
  createdById: number;
  assignedToId: number | null;
};

export type ActionKind = "MESSAGE" | "STATUS" | "ASSIGN" | "ATTACHMENT" | "COLLABORATOR" | "DETAILS";

export type DescribedAction = { kind: ActionKind; text: string };

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em Andamento",
  AWAITING_CUSTOMER: "Aguardando Cliente",
  IN_DEVELOPMENT: "Em Desenvolvimento",
  RESOLVED: "Resolvido",
  CLOSED: "Cancelado",
};
const PRIORITY_LABEL: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
const TYPE_LABEL: Record<string, string> = { SOFTWARE: "Sistema", HARDWARE: "Equipamento" };

// Campos livres: so o NOME do campo aparece no e-mail, nunca o valor.
const FIELD_LABEL: Record<string, string> = {
  title: "título",
  description: "descrição",
  dueAt: "prazo",
  uf: "localidade",
  municipality: "localidade",
  establishment: "estabelecimento",
  hardwareSubtype: "subtipo de equipamento",
};

const KIND_LABEL: Record<ActionKind, string> = {
  MESSAGE: "Nova mensagem",
  STATUS: "Status",
  ASSIGN: "Atribuição",
  ATTACHMENT: "Anexo",
  COLLABORATOR: "Colaboradores",
  DETAILS: "Dados do chamado",
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const priorityLabel = (p: string) => PRIORITY_LABEL[p] ?? p;
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

/** Traduz um registro de auditoria em linhas legiveis (sem conteudo sensivel). */
export function describeEvent(e: NotificationAuditEvent): DescribedAction[] {
  const who = e.actorName || "Alguém";
  switch (e.type) {
    case "MESSAGE_SENT":
      return [{ kind: "MESSAGE", text: `${who} enviou uma nova mensagem.` }];
    case "AUTO_ASSIGN":
      return [{ kind: "ASSIGN", text: e.toAssignedToName ? `${e.toAssignedToName} assumiu o atendimento.` : `${who} assumiu o atendimento.` }];
    case "MANUAL_ASSIGN":
      return [{ kind: "ASSIGN", text: e.toAssignedToName ? `${who} atribuiu o chamado a ${e.toAssignedToName}.` : `${who} alterou o responsável.` }];
    case "COLLABORATOR_ADDED":
      return [{ kind: "COLLABORATOR", text: `${who} adicionou um colaborador ao chamado.` }];
    case "COLLABORATOR_REMOVED":
      return [{ kind: "COLLABORATOR", text: `${who} removeu um colaborador do chamado.` }];
    case "ATTACHMENT_ADDED":
      return [{ kind: "ATTACHMENT", text: `${who} adicionou um anexo.` }];
    case "ATTACHMENT_REMOVED":
      return [{ kind: "ATTACHMENT", text: `${who} removeu um anexo.` }];
    case "TICKET_UPDATED":
      return describeTicketUpdate(who, e.detail);
    default:
      return [];
  }
}

function describeTicketUpdate(who: string, detail: string | null): DescribedAction[] {
  const out: DescribedAction[] = [];
  const otherFields = new Set<string>();
  for (const raw of String(detail ?? "").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z]+):\s*(.*?)\s*->\s*(.*?)\s*$/);
    if (!m) continue;
    const [, field, from, to] = m;
    if (from === to) continue;
    if (field === "assign") continue; // tentativa negada de atribuicao: nao e interacao
    if (field === "status") {
      out.push({ kind: "STATUS", text: `${who} alterou o status de ${statusLabel(from)} para ${statusLabel(to)}.` });
    } else if (field === "priority") {
      out.push({ kind: "DETAILS", text: `${who} alterou a prioridade de ${priorityLabel(from)} para ${priorityLabel(to)}.` });
    } else if (field === "type") {
      out.push({ kind: "DETAILS", text: `${who} alterou o tipo de ${typeLabel(from)} para ${typeLabel(to)}.` });
    } else if (field === "assignedToId") {
      // ja descrito pelo registro de atribuicao
    } else {
      otherFields.add(FIELD_LABEL[field] ?? "dados");
    }
  }
  if (otherFields.size > 0) {
    out.push({ kind: "DETAILS", text: `${who} atualizou: ${[...otherFields].join(", ")}.` });
  }
  return out;
}

/**
 * Quem deve ser avisado: solicitante, responsavel e colaboradores do chamado,
 * ativos e com e-mail. Cada pessoa recebe somente as acoes feitas por OUTRAS
 * pessoas (ninguem e avisado da propria acao).
 */
export function planRecipients(args: {
  ticket: NotificationTicket;
  events: NotificationAuditEvent[];
  users: Map<number, NotificationUser>;
  collaboratorIds: number[];
}): Array<{ user: NotificationUser; events: NotificationAuditEvent[]; isRequester: boolean }> {
  const ids = new Set<number>([args.ticket.createdById, ...args.collaboratorIds]);
  if (args.ticket.assignedToId != null) ids.add(args.ticket.assignedToId);

  const out: Array<{ user: NotificationUser; events: NotificationAuditEvent[]; isRequester: boolean }> = [];
  for (const id of ids) {
    const user = args.users.get(id);
    if (!user || user.status !== "ACTIVE" || !isPlausibleEmail(user.email)) continue;
    const events = args.events.filter((e) => e.actorUserId !== id && describeEvent(e).length > 0);
    if (events.length === 0) continue;
    out.push({ user, events, isRequester: id === args.ticket.createdById });
  }
  return out;
}

function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? "").trim());
}

/** Junta as acoes do lote: mensagens repetidas do mesmo autor viram uma linha. */
export function summarizeEvents(events: NotificationAuditEvent[]): { kinds: ActionKind[]; lines: string[]; actors: string[] } {
  const lines: string[] = [];
  const kinds = new Set<ActionKind>();
  const actors: string[] = [];
  const messageCount = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.actorName && !actors.includes(e.actorName)) actors.push(e.actorName);
    for (const a of describeEvent(e)) {
      kinds.add(a.kind);
      if (a.kind === "MESSAGE") {
        messageCount.set(e.actorName, (messageCount.get(e.actorName) ?? 0) + 1);
        continue;
      }
      if (!lines.includes(a.text)) lines.push(a.text);
    }
  }
  const msgLines = [...messageCount.entries()].map(([name, n]) =>
    n === 1 ? `${name || "Alguém"} enviou uma nova mensagem.` : `${name || "Alguém"} enviou ${n} novas mensagens.`,
  );
  const order: ActionKind[] = ["MESSAGE", "STATUS", "ASSIGN", "DETAILS", "ATTACHMENT", "COLLABORATOR"];
  return { kinds: order.filter((k) => kinds.has(k)), lines: [...msgLines, ...lines], actors };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(d: Date, timeZone: string): string {
  const s = new Intl.DateTimeFormat("pt-BR", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
  return s.replace(", ", " às ");
}

export function buildTicketNotificationEmail(args: {
  recipient: NotificationUser;
  isRequester: boolean;
  ticket: NotificationTicket;
  events: NotificationAuditEvent[];
  ticketUrl: string;
  /** cid da imagem do QR Code anexada ao e-mail (opcional) */
  qrCid?: string | null;
  timeZone?: string;
}): { subject: string; text: string; html: string; trackingId: string } {
  const { ticket, recipient } = args;
  const tz = args.timeZone ?? "America/Sao_Paulo";
  const { kinds, lines, actors } = summarizeEvents(args.events);
  const last = [...args.events].sort((a, b) => b.id - a.id)[0];
  const when = last ? formatDateTime(last.createdAt, tz) : "";
  const actionType = kinds.map((k) => KIND_LABEL[k]).join(" + ") || "Atualização";
  const who = actors.join(", ") || "Equipe SuporteTI";
  const ident = `#${ticket.id} · ${typeLabel(ticket.type)} (${priorityLabel(ticket.priority)})`;
  const headline = args.isRequester
    ? `Seu chamado #${ticket.id} recebeu uma nova interação`
    : `O chamado #${ticket.id} recebeu uma nova interação`;
  const trackingId = `ntf_${ticket.id}_${last?.id ?? 0}`;
  const subject = `[SuporteTI] Chamado #${ticket.id} — ${actionType}`;
  const firstName = recipient.name.split(/\s+/)[0] || recipient.name;

  const text =
    `Olá, ${firstName}.\n\n` +
    `${headline}: "${ticket.title}".\n\n` +
    `Identificação: ${ident}\n` +
    `Status atual: ${statusLabel(ticket.status)}\n` +
    `Data e hora: ${when}\n` +
    `Realizado por: ${who}\n\n` +
    `O que mudou:\n${lines.map((l) => `- ${l}`).join("\n")}\n\n` +
    `Para ver os detalhes, acesse: ${args.ticketUrl}\n\n` +
    `Por segurança, o conteúdo das mensagens e os anexos não são enviados por e-mail; ` +
    `ficam disponíveis apenas mediante login na plataforma SuporteTI.\n` +
    `ID de rastreio: ${trackingId}\n`;

  const navy = "#0b2447";
  const muted = "#5b6475";
  const qr = args.qrCid
    ? `<td width="150" valign="middle" align="center" style="padding:14px 14px 14px 0">` +
      `<img src="cid:${escapeHtml(args.qrCid)}" width="120" height="120" alt="QR Code do chamado #${ticket.id}" style="display:block;border:0;background:#fff;padding:6px;border-radius:8px"/>` +
      `<div style="font:600 12px Arial,Helvetica,sans-serif;color:${navy};margin-top:6px">#${ticket.id}</div></td>`
    : "";

  const html =
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f1f4f8">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f8;padding:24px 12px"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827">` +
    // cabecalho
    `<tr><td style="background:${navy};padding:18px 24px"><table role="presentation" width="100%"><tr>` +
    `<td style="font:700 20px Arial,Helvetica,sans-serif;color:#ffffff">SuporteTI</td>` +
    `<td align="right"><span style="display:inline-block;background:#1c3a63;color:#ffffff;font:600 13px Arial,Helvetica,sans-serif;padding:6px 10px;border-radius:6px">Chamado #${ticket.id}</span></td>` +
    `</tr></table></td></tr>` +
    // corpo
    `<tr><td style="padding:24px">` +
    `<span style="display:inline-block;background:#e0f2fe;color:#0c4a6e;font:600 12px Arial,Helvetica,sans-serif;padding:4px 10px;border-radius:999px">Atualização de Chamado · ${escapeHtml(actionType)}</span>` +
    `<h1 style="font:700 22px Arial,Helvetica,sans-serif;margin:14px 0 6px">${escapeHtml(headline)}</h1>` +
    `<p style="margin:0 0 18px;color:${muted};font-size:14px;line-height:1.5">Olá, <strong style="color:#111827">${escapeHtml(recipient.name)}</strong>. Houve uma atualização no atendimento da solicitação <em>"${escapeHtml(ticket.title)}"</em>.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;border:1px solid #e5e9f0;border-radius:10px"><tr>` +
    `<td width="50%" valign="top" style="padding:14px 16px;font-size:13px"><div style="color:${muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px">Identificação</div><div style="font-weight:700;margin-top:2px">${escapeHtml(ident)}</div>` +
    `<div style="color:${muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-top:12px">Data e hora</div><div style="font-weight:700;margin-top:2px">${escapeHtml(when)}</div></td>` +
    `<td width="50%" valign="top" style="padding:14px 16px;font-size:13px"><div style="color:${muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px">Status atual</div><div style="font-weight:700;margin-top:2px">${escapeHtml(statusLabel(ticket.status))}</div>` +
    `<div style="color:${muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-top:12px">Realizado por</div><div style="font-weight:700;margin-top:2px">${escapeHtml(who)}</div></td>` +
    `</tr></table>` +
    `<div style="border-left:3px solid ${navy};padding:2px 0 2px 14px;margin:20px 0">` +
    `<div style="color:${muted};font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Resumo da alteração</div>` +
    lines.map((l) => `<div style="font-size:14px;line-height:1.5">• ${escapeHtml(l)}</div>`).join("") +
    `</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;border:1px solid #e5e9f0;border-radius:10px"><tr>` +
    `<td valign="middle" style="padding:18px">` +
    `<a href="${escapeHtml(args.ticketUrl)}" style="display:inline-block;background:${navy};color:#ffffff;text-decoration:none;font:700 14px Arial,Helvetica,sans-serif;padding:12px 22px;border-radius:8px">Visualizar Chamado #${ticket.id}</a>` +
    `<p style="margin:10px 0 0;color:${muted};font-size:12px;line-height:1.5">${args.qrCid ? "Ou escaneie o QR Code ao lado para abrir o chamado no celular (requer login)." : "O acesso ao chamado requer login."}</p>` +
    `</td>${qr}</tr></table>` +
    `</td></tr>` +
    // rodape
    `<tr><td style="background:#f6f8fb;border-top:1px solid #e5e9f0;padding:16px 24px;color:${muted};font-size:12px;line-height:1.5">` +
    `Notificação automática do SuporteTI. Por segurança (LGPD), o conteúdo das mensagens e os anexos não são enviados por e-mail e ficam disponíveis apenas mediante login na plataforma.` +
    `<div style="font-family:Consolas,Menlo,monospace;margin-top:6px">ID de rastreio: ${escapeHtml(trackingId)}</div>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject, text, html, trackingId };
}
