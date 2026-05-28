import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TicketStatus, TicketPriority, TicketType } from "@workspace/api-client-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  [TicketStatus.OPEN]: { label: "Aberto", variant: "default" },
  [TicketStatus.IN_PROGRESS]: { label: "Em Andamento", variant: "secondary" },
  [TicketStatus.AWAITING_CUSTOMER]: { label: "Aguardando Cliente", variant: "outline" },
  [TicketStatus.RESOLVED]: { label: "Resolvido", variant: "success" },
  [TicketStatus.CLOSED]: { label: "Cancelado", variant: "outline" },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  [TicketPriority.LOW]: { label: "Baixa", className: "border-transparent bg-[var(--priority-low-bg)] text-[var(--priority-low-fg)]" },
  [TicketPriority.MEDIUM]: { label: "Média", className: "border-transparent bg-[var(--priority-medium-bg)] text-[var(--priority-medium-fg)]" },
  [TicketPriority.HIGH]: { label: "Alta", className: "border-transparent bg-[var(--priority-high-bg)] text-[var(--priority-high-fg)]" },
};

const typeConfig: Record<string, { label: string }> = {
  [TicketType.SOFTWARE]: { label: "Sistema" },
  [TicketType.HARDWARE]: { label: "Equipamentos" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, variant: "outline" };
  return (
    <Badge variant={config.variant as any} className="font-medium">
      {config.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const config = priorityConfig[priority] || { label: priority, className: "text-foreground border [border-color:var(--badge-outline)]" };
  return (
    <Badge variant="outline" className={cn("font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const config = typeConfig[type] || { label: type };
  return (
    <Badge variant="outline" className="font-medium bg-muted">
      {config.label}
    </Badge>
  );
}
