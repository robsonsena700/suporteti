import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// Hook escrito a mao (mesmo padrao de use-create-ticket-rating.ts) para
// GET /api/reports/dashboard. Os tipos espelham
// artifacts/api-server/src/lib/dashboard-metrics.ts.

export type DashboardSegment = "ALL" | "SOFTWARE" | "HARDWARE";
export type DashboardDays = 7 | 30 | 90;

export type DashboardStatusCounts = { total: number; open: number; inProgress: number; resolved: number; cancelled: number };

export type DashboardSegmentKpis = {
  createdInPeriod: number;
  resolvedInPeriod: number;
  activeNow: number;
  firstResponse: { avgMinutes: number | null; medianMinutes: number | null; sample: number };
  resolution: { avgHours: number | null; medianHours: number | null; sample: number };
  reopen: { rate: number | null; reopened: number; resolved: number };
};

export type DashboardSegmentRatings = {
  avg: number | null;
  count: number;
  distribution: [number, number, number, number, number];
  coverage: number | null;
};

export type DashboardMetrics = {
  generatedAt: string;
  period: { days: number; from: string; to: string };
  visibility: { role: string; showRequesters: boolean; showAssignees: boolean; showRatings: boolean };
  statusCounts: Record<DashboardSegment, DashboardStatusCounts>;
  kpis: Record<DashboardSegment, DashboardSegmentKpis>;
  daily: Array<{ date: string; createdSoftware: number; createdHardware: number; resolvedSoftware: number; resolvedHardware: number }>;
  priorityActive: Array<{ priority: "HIGH" | "MEDIUM" | "LOW"; software: number; hardware: number }>;
  topRequesters: Array<{ userId: number; name: string; software: number; hardware: number; total: number }> | null;
  assignees: Array<{
    userId: number;
    name: string;
    resolvedSoftware: number;
    resolvedHardware: number;
    resolvedTotal: number;
    avgResolutionHours: number | null;
    activeNow: number;
  }> | null;
  ratings: Record<DashboardSegment, DashboardSegmentRatings> | null;
  recent: Array<{
    ticketId: number;
    title: string;
    type: "SOFTWARE" | "HARDWARE";
    priority: "LOW" | "MEDIUM" | "HIGH";
    status: string;
    requesterName: string | null;
    assigneeName: string | null;
    createdAt: string;
    updatedAt: string;
    firstResponseMinutes: number | null;
    resolutionHours: number | null;
  }>;
};

export const getDashboardMetricsQueryKey = (days: DashboardDays) => ["/api/reports/dashboard", { days }] as const;

export const getDashboardMetrics = (days: DashboardDays, options?: RequestInit): Promise<DashboardMetrics> =>
  customFetch<DashboardMetrics>(`/api/reports/dashboard?days=${days}`, { ...options, method: "GET" });

export function useDashboardMetrics(days: DashboardDays) {
  return useQuery({
    queryKey: getDashboardMetricsQueryKey(days),
    queryFn: ({ signal }) => getDashboardMetrics(days, { signal }),
    // Painel atualiza sozinho a cada 60s, mas so com a aba visivel.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}
