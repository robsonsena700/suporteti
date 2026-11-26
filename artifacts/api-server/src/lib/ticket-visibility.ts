import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { ticketsTable } from "@workspace/db";
import { getVisibleOwnerIdsForCoordinator, getVisibleOwnerIdsForGestor } from "./access";

export type VisibilityUser = { userId: number; role: string };

/**
 * Regra UNICA de quais chamados um perfil enxerga em listagens e metricas.
 * E exatamente a regra que a tela de Chamados (GET /tickets e
 * /tickets/resolved) sempre aplicou; o dashboard passou a usar a mesma
 * funcao para que os numeros do painel nunca divirjam da lista.
 *
 * - ADMIN / ANALYST: todos os chamados (retorna undefined = sem filtro).
 * - COORDINATOR: chamados abertos pelos usuarios que ele coordena (vinculo
 *   direto ou por municipio) + atribuidos a ele + onde e colaborador.
 * - GESTOR: usuarios liberados pelo coordenador ao qual esta vinculado +
 *   atribuidos a esse coordenador + onde esse coordenador e colaborador.
 *   Sem coordenador ou sem usuarios liberados: nada.
 * - USER (e qualquer outro perfil): somente os chamados que ele abriu.
 */
export async function buildTicketVisibilityWhere(user: VisibilityUser): Promise<SQL | undefined> {
  if (user.role === "ADMIN" || user.role === "ANALYST") return undefined;

  if (user.role === "COORDINATOR") {
    const allowedOwners = await getVisibleOwnerIdsForCoordinator(user.userId);
    return or(
      inArray(ticketsTable.createdById, allowedOwners),
      eq(ticketsTable.assignedToId, user.userId),
      sql`exists(select 1 from public.ticket_collaborators tc where tc.ticket_id = ${ticketsTable.id} and tc.user_id = ${user.userId})`,
    );
  }

  if (user.role === "GESTOR") {
    const { coordinatorId, ownerIds } = await getVisibleOwnerIdsForGestor(user.userId);
    if (!coordinatorId || ownerIds.length === 0) return sql`false`;
    return or(
      inArray(ticketsTable.createdById, ownerIds),
      eq(ticketsTable.assignedToId, coordinatorId),
      sql`exists(select 1 from public.ticket_collaborators tc where tc.ticket_id = ${ticketsTable.id} and tc.user_id = ${coordinatorId})`,
    );
  }

  return eq(ticketsTable.createdById, user.userId);
}
