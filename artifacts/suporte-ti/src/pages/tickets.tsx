import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  useListTickets, 
  getListTicketsQueryKey,
  TicketStatus,
  TicketType,
  TicketPriority,
  ListTicketsParams
} from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge, TypeBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { PlusCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { filterAndSortTickets } from "@/lib/tickets-utils";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export default function Tickets() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<ListTicketsParams>({});
  const [userFilter, setUserFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "user" | "location" | "responsible">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: tickets, isLoading } = useListTickets(filters, {
    query: {
      queryKey: getListTicketsQueryKey(filters),
    }
  });

  const visibleTickets = useMemo(() => {
    return filterAndSortTickets(tickets ?? [], {
      userFilter,
      locationFilter,
      responsibleFilter,
      sortBy,
      sortDir,
    });
  }, [tickets, userFilter, locationFilter, responsibleFilter, sortBy, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chamados</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie e acompanhe as solicitações de suporte.
          </p>
        </div>
        <Button asChild>
          <Link href="/chamados/novo">
            <PlusCircle className="mr-2 h-4 w-4" />
            Abrir Chamado
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select 
                value={filters.status || "all"} 
                onValueChange={(v) => setFilters(f => ({ ...f, status: v === "all" ? undefined : v as TicketStatus }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value={TicketStatus.OPEN}>Aberto</SelectItem>
                  <SelectItem value={TicketStatus.IN_PROGRESS}>Em Andamento</SelectItem>
                  <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                  <SelectItem value={TicketStatus.CLOSED}>Fechado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo</label>
              <Select 
                value={filters.type || "all"} 
                onValueChange={(v) => setFilters(f => ({ ...f, type: v === "all" ? undefined : v as TicketType }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value={TicketType.SOFTWARE}>Software</SelectItem>
                  <SelectItem value={TicketType.HARDWARE}>Hardware</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Prioridade</label>
              <Select 
                value={filters.priority || "all"} 
                onValueChange={(v) => setFilters(f => ({ ...f, priority: v === "all" ? undefined : v as TicketPriority }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value={TicketPriority.LOW}>Baixa</SelectItem>
                  <SelectItem value={TicketPriority.MEDIUM}>Média</SelectItem>
                  <SelectItem value={TicketPriority.HIGH}>Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(user?.role === "ADMIN" || user?.role === "ANALYST") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">UF</label>
                <Select 
                  value={filters.uf || "all"} 
                  onValueChange={(v) => setFilters(f => ({ ...f, uf: v === "all" ? undefined : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todas as UFs" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as UFs</SelectItem>
                    {UFS.map(uf => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Filtrar por usuário</label>
              <Input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Nome do solicitante" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Filtrar por localização</label>
              <Input value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="UF ou Município" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Filtrar por responsável</label>
              <Input value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)} placeholder="Nome do responsável" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ordenar por</label>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">Data</SelectItem>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="location">Localização</SelectItem>
                  <SelectItem value="responsible">Responsável</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Ordem</label>
              <Select value={sortDir} onValueChange={(v) => setSortDir(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Crescente</SelectItem>
                  <SelectItem value="desc">Decrescente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : tickets === undefined ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">
                Não foi possível carregar os chamados. Verifique se a API está rodando e se o banco foi atualizado.
              </p>
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nenhum chamado encontrado com os filtros atuais.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleTickets.map((ticket) => (
                <Link key={ticket.id} href={`/chamados/${ticket.id}`} className="block">
                  <div className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">#{ticket.id} — {ticket.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {ticket.createdBy?.name ?? "—"} • {ticket.uf} - {ticket.municipality}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <StatusBadge status={ticket.status} />
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <TypeBadge type={ticket.type} />
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(ticket.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>

                    <div className="mt-3 pt-3 border-t text-sm">
                      <p className="text-xs text-muted-foreground">Responsável</p>
                      <p className="font-medium truncate">{ticket.assignedTo?.name ?? "Não atribuído"}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
