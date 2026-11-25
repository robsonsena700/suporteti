export const colors = {
  background: "#f1f5f9",
  surface: "#ffffff",
  border: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#64748b",
  primary: "#1e3a5f",
  primaryDark: "#0f172a",
  accent: "#2563eb",
  success: "#16a34a",
  successBg: "#dcfce7",
  warning: "#d97706",
  warningBg: "#fef3c7",
  danger: "#dc2626",
  dangerBg: "#fee2e2",
  info: "#2563eb",
  infoBg: "#dbeafe",
  neutralBg: "#e2e8f0",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: "Aberto", color: colors.info, bg: colors.infoBg },
  IN_PROGRESS: { label: "Em Andamento", color: colors.warning, bg: colors.warningBg },
  AWAITING_CUSTOMER: { label: "Aguardando Cliente", color: colors.textSecondary, bg: colors.neutralBg },
  IN_DEVELOPMENT: { label: "Em Desenvolvimento", color: colors.warning, bg: colors.warningBg },
  RESOLVED: { label: "Resolvido", color: colors.success, bg: colors.successBg },
  CLOSED: { label: "Cancelado", color: colors.textSecondary, bg: colors.neutralBg },
};

export const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  LOW: { label: "Baixa", color: colors.success, bg: colors.successBg },
  MEDIUM: { label: "Média", color: colors.warning, bg: colors.warningBg },
  HIGH: { label: "Alta", color: colors.danger, bg: colors.dangerBg },
};

export const TYPE_META: Record<string, { label: string }> = {
  SOFTWARE: { label: "Sistema" },
  HARDWARE: { label: "Equipamentos" },
};
