import { useAuth } from "@/lib/auth";
import { 
  useGetReportSummary, 
  useGetRecentActivity,
  getGetReportSummaryQueryKey,
  getGetRecentActivityQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { PlusCircle, Ticket, Clock, CheckCircle2, XCircle, Star } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Dashboard() {
  const { user } = useAuth();

  const { data: summary, isLoading: isLoadingSummary } = useGetReportSummary({
    query: {
      queryKey: getGetReportSummaryQueryKey(),
    }
  });

  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity({
    query: {
      queryKey: getGetRecentActivityQueryKey(),
    }
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Painel de Controle</h1>
          <p className="text-muted-foreground mt-1">
            Bem-vindo de volta, {user?.name}. Aqui está o resumo das atividades.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/chamados/novo">
            <PlusCircle className="mr-2 h-5 w-5" />
            Abrir Chamado
          </Link>
        </Button>
      </div>

      {isLoadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Abertos</CardTitle>
              <Ticket className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.openTickets || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Aguardando atendimento</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
              <Clock className="h-4 w-4 text-secondary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.inProgressTickets || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Sendo resolvidos</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Resolvidos</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.resolvedTickets || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Aguardando cancelamento</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cancelados</CardTitle>
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary?.closedTickets || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Histórico completo</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Atividade Recente</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-6">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-center">
                    <div className="ml-4 space-y-1">
                      <p className="text-sm font-medium leading-none">
                        <Link href={`/chamados/${item.ticketId}`} className="hover:underline">
                          {item.ticketTitle}
                        </Link>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.userName} - {item.action} • {format(new Date(item.createdAt), "dd 'de' MMM, HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma atividade recente encontrada.
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Desempenho Geral</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <Star className="h-4 w-4 rounded-sm ring-2 ring-[#87CEEB] ring-offset-1 ring-offset-background text-amber-500" />
                Avaliação Média
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">
                  {summary?.avgRating ? summary.avgRating.toFixed(1) : "-"}
                </span>
                <span className="text-sm text-muted-foreground">/ 5.0</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Tempo Médio de Resolução</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">
                  {summary?.avgResolutionHours ? Math.round(summary.avgResolutionHours) : "-"}
                </span>
                <span className="text-sm text-muted-foreground">horas</span>
              </div>
            </div>
            {(user?.role === "ADMIN" || user?.role === "COORDINATOR") && (
              <div className="space-y-2 pt-4 border-t">
                <p className="text-sm font-medium text-muted-foreground">Usuários do Sistema</p>
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-semibold">{summary?.totalUsers || 0}</span>
                  {summary?.pendingUsers ? (
                    <span className="text-sm font-medium text-destructive bg-destructive/10 px-2 py-1 rounded-full">
                      {summary.pendingUsers} pendentes
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
