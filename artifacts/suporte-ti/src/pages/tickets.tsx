import { useState } from "react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export default function Tickets() {
  const { user } = useAuth();
  const [filters, setFilters] = useState<ListTicketsParams>({});

  const { data: tickets, isLoading } = useListTickets(filters, {
    query: {
      queryKey: getListTicketsQueryKey(filters),
    }
  });

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
        </CardContent>
      </Card>

      <Card>
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : tickets?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nenhum chamado encontrado com os filtros atuais.
                  </TableCell>
                </TableRow>
              ) : (
                tickets?.map((ticket) => (
                  <TableRow key={ticket.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium">
                      <Link href={`/chamados/${ticket.id}`} className="block">
                        #{ticket.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/chamados/${ticket.id}`} className="block hover:underline">
                        {ticket.title}
                        <div className="text-xs text-muted-foreground mt-1">
                          {ticket.municipality} - {ticket.uf}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ticket.status} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={ticket.priority} />
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={ticket.type} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(ticket.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
