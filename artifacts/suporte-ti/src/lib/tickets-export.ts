// Exportação dos chamados filtrados na tela (CSV e impressão/PDF), feita no navegador:
// usa os dados já carregados, sem nova consulta ao servidor.

export type ExportableTicket = {
  id: number;
  title: string;
  status: string;
  priority: string;
  type: string;
  uf?: string | null;
  municipality?: string | null;
  establishment?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  createdBy?: { name?: string | null } | null;
  assignedTo?: { name?: string | null } | null;
  emailSentAt?: string | null;
  emailSentCount?: number | null;
};

export const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em Andamento",
  AWAITING_CUSTOMER: "Aguardando Cliente",
  IN_DEVELOPMENT: "Em Desenvolvimento",
  RESOLVED: "Resolvido",
  CLOSED: "Cancelado",
};
export const PRIORITY_LABELS: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" };
export const TYPE_LABELS: Record<string, string> = { SOFTWARE: "Sistema", HARDWARE: "Equipamentos" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDateTimeBR(value: string | Date | null | undefined, withTime = true): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

const COLUMNS: Array<{ header: string; value: (t: ExportableTicket) => string }> = [
  { header: "ID", value: (t) => String(t.id) },
  { header: "Título", value: (t) => t.title ?? "" },
  { header: "Status", value: (t) => STATUS_LABELS[t.status] ?? t.status },
  { header: "Prioridade", value: (t) => PRIORITY_LABELS[t.priority] ?? t.priority },
  { header: "Categoria", value: (t) => TYPE_LABELS[t.type] ?? t.type },
  { header: "Solicitante", value: (t) => t.createdBy?.name ?? "" },
  { header: "UF", value: (t) => t.uf ?? "" },
  { header: "Município", value: (t) => t.municipality ?? "" },
  { header: "Unidade", value: (t) => t.establishment ?? "" },
  { header: "Responsável", value: (t) => t.assignedTo?.name ?? "Não atribuído" },
  { header: "Aberto em", value: (t) => formatDateTimeBR(t.createdAt) },
  { header: "Atualizado em", value: (t) => formatDateTimeBR(t.updatedAt) },
  {
    header: "E-mail enviado",
    value: (t) => ((t.emailSentCount ?? 0) > 0 || t.emailSentAt ? `Sim${t.emailSentAt ? ` (${formatDateTimeBR(t.emailSentAt)})` : ""}` : "Não"),
  },
];

/** Célula CSV segura: neutraliza fórmulas (CSV injection) e aplica aspas quando preciso. */
export function csvCell(raw: string): string {
  let v = String(raw ?? "").replace(/\r?\n|\r/g, " ");
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return /[";]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV com ";" e BOM UTF-8, abre direto no Excel em português. */
export function buildTicketsCsv(rows: ExportableTicket[]): string {
  const lines = [COLUMNS.map((c) => csvCell(c.header)).join(";")];
  for (const t of rows) lines.push(COLUMNS.map((c) => csvCell(c.value(t))).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function escapeHtml(raw: string): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTicketsPrintHtml(rows: ExportableTicket[], meta: { title: string; filters: string[]; generatedAt: Date }): string {
  const head = COLUMNS.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const body = rows.length
    ? rows.map((t) => `<tr>${COLUMNS.map((c) => `<td>${escapeHtml(c.value(t))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${COLUMNS.length}" class="empty">Nenhum chamado com os filtros atuais.</td></tr>`;
  const filters = meta.filters.length ? meta.filters.map(escapeHtml).join(" · ") : "Sem filtros";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 10px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { color: #475569; margin: 0 0 10px; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: top; }
  th { background: #0f2a4a; color: #fff; font-weight: 600; }
  tr:nth-child(even) td { background: #f1f5f9; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .empty { text-align: center; color: #64748b; padding: 16px; }
</style></head><body>
<h1>${escapeHtml(meta.title)}</h1>
<p class="meta">${rows.length} chamado(s) · Gerado em ${escapeHtml(formatDateTimeBR(meta.generatedAt))} · ${filters}</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Abre o diálogo de impressão do navegador (onde dá para "Salvar como PDF") sem abrir pop-up. */
export function printHtml(html: string): boolean {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 60_000);
  }, 200);
  return true;
}

export function exportTimestamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
