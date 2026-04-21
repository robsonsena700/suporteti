import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityBadge, StatusBadge, TypeBadge } from "@/components/ui/status-badge";
import { TicketPriority, TicketStatus, TicketType } from "@workspace/api-client-react";

export default function PriorityPreview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Preview — Prioridades</h1>
        <p className="text-muted-foreground mt-1">
          Visualização das cores de prioridade aplicadas aos cards e badges.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-3">
              Chamado — Baixa
              <PriorityBadge priority={TicketPriority.LOW} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <StatusBadge status={TicketStatus.OPEN} />
              <TypeBadge type={TicketType.SOFTWARE} />
            </div>
            <div className="text-sm text-muted-foreground">
              Texto secundário para validar contraste em card.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-3">
              Chamado — Média
              <PriorityBadge priority={TicketPriority.MEDIUM} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <StatusBadge status={TicketStatus.IN_PROGRESS} />
              <TypeBadge type={TicketType.HARDWARE} />
            </div>
            <div className="text-sm text-muted-foreground">
              Texto secundário para validar contraste em card.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-3">
              Chamado — Alta
              <PriorityBadge priority={TicketPriority.HIGH} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <StatusBadge status={TicketStatus.RESOLVED} />
              <TypeBadge type={TicketType.SOFTWARE} />
            </div>
            <div className="text-sm text-muted-foreground">
              Texto secundário para validar contraste em card.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

