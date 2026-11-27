import type { ReactNode } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TicketType, UserRole, type Ticket } from "@workspace/api-client-react";
import { Image as ImageIcon, MailCheck, Printer } from "lucide-react";
import { StatusBadge, PriorityBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/** Campos extras devolvidos pela API de listagem (ainda fora do contrato gerado pelo orval). */
export type TicketListItem = Ticket & {
  emailSentAt?: string | null;
  emailSentCount?: number | null;
  emailRequesterNotified?: boolean | null;
};

export function hasTicketEmailSent(t: TicketListItem): boolean {
  return (t.emailSentCount ?? 0) > 0 || Boolean(t.emailSentAt);
}

function formatDate(value: string | Date | null | undefined, pattern: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, pattern, { locale: ptBR });
}

export function describeTicketEmail(t: TicketListItem): string {
  const count = t.emailSentCount ?? 0;
  const when = formatDate(t.emailSentAt, "dd/MM/yyyy 'às' HH:mm");
  const total = count > 1 ? ` · ${count} avisos enviados` : "";
  const requester = t.emailRequesterNotified ? " · solicitante avisado" : "";
  return `E-mail enviado — último em ${when}${total}${requester}`;
}

export function TicketTypeChip({ type }: { type: string }) {
  const isSoftware = type === TicketType.SOFTWARE;
  const color = isSoftware ? "var(--series-software)" : "var(--series-hardware)";
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      {isSoftware ? "Sistema" : "Equipamentos"}
    </span>
  );
}

export function TicketEmailIndicator({ ticket }: { ticket: TicketListItem }) {
  if (!hasTicketEmailSent(ticket)) return null;
  const label = describeTicketEmail(ticket);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
    >
      <MailCheck className="h-3.5 w-3.5" />
    </span>
  );
}

type Props = {
  ticket: TicketListItem;
  variant?: "grid" | "kanban";
  onOpen?: () => void;
  onOpenImage?: (ticket: TicketListItem) => void;
  /** Conteúdo extra no rodapé (ex.: estrelas de avaliação). */
  footerExtra?: ReactNode;
  /** Ações extras ao lado de imprimir (ex.: menu "Mover para" no Kanban). */
  actions?: ReactNode;
};

/** Card de chamado compartilhado pelas visões Normal (Cards) e Kanban. */
export function TicketCard({ ticket, variant = "grid", onOpen, onOpenImage, footerExtra, actions }: Props) {
  const compact = variant === "kanban";
  const noCoordinator = ticket.ownerHasCoordinator === false;
  const imageCount = ticket.imageAttachmentsCount ?? 0;
  const location = [ticket.uf, ticket.municipality].filter(Boolean).join(" – ");

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors hover:bg-muted/30",
        compact ? "p-3" : "p-4",
        noCoordinator ? "border-orange-400/80 ring-1 ring-orange-400/20" : null,
      )}
    >
      <Link
        href={`/chamados/${ticket.id}`}
        draggable={false}
        onClick={onOpen}
        className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start justify-between gap-2">
          <p className={cn("min-w-0 truncate font-semibold", compact ? "text-[13px]" : "text-sm")} title={`#${ticket.id} — ${ticket.title}`}>
            #{ticket.id} — {ticket.title}
          </p>
          <div className="shrink-0">
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <div className="mt-1 flex items-start justify-between gap-2">
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="truncate" title={`${ticket.createdBy?.name ?? "—"} • ${location}`}>
              {ticket.createdBy?.name ?? "—"}
              {location ? ` • ${location}` : ""}
            </p>
            {ticket.establishment ? (
              <p className="mt-0.5 truncate" title={ticket.establishment}>{ticket.establishment}</p>
            ) : null}
          </div>
          <div className="shrink-0">
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>
        {noCoordinator || ticket.createdBy?.role === UserRole.GESTOR ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {noCoordinator ? (
              <span className="rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                Sem coordenador
              </span>
            ) : null}
            {ticket.createdBy?.role === UserRole.GESTOR ? (
              <span className="rounded-full border border-indigo-300/50 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                Chamado do Gestor associado
              </span>
            ) : null}
          </div>
        ) : null}
      </Link>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <TicketTypeChip type={ticket.type} />
          {imageCount > 0 ? (
            <button
              type="button"
              aria-label={`Visualizar imagem anexada (${imageCount})`}
              className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted/50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenImage?.(ticket);
              }}
            >
              <ImageIcon className="h-3 w-3" />
              imagem ({imageCount})
            </button>
          ) : null}
          {footerExtra}
        </div>
        <div className="flex items-center gap-1.5">
          <TicketEmailIndicator ticket={ticket} />
          <button
            type="button"
            aria-label={`Imprimir comprovante do chamado #${ticket.id}`}
            title="Imprimir comprovante"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(`/chamados/${ticket.id}/comprovante`, "_blank", "noopener,noreferrer");
            }}
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
          {actions}
          <span className="text-xs tabular-nums text-muted-foreground">{formatDate(ticket.createdAt, "dd/MM/yyyy")}</span>
        </div>
      </div>

      <div className="mt-2.5 border-t pt-2.5">
        <p className="text-[11px] text-muted-foreground">Responsável</p>
        <p className={cn("truncate font-medium", compact ? "text-[13px]" : "text-sm")}>{ticket.assignedTo?.name ?? "Não atribuído"}</p>
      </div>
    </div>
  );
}
