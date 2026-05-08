export function getRoleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  const normalized = role.toUpperCase();
  if (normalized === "ADMIN") return "ADMIN";
  if (normalized === "COORDINATOR") return "COORDENADOR";
  if (normalized === "ANALYST") return "ANALISTA";
  if (normalized === "GESTOR") return "GESTOR";
  if (normalized === "USER") return "USUÁRIO";
  return role;
}

