import { Badge } from "@/components/ui/badge";
import { TicketStatus, TicketPriority, TicketType } from "@workspace/api-client-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }> = {
  [TicketStatus.OPEN]: { label: "Aberto", variant: "default" },
  [TicketStatus.IN_PROGRESS]: { label: "Em Andamento", variant: "secondary" },
  [TicketStatus.RESOLVED]: { label: "Resolvido", variant: "success" },
  [TicketStatus.CLOSED]: { label: "Fechado", variant: "outline" },
};

const priorityConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  [TicketPriority.LOW]: { label: "Baixa", variant: "outline" },
  [TicketPriority.MEDIUM]: { label: "Média", variant: "secondary" },
  [TicketPriority.HIGH]: { label: "Alta", variant: "destructive" },
};

const typeConfig: Record<string, { label: string }> = {
  [TicketType.SOFTWARE]: { label: "Software" },
  [TicketType.HARDWARE]: { label: "Hardware" },
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
  const config = priorityConfig[priority] || { label: priority, variant: "outline" };
  return (
    <Badge variant={config.variant as any} className="font-medium">
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
