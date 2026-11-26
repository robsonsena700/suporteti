import { useMemo, useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import {
  PlusCircle, Ticket, Clock, CheckCircle2, XCircle, Star, Timer, Hourglass, RotateCcw, ArrowLeftRight,
} from "lucide-react";
import {
  useDashboardMetrics,
  useGetReportSummary,
  getGetReportSummaryQueryKey,
  type DashboardDays,
  type DashboardMetrics,
  type DashboardSegment,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge, StatusBadge, TypeBadge } from "@/components/ui/status-badge";

// ---------------------------------------------------------------------------
// Cores das series: variaveis CSS definidas em index.css (validadas p/ CVD).
const COLOR_SW = "var(--series-software)";
const COLOR_HW = "var(--series-hardware)";

const SEGMENT_LABEL: Record<DashboardSegment, string> = {
  ALL: "Todos",
  SOFTWARE: "Sistemas",
  HARDWARE: "Equipamentos",
};

const PRIORITY_LABEL: Record<string, string> = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${nf.format(Math.round(min))} min`;
  const h = min / 60;
  if (h < 48) return `${nf1.format(h)} h`;
  return `${nf1.format(h / 24)} d`;
}

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "—";
  return fmtMinutes(h * 60);
}

function SeriesDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: color }} />;
}

// Texto "X Sistemas · Y Equip." abaixo do numero quando o filtro e "Todos".
function SplitLine({ sw, hw, segment }: { sw: number; hw: number; segment: DashboardSegment }) {
  if (segment !== "ALL") return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><SeriesDot color={COLOR_SW} /> Sistemas {nf.format(sw)}</span>
      <span className="inline-flex items-center gap-1"><SeriesDot color={COLOR_HW} /> Equip. {nf.format(hw)}</span>
    </p>
  );
}

function StatCard(props: {
  title: string;
  icon: React.ReactNode;
  value: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <Card title={props.tooltip}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{props.title}</CardTitle>
        {props.icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{props.value}</div>
        {props.hint ? <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p> : null}
        {props.children}
      </CardContent>
    </Card>
  );
}

// Agrupa o grafico diario por semana quando o periodo e de 90 dias.
function useChartData(data: DashboardMetrics | undefined) {
  return useMemo(() => {
    if (!data) return [];
    const daily = data.daily;
    const toPoint = (label: string, items: typeof daily) => ({
      label,
      createdSoftware: items.reduce((a, d) => a + d.createdSoftware, 0),
      createdHardware: items.reduce((a, d) => a + d.createdHardware, 0),
      resolvedSoftware: items.reduce((a, d) => a + d.resolvedSoftware, 0),
      resolvedHardware: items.reduce((a, d) => a + d.resolvedHardware, 0),
    });
    if (daily.length <= 31) {
      return daily.map((d) => toPoint(
        daily.length <= 7
          ? format(parseISO(d.date), "EEE dd/MM", { locale: ptBR })
          : format(parseISO(d.date), "dd/MM"),
        [d],
      ));
    }
    const weeks: ReturnType<typeof toPoint>[] = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      weeks.push(toPoint(`${format(parseISO(chunk[0].date), "dd/MM")}`, chunk));
    }
    return weeks;
  }, [data]);
}

function ChartTooltip({ active, payload, label, segment }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows: Array<[string, string, number, number]> = [];
  if (segment !== "HARDWARE") rows.push(["Sistemas", COLOR_SW, p.createdSoftware, p.resolvedSoftware]);
  if (segment !== "SOFTWARE") rows.push(["Equipamentos", COLOR_HW, p.createdHardware, p.resolvedHardware]);
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {rows.map(([name, color, created, resolved]) => (
        <p key={name} className="flex items-center gap-2 tabular-nums">
          <SeriesDot color={color} />
          <span className="w-24">{name}</span>
          <span>{created} abertos · {resolved} resolvidos</span>
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [segment, setSegment] = useState<DashboardSegment>("ALL");
  const [days, setDays] = useState<DashboardDays>(30);

  const { data, isLoading, isError, refetch } = useDashboardMetrics(days);

  // Usuarios pendentes de aprovacao: so para ADMIN (antes aparecia para
  // coordenador com o total GERAL do sistema, fora do escopo dele).
  const isAdmin = user?.role === "ADMIN";
  const { data: summary } = useGetReportSummary(undefined, {
    query: { queryKey: getGetReportSummaryQueryKey(), enabled: isAdmin },
  });

  const chartData = useChartData(data);

  const counts = data?.statusCounts[segment];
  const sw = data?.statusCounts.SOFTWARE;
  const hw = data?.statusCounts.HARDWARE;
  const kpi = data?.kpis[segment];
  const ratings = data?.ratings?.[segment] ?? null;
  const periodLabel = `últimos ${days} dias`;

  const showSw = segment !== "HARDWARE";
  const showHw = segment !== "SOFTWARE";

  const recent = (data?.recent ?? []).filter((r) => segment === "ALL" || r.type === segment).slice(0, 6);
  const requesters = (data?.topRequesters ?? [])
    .map((r) => ({ ...r, value: segment === "ALL" ? r.total : segment === "SOFTWARE" ? r.software : r.hardware }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const assignees = (data?.assignees ?? [])
    .map((a) => ({ ...a, value: segment === "ALL" ? a.resolvedTotal : segment === "SOFTWARE" ? a.resolvedSoftware : a.resolvedHardware }))
    .filter((a) => a.value > 0 || a.activeNow > 0);

  const activeTotal = (data?.priorityActive ?? []).reduce(
    (acc, p) => acc + (showSw ? p.software : 0) + (showHw ? p.hardware : 0), 0,
  );
  const ratingTotal = ratings?.count ?? 0;

  return (
    <div className="space-y-6">
      {/* Cabecalho e filtros (uma linha, acima de tudo) */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Painel de Controle</h1>
          <p className="mt-1 text-muted-foreground">
            Bem-vindo de volta, {user?.name}. Métricas separadas entre Sistemas e Equipamentos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={segment}
            onValueChange={(v) => v && setSegment(v as DashboardSegment)}
            className="rounded-lg border bg-background p-1"
            aria-label="Tipo de chamado"
          >
            <ToggleGroupItem value="ALL" className="px-3 text-sm">Todos</ToggleGroupItem>
            <ToggleGroupItem value="SOFTWARE" className="gap-1.5 px-3 text-sm"><SeriesDot color={COLOR_SW} /> Sistemas</ToggleGroupItem>
            <ToggleGroupItem value="HARDWARE" className="gap-1.5 px-3 text-sm"><SeriesDot color={COLOR_HW} /> Equipamentos</ToggleGroupItem>
          </ToggleGroup>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as DashboardDays)}>
            <SelectTrigger className="w-[150px]" aria-label="Período"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          {user?.role !== "GESTOR" ? (
            <Button asChild>
              <Link href="/chamados/novo"><PlusCircle className="mr-2 h-4 w-4" />Abrir Chamado</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {isAdmin && summary?.pendingUsers ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
          <span className="font-medium text-destructive">{summary.pendingUsers} usuário(s) aguardando aprovação.</span>
        </div>
      ) : null}

      {isError ? (
        <Card>
          <CardContent className="flex items-center justify-between py-6">
            <span className="text-sm text-muted-foreground">Não foi possível carregar as métricas.</span>
            <Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      ) : null}

      {isLoading || !data || !counts || !kpi || !sw || !hw ? (
        isError ? null : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        )
      ) : (
        <>
          {/* Situacao atual */}
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <StatCard title="Abertos" icon={<Ticket className="h-4 w-4 text-muted-foreground" />} value={nf.format(counts.open)}
              hint={segment === "ALL" ? undefined : "Aguardando atendimento"}>
              <SplitLine sw={sw.open} hw={hw.open} segment={segment} />
            </StatCard>
            <StatCard title="Em Andamento" icon={<Clock className="h-4 w-4 text-muted-foreground" />} value={nf.format(counts.inProgress)}
              tooltip="Em andamento, aguardando cliente e em desenvolvimento"
              hint={segment === "ALL" ? undefined : "Inclui aguardando cliente e em desenvolvimento"}>
              <SplitLine sw={sw.inProgress} hw={hw.inProgress} segment={segment} />
            </StatCard>
            <StatCard title="Resolvidos" icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />} value={nf.format(counts.resolved)}
              hint={segment === "ALL" ? undefined : "Total histórico"}>
              <SplitLine sw={sw.resolved} hw={hw.resolved} segment={segment} />
            </StatCard>
            <StatCard title="Cancelados" icon={<XCircle className="h-4 w-4 text-muted-foreground" />} value={nf.format(counts.cancelled)}
              hint={segment === "ALL" ? undefined : "Total histórico"}>
              <SplitLine sw={sw.cancelled} hw={hw.cancelled} segment={segment} />
            </StatCard>
          </div>

          {/* Indicadores do periodo */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="1ª Resposta (mediana)"
              icon={<Timer className="h-4 w-4 text-muted-foreground" />}
              value={fmtMinutes(kpi.firstResponse.medianMinutes)}
              tooltip="Tempo entre a abertura e a primeira mensagem da equipe (admin, analista ou coordenador). Mediana: metade dos chamados foi respondida mais rápido que isso."
              hint={`Média ${fmtMinutes(kpi.firstResponse.avgMinutes)} · ${nf.format(kpi.firstResponse.sample)} chamados · ${periodLabel}`}
            >
              {segment === "ALL" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sistemas {fmtMinutes(data.kpis.SOFTWARE.firstResponse.medianMinutes)} · Equip. {fmtMinutes(data.kpis.HARDWARE.firstResponse.medianMinutes)}
                </p>
              ) : null}
            </StatCard>
            <StatCard
              title="Resolução (mediana)"
              icon={<Hourglass className="h-4 w-4 text-muted-foreground" />}
              value={fmtHours(kpi.resolution.medianHours)}
              tooltip="Da abertura até o chamado ser marcado como Resolvido (registro da auditoria), para os resolvidos no período."
              hint={`Média ${fmtHours(kpi.resolution.avgHours)} · ${nf.format(kpi.resolution.sample)} resolvidos · ${periodLabel}`}
            >
              {segment === "ALL" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sistemas {fmtHours(data.kpis.SOFTWARE.resolution.medianHours)} · Equip. {fmtHours(data.kpis.HARDWARE.resolution.medianHours)}
                </p>
              ) : null}
            </StatCard>
            <StatCard
              title="Entradas x Saídas"
              icon={<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />}
              value={`${nf.format(kpi.createdInPeriod)} / ${nf.format(kpi.resolvedInPeriod)}`}
              tooltip="Chamados abertos no período / chamados resolvidos no período."
              hint={`Abertos / resolvidos · ${periodLabel}`}
            >
              <p className="mt-2 text-xs text-muted-foreground">
                {kpi.createdInPeriod > 0
                  ? `Razão resolução/abertura: ${pct.format(kpi.resolvedInPeriod / kpi.createdInPeriod)}`
                  : "Sem aberturas no período"}
              </p>
            </StatCard>
            <StatCard
              title="Taxa de Reabertura"
              icon={<RotateCcw className="h-4 w-4 text-muted-foreground" />}
              value={kpi.reopen.rate == null ? "—" : pct.format(kpi.reopen.rate)}
              tooltip="Dos chamados abertos no período que já foram resolvidos ou cancelados, quantos voltaram a ficar ativos."
              hint={`${nf.format(kpi.reopen.reopened)} de ${nf.format(kpi.reopen.resolved)} finalizados · ${periodLabel}`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Grafico diario */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Abertura de chamados</CardTitle>
                <CardDescription>
                  Chamados abertos {days === 90 ? "por semana" : "por dia"} · {periodLabel}. Passe o mouse para ver os resolvidos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[260px] w-full" role="img" aria-label={`Gráfico de chamados abertos ${days === 90 ? "por semana" : "por dia"}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} barGap={2} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={8} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={40} />
                      <Tooltip content={<ChartTooltip segment={segment} />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-foreground">{value}</span>} />
                      {showSw ? <Bar dataKey="createdSoftware" name="Sistemas" fill={COLOR_SW} radius={[4, 4, 0, 0]} maxBarSize={28} /> : null}
                      {showHw ? <Bar dataKey="createdHardware" name="Equipamentos" fill={COLOR_HW} radius={[4, 4, 0, 0]} maxBarSize={28} /> : null}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Criticidade */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Criticidade dos chamados ativos</CardTitle>
                <CardDescription>{nf.format(activeTotal)} chamados ativos agora, por prioridade</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {data.priorityActive.map((p) => {
                  const s = showSw ? p.software : 0;
                  const h = showHw ? p.hardware : 0;
                  const total = s + h;
                  const width = activeTotal > 0 ? (total / activeTotal) * 100 : 0;
                  return (
                    <div key={p.priority} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <PriorityBadge priority={p.priority} />
                        <span className="tabular-nums">
                          <span className="font-semibold">{nf.format(total)}</span>
                          {segment === "ALL" ? <span className="text-muted-foreground"> ({nf.format(p.software)} Sist. · {nf.format(p.hardware)} Equip.)</span> : null}
                        </span>
                      </div>
                      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted" title={`${PRIORITY_LABEL[p.priority]}: ${p.software} Sistemas, ${p.hardware} Equipamentos`}>
                        <div className="flex h-full gap-[2px]" style={{ width: `${width}%` }}>
                          {s > 0 ? <div className="h-full rounded-full" style={{ flex: s, background: COLOR_SW }} /> : null}
                          {h > 0 ? <div className="h-full rounded-full" style={{ flex: h, background: COLOR_HW }} /> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <p className="flex gap-4 border-t pt-3 text-xs text-muted-foreground">
                  {showSw ? <span className="inline-flex items-center gap-1"><SeriesDot color={COLOR_SW} /> Sistemas</span> : null}
                  {showHw ? <span className="inline-flex items-center gap-1"><SeriesDot color={COLOR_HW} /> Equipamentos</span> : null}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Chamados por usuario */}
            {data.visibility.showRequesters ? (
              <Card className={data.visibility.showRatings ? "lg:col-span-3" : "lg:col-span-5"}>
                <CardHeader>
                  <CardTitle>Chamados por usuário</CardTitle>
                  <CardDescription>Quem mais abriu chamados · {periodLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  {requesters.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado aberto no período.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Solicitante</TableHead>
                          {segment === "ALL" ? <TableHead className="text-right">Sistemas</TableHead> : null}
                          {segment === "ALL" ? <TableHead className="text-right">Equip.</TableHead> : null}
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requesters.slice(0, 8).map((r) => (
                          <TableRow key={r.userId}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            {segment === "ALL" ? <TableCell className="text-right tabular-nums">{r.software}</TableCell> : null}
                            {segment === "ALL" ? <TableCell className="text-right tabular-nums">{r.hardware}</TableCell> : null}
                            <TableCell className="text-right font-semibold tabular-nums">{r.value}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {/* Avaliacao */}
            {data.visibility.showRatings && ratings ? (
              <Card className={data.visibility.showRequesters ? "lg:col-span-2" : "lg:col-span-5"}>
                <CardHeader>
                  <CardTitle>Avaliação dos atendimentos</CardTitle>
                  <CardDescription>
                    {user?.role === "ANALYST" ? "Chamados atribuídos a você" : user?.role === "USER" ? "Seus chamados" : "Chamados que você acompanha"} · {periodLabel}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-end justify-between rounded-lg bg-muted/50 p-4">
                    <div className="flex items-baseline gap-2">
                      <Star className="h-6 w-6 self-center text-amber-500" aria-hidden />
                      <span className="text-4xl font-bold tabular-nums">{ratings.avg == null ? "—" : nf1.format(ratings.avg)}</span>
                      <span className="text-sm text-muted-foreground">/ 5</span>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p><span className="font-semibold text-foreground">{nf.format(ratings.count)}</span> avaliações</p>
                      <p>{ratings.coverage == null ? "—" : pct.format(ratings.coverage)} dos resolvidos</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {[5, 4, 3, 2, 1].map((n) => {
                      const c = ratings.distribution[n - 1];
                      const w = ratingTotal > 0 ? (c / ratingTotal) * 100 : 0;
                      return (
                        <div key={n} className="flex items-center gap-2 text-xs" title={`${c} avaliação(ões) com nota ${n}`}>
                          <span className="w-6 tabular-nums text-muted-foreground">{n}★</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
                          </div>
                          <span className="w-8 text-right tabular-nums">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                  {ratings.coverage != null && ratings.coverage < 0.2 ? (
                    <p className="text-xs text-muted-foreground">
                      Poucos chamados avaliados: a média pode não representar o atendimento como um todo.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Desempenho por responsavel */}
          {data.visibility.showAssignees ? (
            <Card>
              <CardHeader>
                <CardTitle>Desempenho por responsável</CardTitle>
                <CardDescription>Resolvidos e tempo médio de resolução · {periodLabel}. "Em aberto" é a fila atual.</CardDescription>
              </CardHeader>
              <CardContent>
                {assignees.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado atribuído no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Responsável</TableHead>
                        {segment === "ALL" ? <TableHead className="text-right">Resolvidos Sist.</TableHead> : null}
                        {segment === "ALL" ? <TableHead className="text-right">Resolvidos Equip.</TableHead> : null}
                        <TableHead className="text-right">Resolvidos</TableHead>
                        <TableHead className="text-right">Tempo médio</TableHead>
                        <TableHead className="text-right">Em aberto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignees.map((a) => (
                        <TableRow key={a.userId}>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          {segment === "ALL" ? <TableCell className="text-right tabular-nums">{a.resolvedSoftware}</TableCell> : null}
                          {segment === "ALL" ? <TableCell className="text-right tabular-nums">{a.resolvedHardware}</TableCell> : null}
                          <TableCell className="text-right font-semibold tabular-nums">{a.value}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtHours(a.avgResolutionHours)}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.activeNow}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {segment !== "ALL" ? (
                  <p className="mt-2 text-xs text-muted-foreground">Tempo médio e "Em aberto" consideram os dois tipos.</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Atividade recente */}
          <Card>
            <CardHeader>
              <CardTitle>Atividade recente</CardTitle>
              <CardDescription>Últimos chamados atualizados{segment === "ALL" ? "" : ` · ${SEGMENT_LABEL[segment]}`}</CardDescription>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma atividade recente.</p>
              ) : (
                <ul className="divide-y">
                  {recent.map((r) => (
                    <li key={r.ticketId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/chamados/${r.ticketId}`} className="truncate font-medium hover:underline">
                            #{r.ticketId} — {r.title}
                          </Link>
                          <TypeBadge type={r.type} />
                          <PriorityBadge priority={r.priority} />
                          <StatusBadge status={r.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {r.requesterName ?? "—"}
                          {r.assigneeName ? ` · Responsável: ${r.assigneeName}` : " · Sem responsável"}
                          {" · atualizado em "}
                          {format(new Date(r.updatedAt), "dd/MM, HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      <div className="shrink-0 text-xs tabular-nums text-muted-foreground sm:text-right">
                        {r.resolutionHours != null
                          ? <>Resolvido em <span className="font-medium text-foreground">{fmtHours(r.resolutionHours)}</span></>
                          : r.firstResponseMinutes != null
                            ? <>1ª resposta em <span className="font-medium text-foreground">{fmtMinutes(r.firstResponseMinutes)}</span></>
                            : "Aguardando 1ª resposta"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
