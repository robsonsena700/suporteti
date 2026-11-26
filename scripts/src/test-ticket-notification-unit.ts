import assert from "node:assert/strict";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod: any = await import(pathToFileURL(path.resolve(__dirname, "../../artifacts/api-server/src/lib/ticket-notification-email.ts")).href);
const { describeEvent, planRecipients, summarizeEvents, buildTicketNotificationEmail } = mod;

const t0 = new Date("2026-11-26T13:14:00Z");
let id = 100;
const ev = (p: any) => ({ id: id++, ticketId: 1807, type: "MESSAGE_SENT", actorUserId: 7, actorName: "Robson Sena", detail: null, toAssignedToName: null, createdAt: t0, ...p });

// ---- descricao das acoes ----
assert.deepEqual(describeEvent(ev({ type: "MESSAGE_SENT", detail: "segue usuario e senha: 123 / abc" })), [
  { kind: "MESSAGE", text: "Robson Sena enviou uma nova mensagem." },
]);
const upd = describeEvent(ev({ type: "TICKET_UPDATED", detail: "status: OPEN -> IN_PROGRESS\npriority: LOW -> HIGH\ndescription: texto antigo -> texto novo com CPF 123\ntitle: a -> b" }));
assert.deepEqual(upd.map((a: any) => a.text), [
  "Robson Sena alterou o status de Aberto para Em Andamento.",
  "Robson Sena alterou a prioridade de Baixa para Alta.",
  "Robson Sena atualizou: descrição, título.",
]);
assert.deepEqual(describeEvent(ev({ type: "TICKET_UPDATED", detail: "status: RESOLVED -> RESOLVED" })), []);
assert.deepEqual(describeEvent(ev({ type: "TICKET_UPDATED", detail: "assign: denied -> Gestor (targetUserId=5)" })), []);
assert.equal(describeEvent(ev({ type: "MANUAL_ASSIGN", toAssignedToName: "Jackson Lima" }))[0].text, "Robson Sena atribuiu o chamado a Jackson Lima.");
assert.equal(describeEvent(ev({ type: "AUTO_ASSIGN", toAssignedToName: "Robson Sena" }))[0].text, "Robson Sena assumiu o atendimento.");
assert.equal(describeEvent(ev({ type: "ATTACHMENT_ADDED" }))[0].kind, "ATTACHMENT");

// ---- destinatarios ----
const users = new Map([
  [1, { id: 1, name: "José Cirineu Carneiro Neto", email: "jose@x.com.br", role: "USER", status: "ACTIVE" }],
  [7, { id: 7, name: "Robson Sena", email: "robson@x.com.br", role: "ADMIN", status: "ACTIVE" }],
  [9, { id: 9, name: "Colab Inativo", email: "c@x.com.br", role: "ANALYST", status: "INACTIVE" }],
  [10, { id: 10, name: "Colab Sem Email", email: "invalido", role: "ANALYST", status: "ACTIVE" }],
  [11, { id: 11, name: "Ana Coord", email: "ana@x.com.br", role: "COORDINATOR", status: "ACTIVE" }],
]);
const ticket = { id: 1807, title: "Falha no sistema <Hospital> & Cia", type: "SOFTWARE", priority: "HIGH", status: "IN_PROGRESS", createdById: 1, assignedToId: 7 };

// Acao do responsavel (7): avisa solicitante (1) e colaboradora ativa (11); nao avisa o proprio 7, inativo (9) nem e-mail invalido (10)
const staffEvents = [ev({ type: "TICKET_UPDATED", detail: "status: OPEN -> IN_PROGRESS" }), ev({ type: "MESSAGE_SENT" })];
const plan1 = planRecipients({ ticket, events: staffEvents, users, collaboratorIds: [9, 10, 11] });
assert.deepEqual(plan1.map((p: any) => p.user.id).sort((a: number, b: number) => a - b), [1, 11]);
assert.equal(plan1.find((p: any) => p.user.id === 1).isRequester, true);

// Mensagem do solicitante (1): avisa responsavel e colaboradora, nao o solicitante
const plan2 = planRecipients({ ticket, events: [ev({ actorUserId: 1, actorName: "José Cirineu Carneiro Neto" })], users, collaboratorIds: [11] });
assert.deepEqual(plan2.map((p: any) => p.user.id).sort((a: number, b: number) => a - b), [7, 11]);

// Lote misto: cada um recebe so as acoes dos OUTROS
const mixed = [ev({ actorUserId: 1, actorName: "José" }), ev({ actorUserId: 7, actorName: "Robson Sena" })];
const plan3 = planRecipients({ ticket, events: mixed, users, collaboratorIds: [] });
assert.deepEqual(plan3.find((p: any) => p.user.id === 1).events.map((e: any) => e.actorUserId), [7]);
assert.deepEqual(plan3.find((p: any) => p.user.id === 7).events.map((e: any) => e.actorUserId), [1]);

// So acoes sem efeito (ex.: tentativa de atribuicao negada) -> ninguem e avisado
assert.equal(planRecipients({ ticket, events: [ev({ type: "TICKET_UPDATED", detail: "assign: denied -> Gestor" })], users, collaboratorIds: [] }).length, 0);

// ---- resumo: mensagens agrupadas ----
const sum = summarizeEvents([ev({}), ev({}), ev({ type: "TICKET_UPDATED", detail: "status: IN_PROGRESS -> RESOLVED" })]);
assert.deepEqual(sum.kinds, ["MESSAGE", "STATUS"]);
assert.equal(sum.lines[0], "Robson Sena enviou 2 novas mensagens.");

// ---- e-mail ----
const secret = "segue usuario e senha: 12424350426 / 13976";
const mail = buildTicketNotificationEmail({
  recipient: users.get(1), isRequester: true, ticket,
  events: [ev({ type: "TICKET_UPDATED", detail: "status: OPEN -> IN_PROGRESS" }), ev({ type: "MESSAGE_SENT", detail: secret })],
  ticketUrl: "https://suporteti.sotechsaude.com.br/chamados/1807", qrCid: "qr-chamado",
});
assert.equal(mail.subject, "[SuporteTI] Chamado #1807 — Nova mensagem + Status");
assert.ok(mail.html.includes("Seu chamado #1807 recebeu uma nova interação"));
assert.ok(mail.html.includes("26/11/2026 às 10:14"), "data no fuso de Sao Paulo");
assert.ok(mail.html.includes("cid:qr-chamado"));
assert.ok(mail.html.includes("Falha no sistema &lt;Hospital&gt; &amp; Cia"), "titulo escapado");
assert.ok(!mail.html.includes("<Hospital>"));
assert.ok(!mail.html.includes("12424350426") && !mail.text.includes("12424350426"), "conteudo da mensagem nunca vai no e-mail");
assert.ok(mail.text.includes("https://suporteti.sotechsaude.com.br/chamados/1807"));
assert.match(mail.trackingId, /^ntf_1807_\d+$/);

const staffMail = buildTicketNotificationEmail({ recipient: users.get(11), isRequester: false, ticket, events: [ev({})], ticketUrl: "https://x/chamados/1807", qrCid: null });
assert.ok(staffMail.html.includes("O chamado #1807 recebeu uma nova interação"));
assert.ok(!staffMail.html.includes("cid:"));

if (process.env.PREVIEW_OUT) writeFileSync(process.env.PREVIEW_OUT, mail.html);
console.log("OK: test-ticket-notification-unit");
