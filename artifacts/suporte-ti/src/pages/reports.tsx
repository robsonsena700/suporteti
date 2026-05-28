import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useGetReportSummary,
  useGetTicketsByStatus,
  useGetTicketsByRegion,
  useGetTicketsByType,
  useGetReportsUsersStats,
  useGetReportsTickets,
  useGetReportsTicketsTrends,
  getGetReportSummaryQueryKey,
  getGetTicketsByStatusQueryKey,
  getGetTicketsByRegionQueryKey,
  getGetTicketsByTypeQueryKey,
  getGetReportsUsersStatsQueryKey,
  getGetReportsTicketsQueryKey,
  getGetReportsTicketsTrendsQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

const COLORS = ['#1B3B6E', '#2B5B9E', '#3B7BCE', '#4B9BFE', '#5BBBFE'];
const REPORTS_DATE_RANGE_KEY = "suporte-ti:reports:date-range:v1";
const REPORTS_CARDS_STATE_KEY = "suporte-ti:reports:cards-state:v1";

type PersistedDateRange = { from: string | null; to: string | null };
type ReportsTicketStatus = "OPEN" | "IN_PROGRESS" | "AWAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type ReportsTicketType = "SOFTWARE" | "HARDWARE";
type ReportsTicketPriority = "LOW" | "MEDIUM" | "HIGH";
type ProfessionalProfile = "analistas" | "coordenadores";
type PersistedCardsState = {
  selectedUserId: number | null;
  rankingOrder: "volume" | "resolution" | "satisfaction";
  professionalProfile?: ProfessionalProfile;
  tableStatus: ReportsTicketStatus | null;
  tableType: ReportsTicketType | null;
  tablePriority: ReportsTicketPriority | null;
  tablePage: number;
  tablePageSize: number;
};

type ProfessionalRankingItem = {
  position: number;
  positionChange: number | null;
  user: { id: number; name: string; email: string; role: "ANALYST" | "COORDINATOR" | "USER" };
  totalTickets: number;
  avgResolutionHours: number | null;
  avgRating: number | null;
  score: number;
};

type ProfessionalRankingResponse = {
  profile: "ANALYST" | "COORDINATOR" | "USER";
  from: string | null;
  to: string | null;
  generatedAt: string;
  items: ProfessionalRankingItem[];
};

const PROFESSIONAL_RANKING_CACHE_KEY = "suporte-ti:reports:professional-ranking:v1";

export default function Reports() {
  const { user } = useAuth();
  const autoApplyTimerRef = useRef<number | null>(null);
  const [draftFrom, setDraftFrom] = useState<Date | null>(null);
  const [draftTo, setDraftTo] = useState<Date | null>(null);
  const [appliedFrom, setAppliedFrom] = useState<Date | null>(null);
  const [appliedTo, setAppliedTo] = useState<Date | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [overviewExportError, setOverviewExportError] = useState<string | null>(null);
  const [overviewExporting, setOverviewExporting] = useState<null | "pdf" | "csv" | "xlsx">(null);
  const [ticketsExportError, setTicketsExportError] = useState<string | null>(null);
  const [ticketsExporting, setTicketsExporting] = useState<null | "pdf" | "csv" | "xlsx">(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [rankingOrder, setRankingOrder] = useState<"volume" | "resolution" | "satisfaction">("volume");
  const [professionalProfile, setProfessionalProfile] = useState<ProfessionalProfile>("analistas");
  const [tableStatus, setTableStatus] = useState<ReportsTicketStatus | null>(null);
  const [tableType, setTableType] = useState<ReportsTicketType | null>(null);
  const [tablePriority, setTablePriority] = useState<ReportsTicketPriority | null>(null);
  const [tablePage, setTablePage] = useState<number>(1);
  const [tablePageSize, setTablePageSize] = useState<number>(10);

  const normalizeFrom = useCallback((d: Date) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  }, []);

  const normalizeTo = useCallback((d: Date) => {
    const out = new Date(d);
    out.setHours(23, 59, 59, 999);
    return out;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(REPORTS_DATE_RANGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedDateRange;
        const from = typeof parsed?.from === "string" ? new Date(parsed.from) : null;
        const to = typeof parsed?.to === "string" ? new Date(parsed.to) : null;
        const fromOk = from && Number.isFinite(from.getTime()) ? from : null;
        const toOk = to && Number.isFinite(to.getTime()) ? to : null;
        setDraftFrom(fromOk);
        setDraftTo(toOk);
        setAppliedFrom(fromOk);
        setAppliedTo(toOk);
      }

      const cardsRaw = window.localStorage.getItem(REPORTS_CARDS_STATE_KEY);
      if (cardsRaw) {
        const parsedCards = JSON.parse(cardsRaw) as PersistedCardsState;
        if (typeof parsedCards?.selectedUserId === "number" || parsedCards?.selectedUserId === null) {
          setSelectedUserId(parsedCards.selectedUserId);
        }
        if (parsedCards?.rankingOrder === "volume" || parsedCards?.rankingOrder === "resolution" || parsedCards?.rankingOrder === "satisfaction") {
          setRankingOrder(parsedCards.rankingOrder);
        }
        if (parsedCards?.professionalProfile === "analistas" || parsedCards?.professionalProfile === "coordenadores") {
          setProfessionalProfile(parsedCards.professionalProfile);
        }
        if (parsedCards?.tableStatus === "OPEN" || parsedCards?.tableStatus === "IN_PROGRESS" || parsedCards?.tableStatus === "AWAITING_CUSTOMER" || parsedCards?.tableStatus === "RESOLVED" || parsedCards?.tableStatus === "CLOSED" || parsedCards?.tableStatus === null) {
          setTableStatus(parsedCards.tableStatus);
        }
        if (parsedCards?.tableType === "SOFTWARE" || parsedCards?.tableType === "HARDWARE" || parsedCards?.tableType === null) {
          setTableType(parsedCards.tableType);
        }
        if (parsedCards?.tablePriority === "LOW" || parsedCards?.tablePriority === "MEDIUM" || parsedCards?.tablePriority === "HIGH" || parsedCards?.tablePriority === null) {
          setTablePriority(parsedCards.tablePriority);
        }
        if (typeof parsedCards?.tablePage === "number" && Number.isFinite(parsedCards.tablePage) && parsedCards.tablePage > 0) setTablePage(parsedCards.tablePage);
        if (typeof parsedCards?.tablePageSize === "number" && Number.isFinite(parsedCards.tablePageSize) && parsedCards.tablePageSize > 0) setTablePageSize(parsedCards.tablePageSize);
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    if (!draftFrom || !draftTo) {
      setValidationError(null);
      return;
    }
    if (draftTo.getTime() < draftFrom.getTime()) {
      setValidationError("A data final não pode ser anterior à data inicial.");
      return;
    }
    setValidationError(null);
  }, [draftFrom, draftTo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (validationError) return;

    if (autoApplyTimerRef.current) {
      window.clearTimeout(autoApplyTimerRef.current);
      autoApplyTimerRef.current = null;
    }

    autoApplyTimerRef.current = window.setTimeout(() => {
      setAppliedFrom(draftFrom);
      setAppliedTo(draftTo);
      try {
        const payload: PersistedDateRange = {
          from: draftFrom ? normalizeFrom(draftFrom).toISOString() : null,
          to: draftTo ? normalizeTo(draftTo).toISOString() : null,
        };
        window.localStorage.setItem(REPORTS_DATE_RANGE_KEY, JSON.stringify(payload));
      } catch {
      }
    }, 200);

    return () => {
      if (autoApplyTimerRef.current) {
        window.clearTimeout(autoApplyTimerRef.current);
        autoApplyTimerRef.current = null;
      }
    };
  }, [draftFrom, draftTo, normalizeFrom, normalizeTo, validationError]);

  const reportParams = useMemo(() => {
    const from = appliedFrom ? normalizeFrom(appliedFrom).toISOString() : undefined;
    const to = appliedTo ? normalizeTo(appliedTo).toISOString() : undefined;
    return { from, to };
  }, [appliedFrom, appliedTo, normalizeFrom, normalizeTo]);

  const summaryQuery = useGetReportSummary(reportParams, {
    query: {
      queryKey: getGetReportSummaryQueryKey(reportParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const statusQuery = useGetTicketsByStatus(reportParams, {
    query: {
      queryKey: getGetTicketsByStatusQueryKey(reportParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const regionQuery = useGetTicketsByRegion(reportParams, {
    query: {
      queryKey: getGetTicketsByRegionQueryKey(reportParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const typeQuery = useGetTicketsByType(reportParams, {
    query: {
      queryKey: getGetTicketsByTypeQueryKey(reportParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const isFetchingAny = summaryQuery.isFetching || statusQuery.isFetching || regionQuery.isFetching || typeQuery.isFetching;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: PersistedCardsState = {
        selectedUserId,
        rankingOrder,
        professionalProfile,
        tableStatus,
        tableType,
        tablePriority,
        tablePage,
        tablePageSize,
      };
      window.localStorage.setItem(REPORTS_CARDS_STATE_KEY, JSON.stringify(payload));
    } catch {
    }
  }, [professionalProfile, rankingOrder, selectedUserId, tablePage, tablePageSize, tablePriority, tableStatus, tableType]);

  const labelStatus = useCallback((value: unknown): string => {
    if (value === "OPEN") return "Aberto";
    if (value === "IN_PROGRESS") return "Em andamento";
    if (value === "AWAITING_CUSTOMER") return "Aguardando cliente";
    if (value === "RESOLVED") return "Resolvido";
    if (value === "CLOSED") return "Cancelado";
    return String(value ?? "—");
  }, []);

  const labelType = useCallback((value: unknown): string => {
    if (value === "SOFTWARE") return "Sistema";
    if (value === "HARDWARE") return "Equipamentos";
    return String(value ?? "—");
  }, []);

  const statusChartData = useMemo(() => {
    return (statusQuery.data ?? []).map((r) => ({
      ...r,
      label: labelStatus((r as any).status),
    }));
  }, [labelStatus, statusQuery.data]);

  const typeChartData = useMemo(() => {
    return (typeQuery.data ?? []).map((r) => ({
      ...r,
      label: labelType((r as any).type),
    }));
  }, [labelType, typeQuery.data]);

  const usersStatsQuery = useGetReportsUsersStats(reportParams, {
    query: {
      queryKey: getGetReportsUsersStatsQueryKey(reportParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const professionalRankingQueryKey = useMemo(() => {
    return ["reports-professional-ranking", professionalProfile, reportParams.from ?? null, reportParams.to ?? null] as const;
  }, [professionalProfile, reportParams.from, reportParams.to]);

  const professionalRankingCacheKey = useMemo(() => {
    return `${professionalProfile}::${reportParams.from ?? ""}::${reportParams.to ?? ""}`;
  }, [professionalProfile, reportParams.from, reportParams.to]);

  const professionalRankingCached = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(PROFESSIONAL_RANKING_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { key: string; savedAt: number; payload: ProfessionalRankingResponse };
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.key !== professionalRankingCacheKey) return null;
      return parsed.payload;
    } catch {
      return null;
    }
  }, [professionalRankingCacheKey]);

  const professionalRankingQuery = useQuery({
    queryKey: professionalRankingQueryKey,
    queryFn: async (): Promise<ProfessionalRankingResponse> => {
      const params = new URLSearchParams();
      if (reportParams.from) params.set("from", reportParams.from);
      if (reportParams.to) params.set("to", reportParams.to);
      const url = `/api/ranking/${professionalProfile}${params.toString() ? `?${params.toString()}` : ""}`;
      return customFetch<ProfessionalRankingResponse>(url, { method: "GET", responseType: "json" });
    },
    enabled: Boolean(user),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 25_000,
    retry: 1,
  });

  const professionalRankingErrorMessage = useMemo(() => {
    const err = professionalRankingQuery.error as unknown;
    if (!professionalRankingQuery.isError) return null;
    if (err instanceof ApiError) {
      const detail = (err.data as any)?.error;
      return detail ? String(detail) : "Dados de ranking indisponíveis no momento.";
    }
    return (err as any)?.message || "Dados de ranking indisponíveis no momento.";
  }, [professionalRankingQuery.error, professionalRankingQuery.isError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!professionalRankingQuery.data) return;
    try {
      window.localStorage.setItem(
        PROFESSIONAL_RANKING_CACHE_KEY,
        JSON.stringify({ key: professionalRankingCacheKey, savedAt: Date.now(), payload: professionalRankingQuery.data }),
      );
    } catch {
    }
  }, [professionalRankingCacheKey, professionalRankingQuery.data]);

  useEffect(() => {
    setTablePage(1);
  }, [appliedFrom, appliedTo, tablePriority, tableStatus, tableType, tablePageSize]);

  useEffect(() => {
    const firstUserId = usersStatsQuery.data?.[0]?.user?.id;
    if (selectedUserId == null && typeof firstUserId === "number") {
      setSelectedUserId(firstUserId);
    }
  }, [selectedUserId, usersStatsQuery.data]);

  const selectedUserStats = useMemo(() => {
    if (!usersStatsQuery.data || selectedUserId == null) return null;
    return usersStatsQuery.data.find((r) => r.user.id === selectedUserId) ?? null;
  }, [selectedUserId, usersStatsQuery.data]);

  const usersStatsRanking = useMemo(() => {
    const rows = usersStatsQuery.data ?? [];
    if (rows.length === 0) return [];

    const totals = rows.map((r) => r.totalTickets);
    const times = rows.map((r) => r.avgResolutionHours).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const ratings = rows.map((r) => r.avgRating).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const minTotal = totals.length ? Math.min(...totals) : 0;
    const maxTotal = totals.length ? Math.max(...totals) : 0;
    const minTime = times.length ? Math.min(...times) : 0;
    const maxTime = times.length ? Math.max(...times) : 0;
    const minRating = ratings.length ? Math.min(...ratings) : 0;
    const maxRating = ratings.length ? Math.max(...ratings) : 0;

    const toNorm = (value: number, min: number, max: number) => (max === min ? 1 : (value - min) / (max - min));
    const toNormInverse = (value: number, min: number, max: number) => (max === min ? 1 : (max - value) / (max - min));

    const ranked = rows.map((r) => {
      const vol = toNorm(r.totalTickets, minTotal, maxTotal);
      const timeValue = r.avgResolutionHours == null ? maxTime : r.avgResolutionHours;
      const time = toNormInverse(timeValue, minTime, maxTime);
      const ratingValue = r.avgRating == null ? minRating : r.avgRating;
      const sat = toNorm(ratingValue, minRating, maxRating);
      const score = 0.4 * vol + 0.35 * time + 0.25 * sat;
      return { ...r, score };
    });

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets;
      const at = a.avgResolutionHours ?? Number.POSITIVE_INFINITY;
      const bt = b.avgResolutionHours ?? Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      const ar = a.avgRating ?? -1;
      const br = b.avgRating ?? -1;
      if (ar !== br) return br - ar;
      return a.user.name.localeCompare(b.user.name, "pt-BR");
    });

    return ranked.slice(0, 10).map((r, idx) => ({
      position: idx + 1,
      user: r.user,
      totalTickets: r.totalTickets,
      avgResolutionHours: r.avgResolutionHours,
      avgRating: r.avgRating,
      score: Number(r.score.toFixed(6)),
      openTickets: r.openTickets,
      inProgressTickets: r.inProgressTickets,
      resolvedTickets: r.resolvedTickets,
      closedTickets: r.closedTickets,
    }));
  }, [usersStatsQuery.data]);

  const ticketsParams = useMemo(() => {
    return {
      ...reportParams,
      status: tableStatus ?? undefined,
      type: tableType ?? undefined,
      priority: tablePriority ?? undefined,
      page: tablePage,
      pageSize: tablePageSize,
    };
  }, [reportParams, tablePage, tablePageSize, tablePriority, tableStatus, tableType]);

  const ticketsQuery = useGetReportsTickets(ticketsParams, {
    query: {
      queryKey: getGetReportsTicketsQueryKey(ticketsParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const trendsParams = useMemo(() => {
    return {
      ...reportParams,
      status: tableStatus ?? undefined,
      type: tableType ?? undefined,
      priority: tablePriority ?? undefined,
    };
  }, [reportParams, tablePriority, tableStatus, tableType]);

  const trendsQuery = useGetReportsTicketsTrends(trendsParams, {
    query: {
      queryKey: getGetReportsTicketsTrendsQueryKey(trendsParams),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  });

  const trendChartData = useMemo(() => {
    const created = trendsQuery.data?.created ?? [];
    const updated = trendsQuery.data?.updated ?? [];
    const map = new Map<string, { day: string; created: number; updated: number }>();
    created.forEach((p) => {
      map.set(p.day, { day: p.day, created: p.count, updated: 0 });
    });
    updated.forEach((p) => {
      const existing = map.get(p.day);
      if (existing) {
        existing.updated = p.count;
      } else {
        map.set(p.day, { day: p.day, created: 0, updated: p.count });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [trendsQuery.data]);

  const applyFilter = useCallback(() => {
    if (draftFrom && draftTo && draftTo.getTime() < draftFrom.getTime()) {
      setValidationError("A data final não pode ser anterior à data inicial.");
      return;
    }
    setValidationError(null);

    if (typeof window !== "undefined" && autoApplyTimerRef.current) {
      window.clearTimeout(autoApplyTimerRef.current);
      autoApplyTimerRef.current = null;
    }
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);

    if (typeof window !== "undefined") {
      try {
        const payload: PersistedDateRange = {
          from: draftFrom ? normalizeFrom(draftFrom).toISOString() : null,
          to: draftTo ? normalizeTo(draftTo).toISOString() : null,
        };
        window.localStorage.setItem(REPORTS_DATE_RANGE_KEY, JSON.stringify(payload));
      } catch {
      }
    }
  }, [draftFrom, draftTo, normalizeFrom, normalizeTo]);

  const clearFilter = useCallback(() => {
    if (typeof window !== "undefined" && autoApplyTimerRef.current) {
      window.clearTimeout(autoApplyTimerRef.current);
      autoApplyTimerRef.current = null;
    }
    setDraftFrom(null);
    setDraftTo(null);
    setAppliedFrom(null);
    setAppliedTo(null);
    setValidationError(null);
    setOverviewExportError(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(REPORTS_DATE_RANGE_KEY);
      } catch {
      }
    }
  }, []);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const nav = window.navigator as any;
    if (nav && typeof nav.msSaveOrOpenBlob === "function") {
      nav.msSaveOrOpenBlob(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const readApiError = useCallback(async (resp: Response): Promise<string> => {
    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await resp.json().catch(() => null);
      const message = data && typeof data === "object" && "error" in data ? (data as any).error : null;
      if (typeof message === "string" && message.trim()) return message;
    }
    const text = await resp.text().catch(() => "");
    return text.trim() || `Falha na operação (${resp.status})`;
  }, []);

  const createPrintTarget = useCallback(() => {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (win) {
      return {
        writeAndPrint: (html: string) => {
          win.document.open();
          win.document.write(html);
          win.document.close();
          win.focus();
          setTimeout(() => win.print(), 150);
        },
      };
    }

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const iframeWin = iframe.contentWindow;
    if (!iframeWin) {
      iframe.remove();
      return null;
    }

    return {
      writeAndPrint: (html: string) => {
        iframeWin.document.open();
        iframeWin.document.write(html);
        iframeWin.document.close();
        iframeWin.focus();
        setTimeout(() => iframeWin.print(), 150);
        setTimeout(() => iframe.remove(), 2_000);
      },
    };
  }, []);

  const buildExportTimestamp = useCallback(() => {
    return format(new Date(), "yyyyMMdd_HHmmss");
  }, []);

  const buildOverviewExportParams = useCallback((extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (reportParams.from) params.set("from", reportParams.from);
    if (reportParams.to) params.set("to", reportParams.to);
    params.set("order", rankingOrder);
    if (tableStatus) params.set("status", tableStatus);
    if (tableType) params.set("type", tableType);
    if (tablePriority) params.set("priority", tablePriority);
    if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
    return params;
  }, [rankingOrder, reportParams.from, reportParams.to, tablePriority, tableStatus, tableType]);

  const exportOverviewDownload = useCallback(async (formatKind: "pdf" | "csv" | "xlsx") => {
    if (!user) {
      setOverviewExportError("Você precisa estar autenticado para exportar.");
      return;
    }
    setOverviewExportError(null);
    setOverviewExporting(formatKind);
    try {
      const ts = buildExportTimestamp();
      const params = buildOverviewExportParams({ format: formatKind });
      const resp = (await customFetch(`/api/reports/export?${params.toString()}`, { method: "GET" })) as Response;
      if (!resp.ok) {
        setOverviewExportError(await readApiError(resp));
        return;
      }
      const blob = await resp.blob();
      const ext = formatKind === "pdf" ? "pdf" : formatKind === "xlsx" ? "xlsx" : "csv";
      downloadBlob(blob, `relatorios_${ts}.${ext}`);
    } catch {
      setOverviewExportError("Falha ao exportar. Tente novamente.");
    } finally {
      setOverviewExporting(null);
    }
  }, [buildExportTimestamp, buildOverviewExportParams, downloadBlob, readApiError, user]);

  const exportOverviewPrint = useCallback(async (alsoDownloadPdf: boolean) => {
    if (!user) {
      setOverviewExportError("Você precisa estar autenticado para exportar.");
      return;
    }
    setOverviewExportError(null);
    setOverviewExporting("pdf");
    const target = createPrintTarget();
    if (!target) {
      setOverviewExportError("Não foi possível abrir a impressão no navegador. Verifique as permissões de pop-up.");
      setOverviewExporting(null);
      return;
    }
    try {
      const ts = buildExportTimestamp();
      const printParams = buildOverviewExportParams({ format: "print" });
      const resp = (await customFetch(`/api/reports/export?${printParams.toString()}`, { method: "GET" })) as Response;
      if (!resp.ok) {
        setOverviewExportError(await readApiError(resp));
        return;
      }
      const html = await resp.text();
      target.writeAndPrint(html);

      if (alsoDownloadPdf) {
        const pdfParams = buildOverviewExportParams({ format: "pdf" });
        const pdfResp = (await customFetch(`/api/reports/export?${pdfParams.toString()}`, { method: "GET" })) as Response;
        if (pdfResp.ok) {
          const pdfBlob = await pdfResp.blob();
          downloadBlob(pdfBlob, `relatorios_${ts}.pdf`);
        }
      }
    } catch {
      setOverviewExportError("Falha ao imprimir/exportar. Tente novamente.");
    } finally {
      setOverviewExporting(null);
    }
  }, [buildExportTimestamp, buildOverviewExportParams, createPrintTarget, downloadBlob, readApiError, user]);

  const exportTicketsDownload = useCallback(async (formatKind: "csv" | "xlsx") => {
    if (!user) {
      setTicketsExportError("Você precisa estar autenticado para exportar.");
      return;
    }
    setTicketsExportError(null);
    setTicketsExporting(formatKind);
    try {
      const params = new URLSearchParams();
      params.set("format", formatKind);
      if (reportParams.from) params.set("from", reportParams.from);
      if (reportParams.to) params.set("to", reportParams.to);
      if (tableStatus) params.set("status", tableStatus);
      if (tableType) params.set("type", tableType);
      if (tablePriority) params.set("priority", tablePriority);

      const resp = (await customFetch(`/api/reports/tickets/export?${params.toString()}`, { method: "GET" })) as Response;
      if (!resp.ok) {
        setTicketsExportError(await readApiError(resp));
        return;
      }
      const blob = await resp.blob();
      const ts = buildExportTimestamp();
      const ext = formatKind === "xlsx" ? "xlsx" : "csv";
      downloadBlob(blob, `relatorios_chamados_${ts}.${ext}`);
    } catch {
      setTicketsExportError("Falha ao exportar. Tente novamente.");
    } finally {
      setTicketsExporting(null);
    }
  }, [buildExportTimestamp, downloadBlob, readApiError, reportParams.from, reportParams.to, tablePriority, tableStatus, tableType, user]);

  const exportTicketsPdf = useCallback(async () => {
    if (!user) {
      setTicketsExportError("Você precisa estar autenticado para exportar.");
      return;
    }
    setTicketsExportError(null);
    setTicketsExporting("pdf");
    const ts = buildExportTimestamp();
    const target = createPrintTarget();
    if (!target) {
      setTicketsExportError("Não foi possível abrir a impressão no navegador. Verifique as permissões de pop-up.");
      setTicketsExporting(null);
      return;
    }
    const params = new URLSearchParams();
    params.set("format", "print");
    if (reportParams.from) params.set("from", reportParams.from);
    if (reportParams.to) params.set("to", reportParams.to);
    if (tableStatus) params.set("status", tableStatus);
    if (tableType) params.set("type", tableType);
    if (tablePriority) params.set("priority", tablePriority);

    const resp = (await customFetch(`/api/reports/tickets/export?${params.toString()}`, { method: "GET" })) as Response;
    if (!resp.ok) {
      setTicketsExportError(await readApiError(resp));
      setTicketsExporting(null);
      return;
    }
    const html = await resp.text();
    target.writeAndPrint(html);

    const pdfParams = new URLSearchParams();
    pdfParams.set("format", "pdf");
    if (reportParams.from) pdfParams.set("from", reportParams.from);
    if (reportParams.to) pdfParams.set("to", reportParams.to);
    if (tableStatus) pdfParams.set("status", tableStatus);
    if (tableType) pdfParams.set("type", tableType);
    if (tablePriority) pdfParams.set("priority", tablePriority);

    const pdfResp = (await customFetch(`/api/reports/tickets/export?${pdfParams.toString()}`, { method: "GET" })) as Response;
    if (!pdfResp.ok) {
      setTicketsExportError(await readApiError(pdfResp));
      setTicketsExporting(null);
      return;
    }
    const pdfBlob = await pdfResp.blob();
    downloadBlob(pdfBlob, `relatorios_chamados_${ts}.pdf`);
    setTicketsExporting(null);
  }, [buildExportTimestamp, createPrintTarget, downloadBlob, readApiError, reportParams.from, reportParams.to, tablePriority, tableStatus, tableType, user]);

  const professionalRankingData = professionalRankingQuery.data ?? professionalRankingCached;
  const isProfessionalRankingCached = !professionalRankingQuery.data && Boolean(professionalRankingCached);
  const isAdminViewer = user?.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios Gerenciais</h1>
        <p className="text-muted-foreground mt-1">
          Análise de desempenho e distribuição de chamados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtro de período</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Data inicial</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !draftFrom && "text-muted-foreground")}>
                    {draftFrom ? format(draftFrom, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={draftFrom ?? undefined}
                    onSelect={(d) => setDraftFrom(d ?? null)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Data final</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !draftTo && "text-muted-foreground")}>
                    {draftTo ? format(draftTo, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={draftTo ?? undefined}
                    onSelect={(d) => setDraftTo(d ?? null)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-end gap-2">
              <Button type="button" className="w-full" disabled={Boolean(validationError)} onClick={applyFilter}>
                Aplicar Filtro
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <Button type="button" variant="outline" className="w-full" onClick={clearFilter}>
                Limpar
              </Button>
            </div>
          </div>

          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}

          {overviewExportError ? (
            <p className="text-sm text-destructive">{overviewExportError}</p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              O filtro considera chamados criados ou atualizados dentro do intervalo selecionado.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => exportOverviewPrint(true)}
                disabled={isFetchingAny || overviewExporting !== null}
              >
                {overviewExporting === "pdf" ? "Imprimindo..." : "Exportar PDF"}
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" disabled={isFetchingAny || overviewExporting !== null}>
                    Exportar Excel
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56">
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isFetchingAny || overviewExporting !== null}
                      onClick={() => exportOverviewDownload("csv")}
                    >
                      {overviewExporting === "csv" ? "Gerando CSV..." : "Baixar CSV"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isFetchingAny || overviewExporting !== null}
                      onClick={() => exportOverviewDownload("xlsx")}
                    >
                      {overviewExporting === "xlsx" ? "Gerando XLSX..." : "Baixar XLSX"}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : (summaryQuery.data?.totalTickets ?? "—")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Abertos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : (summaryQuery.data?.openTickets ?? "—")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Em andamento</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : (summaryQuery.data?.inProgressTickets ?? "—")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Resolvidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryQuery.isLoading ? "—" : (summaryQuery.data?.resolvedTickets ?? "—")}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Status</CardTitle>
          </CardHeader>
          <CardContent className="relative flex-1 flex min-h-[300px]">
            {statusQuery.isFetching && !statusQuery.isLoading ? (
              <div className="absolute right-3 top-3 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Atualizando...
              </div>
            ) : null}
            {statusQuery.isLoading ? (
              <div className="flex-1 flex items-center justify-center">Carregando...</div>
            ) : statusChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="label"
                    label={({ payload, percent }) => `${payload.label} ${(percent * 100).toFixed(0)}%`}
                  >
                    {statusChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [value, "Quantidade"]}
                    labelFormatter={(_label, payload) => (payload as any)?.[0]?.payload?.label ?? ""}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Tipo</CardTitle>
          </CardHeader>
          <CardContent className="relative flex-1 flex min-h-[300px]">
            {typeQuery.isFetching && !typeQuery.isLoading ? (
              <div className="absolute right-3 top-3 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Atualizando...
              </div>
            ) : null}
            {typeQuery.isLoading ? (
              <div className="flex-1 flex items-center justify-center">Carregando...</div>
            ) : typeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="label"
                    label
                  >
                    {typeChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [value, "Quantidade"]}
                    labelFormatter={(_label, payload) => (payload as any)?.[0]?.payload?.label ?? ""}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader>
            <CardTitle>Chamados por Região (UF)</CardTitle>
          </CardHeader>
          <CardContent className="relative flex-1 min-h-[350px]">
            {regionQuery.isFetching && !regionQuery.isLoading ? (
              <div className="absolute right-3 top-3 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Atualizando...
              </div>
            ) : null}
            {regionQuery.isLoading ? (
              <div className="h-full flex items-center justify-center">Carregando...</div>
            ) : regionQuery.data && regionQuery.data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={regionQuery.data}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="uf" />
                  <YAxis allowDecimals={false} />
                  <Tooltip cursor={{fill: 'transparent'}} formatter={(value) => [value, "Quantidade"]} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Quantidade" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">Sem dados suficientes</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Estatísticas por Usuário</CardTitle>
            <div className="w-full max-w-[260px]">
              <Select
                value={selectedUserId != null ? String(selectedUserId) : ""}
                onValueChange={(v) => setSelectedUserId(v ? Number(v) : null)}
                disabled={usersStatsQuery.isLoading || usersStatsQuery.isError || (usersStatsQuery.data?.length ?? 0) === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar usuário" />
                </SelectTrigger>
                <SelectContent>
                  {(usersStatsQuery.data ?? []).map((row) => (
                    <SelectItem key={row.user.id} value={String(row.user.id)}>
                      {row.user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {usersStatsQuery.isFetching && !usersStatsQuery.isLoading ? (
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                Atualizando...
              </div>
            ) : null}

            {usersStatsQuery.isLoading && usersStatsRanking.length === 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div key={idx} className="rounded-lg border p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <Skeleton className="h-6 w-14" />
                        <Skeleton className="h-6 w-10" />
                      </div>
                      <div className="mt-3 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-2/3" />
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : usersStatsQuery.isError ? (
              <div className="flex items-center justify-center py-10 text-destructive">Erro ao carregar estatísticas.</div>
            ) : usersStatsRanking.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">Sem dados suficientes.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {usersStatsRanking.map((row) => {
                    const pos = row.position;
                    const posBadgeClass =
                      pos === 1
                        ? "border-yellow-300 bg-yellow-50 text-yellow-800"
                        : pos === 2
                        ? "border-slate-300 bg-slate-50 text-slate-800"
                        : pos === 3
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-muted bg-background text-foreground";

                    const score = row.score ?? 0;
                    const perfClass =
                      score >= 0.75
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : score >= 0.5
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-red-200 bg-red-50 text-red-700";

                    const isSelected = selectedUserId === row.user.id;

                    return (
                      <UiTooltip key={row.user.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(row.user.id)}
                            className={cn(
                              "w-full text-left rounded-lg border p-3 shadow-sm transition-colors hover:bg-muted/30",
                              isSelected ? "ring-2 ring-primary/40" : "",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <Badge variant="outline" className={cn("min-w-[3rem] justify-center", posBadgeClass)}>
                                {pos}º
                              </Badge>
                              <Badge variant="outline" className={cn(perfClass)}>
                                {Math.round(score * 100)}%
                              </Badge>
                            </div>

                            <div className="mt-2">
                              <div className="font-medium leading-tight">{row.user.name}</div>
                              <div className="text-xs text-muted-foreground truncate">{row.user.email}</div>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <div className="rounded-md border p-2">
                                <div className="text-[11px] text-muted-foreground">Atividades</div>
                                <div className="text-sm font-semibold">{row.totalTickets}</div>
                              </div>
                              <div className="rounded-md border p-2">
                                <div className="text-[11px] text-muted-foreground">Resolução</div>
                                <div className="text-sm font-semibold">
                                  {row.avgResolutionHours == null ? "—" : `${row.avgResolutionHours.toFixed(1)}h`}
                                </div>
                              </div>
                              <div className="rounded-md border p-2">
                                <div className="text-[11px] text-muted-foreground">Satisfação</div>
                                <div className="text-sm font-semibold">
                                  {row.avgRating == null ? "—" : row.avgRating.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[320px]">
                          <div className="space-y-1">
                            <div className="font-medium">{row.user.name}</div>
                            <div className="text-xs text-muted-foreground">{row.user.email}</div>
                            <div className="pt-2 text-xs">
                              <div>Atividades: {row.totalTickets}</div>
                              <div>Tempo médio: {row.avgResolutionHours == null ? "—" : `${row.avgResolutionHours.toFixed(2)}h`}</div>
                              <div>Satisfação: {row.avgRating == null ? "—" : `${row.avgRating.toFixed(2)} / 5`}</div>
                              <div className="pt-1">
                                Abertos: {row.openTickets} | Em andamento: {row.inProgressTickets} | Resolvidos: {row.resolvedTickets} | Cancelados: {row.closedTickets}
                              </div>
                              <div className="pt-1">Score: {Math.round(score * 100)}%</div>
                            </div>
                          </div>
                        </TooltipContent>
                      </UiTooltip>
                    );
                  })}
                </div>

                {selectedUserStats ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">Abertos</div>
                        <div className="text-2xl font-bold">{selectedUserStats.openTickets}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">Em andamento</div>
                        <div className="text-2xl font-bold">{selectedUserStats.inProgressTickets}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">Fechados</div>
                        <div className="text-2xl font-bold">{selectedUserStats.closedTickets}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">Tempo médio de resolução</div>
                        <div className="text-xl font-semibold">
                          {selectedUserStats.avgResolutionHours == null ? "—" : `${selectedUserStats.avgResolutionHours.toFixed(1)}h`}
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-sm text-muted-foreground">Satisfação média</div>
                        <div className="text-xl font-semibold">
                          {selectedUserStats.avgRating == null ? "—" : `${selectedUserStats.avgRating.toFixed(2)} / 5`}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                        Alta: {selectedUserStats.priorityOpen.high}
                      </Badge>
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Média: {selectedUserStats.priorityOpen.medium}
                      </Badge>
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Baixa: {selectedUserStats.priorityOpen.low}
                      </Badge>
                      <Badge variant="secondary">Total: {selectedUserStats.totalTickets}</Badge>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>
              Ranking de chamados
            </CardTitle>
            {user?.role !== "GESTOR" ? (
              <div className="w-full max-w-[260px]">
                <Select value={professionalProfile} onValueChange={(v) => setProfessionalProfile(v as ProfessionalProfile)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analistas">Analistas</SelectItem>
                    <SelectItem value="coordenadores">Coordenadores</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {user?.role === "GESTOR"
                    ? "Perfil: Usuários (com coordenador)"
                    : (professionalProfile === "analistas" ? "Perfil: Analistas" : "Perfil: Coordenadores")}
                </Badge>
                {isAdminViewer ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    Administrador
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Visualização padrão
                  </Badge>
                )}
                {user?.role === "GESTOR" ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Município: {user.municipality ?? "—"} / {user.uf ?? "—"}
                  </Badge>
                ) : null}
              </div>
              {professionalRankingQuery.isFetching && !professionalRankingQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                  Atualizando...
                </div>
              ) : null}
            </div>

            {isProfessionalRankingCached ? (
              <div className="mb-3 text-xs text-muted-foreground">
                Exibindo dados em cache (último carregamento). Atualize o período ou aguarde sincronização.
              </div>
            ) : null}

            {professionalRankingQuery.isLoading && !professionalRankingData ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <div key={idx} className="rounded-lg border p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <Skeleton className="h-6 w-14" />
                      <Skeleton className="h-6 w-10" />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-2/3" />
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : professionalRankingErrorMessage && !professionalRankingData ? (
              <div className="flex items-center justify-center py-10 text-destructive">{professionalRankingErrorMessage}</div>
            ) : (professionalRankingData?.items?.length ?? 0) === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">Sem dados suficientes.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(professionalRankingData?.items ?? []).slice(0, 10).map((row) => {
                  const pos = row.position;
                  const posBadgeClass =
                    pos === 1
                      ? "border-yellow-300 bg-yellow-50 text-yellow-800"
                      : pos === 2
                      ? "border-slate-300 bg-slate-50 text-slate-800"
                      : pos === 3
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-muted bg-background text-foreground";

                  const score = row.score ?? 0;
                  const perfClass =
                    score >= 0.75
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : score >= 0.5
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-red-200 bg-red-50 text-red-700";

                  const delta = row.positionChange;
                  const deltaNode =
                    delta == null ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : delta > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <ArrowUp className="h-3.5 w-3.5" />
                        {delta}
                      </span>
                    ) : delta < 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700">
                        <ArrowDown className="h-3.5 w-3.5" />
                        {Math.abs(delta)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Minus className="h-3.5 w-3.5" />
                        0
                      </span>
                    );

                  return (
                    <UiTooltip key={row.user.id}>
                      <TooltipTrigger asChild>
                        <div className="rounded-lg border p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("min-w-[3rem] justify-center", posBadgeClass)}>
                                {pos}º
                              </Badge>
                              {deltaNode}
                            </div>
                            <Badge variant="outline" className={cn(perfClass)}>
                              {Math.round(score * 100)}%
                            </Badge>
                          </div>

                          <div className="mt-2">
                            <div className="font-medium leading-tight">{row.user.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{row.user.email}</div>
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="rounded-md border p-2">
                              <div className="text-[11px] text-muted-foreground">Volume</div>
                              <div className="text-sm font-semibold">{row.totalTickets}</div>
                            </div>
                            <div className="rounded-md border p-2">
                              <div className="text-[11px] text-muted-foreground">Resolução</div>
                              <div className="text-sm font-semibold">
                                {row.avgResolutionHours == null ? "—" : `${row.avgResolutionHours.toFixed(1)}h`}
                              </div>
                            </div>
                            <div className="rounded-md border p-2">
                              <div className="text-[11px] text-muted-foreground">Satisfação</div>
                              <div className="text-sm font-semibold">
                                {row.avgRating == null ? "—" : row.avgRating.toFixed(2)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px]">
                        <div className="space-y-1">
                          <div className="font-medium">{row.user.name}</div>
                          <div className="text-xs text-muted-foreground">{row.user.email}</div>
                          <div className="pt-2 text-xs">
                            <div>Volume (40%): {row.totalTickets}</div>
                            <div>Resolução (35%): {row.avgResolutionHours == null ? "—" : `${row.avgResolutionHours.toFixed(2)}h`}</div>
                            <div>Satisfação (25%): {row.avgRating == null ? "—" : `${row.avgRating.toFixed(2)} / 5`}</div>
                            <div className="pt-1">Score ponderado: {Math.round(score * 100)}%</div>
                          </div>
                        </div>
                      </TooltipContent>
                    </UiTooltip>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="flex flex-col">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Lista de Chamados (Relatórios)</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={exportTicketsPdf}
              disabled={ticketsQuery.isFetching || ticketsExporting !== null}
            >
              {ticketsExporting === "pdf" ? "Imprimindo..." : "Exportar PDF"}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" disabled={ticketsQuery.isFetching || ticketsExporting !== null}>
                  Exportar Excel
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56">
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ticketsQuery.isFetching || ticketsExporting !== null}
                    onClick={() => exportTicketsDownload("csv")}
                  >
                    {ticketsExporting === "csv" ? "Gerando CSV..." : "Baixar CSV"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ticketsQuery.isFetching || ticketsExporting !== null}
                    onClick={() => exportTicketsDownload("xlsx")}
                  >
                    {ticketsExporting === "xlsx" ? "Gerando XLSX..." : "Baixar XLSX"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Status</span>
              <Select value={tableStatus ?? "ALL"} onValueChange={(v) => setTableStatus(v === "ALL" ? null : (v as ReportsTicketStatus))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="OPEN">Aberto</SelectItem>
                  <SelectItem value="IN_PROGRESS">Em andamento</SelectItem>
                  <SelectItem value="AWAITING_CUSTOMER">Aguardando cliente</SelectItem>
                  <SelectItem value="RESOLVED">Resolvido</SelectItem>
                  <SelectItem value="CLOSED">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Categoria</span>
              <Select value={tableType ?? "ALL"} onValueChange={(v) => setTableType(v === "ALL" ? null : (v as ReportsTicketType))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="SOFTWARE">Sistema</SelectItem>
                  <SelectItem value="HARDWARE">Equipamentos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Prioridade</span>
              <Select value={tablePriority ?? "ALL"} onValueChange={(v) => setTablePriority(v === "ALL" ? null : (v as ReportsTicketPriority))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="HIGH">Alta</SelectItem>
                  <SelectItem value="MEDIUM">Média</SelectItem>
                  <SelectItem value="LOW">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Itens por página</span>
              <Select value={String(tablePageSize)} onValueChange={(v) => setTablePageSize(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {ticketsExportError ? (
            <div className="text-sm text-destructive">{ticketsExportError}</div>
          ) : null}

          <div className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">Tendências (por dia)</div>
            {trendsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">Carregando...</div>
            ) : trendsQuery.isError ? (
              <div className="flex items-center justify-center py-8 text-destructive">Erro ao carregar tendências.</div>
            ) : trendChartData.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">Selecione um período para visualizar tendências.</div>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => [value, "Quantidade"]} />
                    <Legend />
                    <Line type="monotone" dataKey="created" name="Criados" stroke={COLORS[2]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="updated" name="Atualizados" stroke={COLORS[4]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-lg border">
            {ticketsQuery.isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">Carregando...</div>
            ) : ticketsQuery.isError ? (
              <div className="flex items-center justify-center py-10 text-destructive">Erro ao carregar chamados.</div>
            ) : (ticketsQuery.data?.items?.length ?? 0) === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">Nenhum chamado encontrado.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">ID</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead className="hidden lg:table-cell">Solicitante</TableHead>
                    <TableHead className="hidden xl:table-cell">Responsável</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead className="hidden md:table-cell">Categoria</TableHead>
                    <TableHead className="text-right">Atualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(ticketsQuery.data?.items ?? []).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link href={`/tickets/${t.id}`}>{t.id}</Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          <Link href={`/tickets/${t.id}`}>{t.title}</Link>
                        </div>
                        <div className="text-xs text-muted-foreground md:hidden">
                          {t.createdBy?.name ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{t.createdBy?.name ?? "—"}</TableCell>
                      <TableCell className="hidden xl:table-cell">{t.assignedTo?.name ?? "—"}</TableCell>
                      <TableCell>{labelStatus(t.status)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            t.priority === "HIGH" ? "border-red-200 bg-red-50 text-red-700" :
                            t.priority === "MEDIUM" ? "border-amber-200 bg-amber-50 text-amber-700" :
                            "border-emerald-200 bg-emerald-50 text-emerald-700"
                          )}
                        >
                          {t.priority === "HIGH" ? "Alta" : t.priority === "MEDIUM" ? "Média" : "Baixa"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{labelType(t.type)}</TableCell>
                      <TableCell className="text-right">
                        {format(new Date(t.updatedAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {ticketsQuery.data ? `Total: ${ticketsQuery.data.total}` : ""}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={ticketsQuery.isFetching || tablePage <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="text-sm">
                Página {tablePage} de {ticketsQuery.data ? Math.max(1, Math.ceil(ticketsQuery.data.total / ticketsQuery.data.pageSize)) : 1}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={
                  ticketsQuery.isFetching ||
                  !ticketsQuery.data ||
                  tablePage >= Math.max(1, Math.ceil(ticketsQuery.data.total / ticketsQuery.data.pageSize))
                }
                onClick={() => setTablePage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
