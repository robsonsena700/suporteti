import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { 
  useListUsers, 
  useApproveUser,
  useGetGestorConfigs,
  getGetGestorConfigsQueryKey,
  useUpdateGestorConfig,
  getListUsersQueryKey,
  UserStatus,
  UserRole
} from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { UserAvatar } from "@/components/user/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRoleLabel } from "@/lib/role-labels";
import { useAuth } from "@/lib/auth";

type UserWithCoordinator = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  municipality: string;
  uf: string;
  createdAt: string;
  contactPhone: string | null;
  coordinatorId?: number | null;
};

type UserRow = UserWithCoordinator & {
  effectiveRole: UserRole;
  effectiveCoordinatorId: string;
};

type RoleGroupKey = UserRole;

const ROLE_GROUPS: Array<{ key: RoleGroupKey; label: string }> = [
  { key: "COORDINATOR" as UserRole, label: "Coordenadores" },
  { key: "GESTOR" as UserRole, label: "Gestores" },
  { key: "ANALYST" as UserRole, label: "Analistas" },
  { key: "USER" as UserRole, label: "Usuários" },
  { key: "ADMIN" as UserRole, label: "Administradores" },
];

function AdminSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<Record<number, UserRole>>({});
  const [approvalCoordinatorByUser, setApprovalCoordinatorByUser] = useState<Record<number, string>>({});
  const [associationCoordinatorByUser, setAssociationCoordinatorByUser] = useState<Record<number, string>>({});
  const [gestorAddUserByGestorId, setGestorAddUserByGestorId] = useState<Record<number, string>>({});
  const [openMunicipalities, setOpenMunicipalities] = useState<string[]>([]);
  const [openRoleGroupsByMunicipality, setOpenRoleGroupsByMunicipality] = useState<Record<string, string[]>>({});
  const [openCoordinatorGroupsByMunicipality, setOpenCoordinatorGroupsByMunicipality] = useState<Record<string, string[]>>({});
  const [resetSearch, setResetSearch] = useState("");
  const [resetPage, setResetPage] = useState(1);

  useEffect(() => {
    setResetPage(1);
  }, [resetSearch]);

  const { data: pendingUsers, isLoading: isLoadingPending } = useListUsers({ status: UserStatus.PENDING }, {
    query: { queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) }
  });

  const { data: allUsers, isLoading: isLoadingAll } = useQuery({
    queryKey: [...getListUsersQueryKey({}), "includeCoordinator"],
    queryFn: async () => {
      return customFetch<UserWithCoordinator[]>("/api/users?includeCoordinator=true");
    },
  });

  const gestorConfigsQuery = useGetGestorConfigs({
    query: {
      queryKey: getGetGestorConfigsQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  });

  const approveMutation = useApproveUser();
  const updateGestorConfigMutation = useUpdateGestorConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuração do gestor atualizada" });
        queryClient.invalidateQueries({ queryKey: getGetGestorConfigsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
      },
      onError: () => {
        toast({ title: "Erro ao atualizar configuração do gestor", variant: "destructive" });
      },
    }
  });
  const associateCoordinatorMutation = useMutation({
    mutationFn: async ({ userId, coordinatorId }: { userId: number; coordinatorId: number | null }) => {
      return customFetch(`/api/users/${userId}/coordinators`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinatorId }),
      });
    },
  });
  const statusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: number; status: UserStatus }) => {
      return customFetch(`/api/users/${userId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
  });

  const resetPageSize = 10;
  const adminUsersQuery = useQuery({
    queryKey: ["admin-users-password-reset", resetPage, resetPageSize, resetSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(resetPage));
      params.set("pageSize", String(resetPageSize));
      if (resetSearch.trim()) params.set("q", resetSearch.trim());
      return customFetch<{ items: Array<{ id: number; name: string; email: string; role: UserRole; status: UserStatus }>; page: number; pageSize: number; total: number }>(
        `/api/admin/users?${params.toString()}`,
      );
    },
  });

  const adminResetMutation = useMutation({
    mutationFn: async (userId: number) => {
      return customFetch(`/api/admin/users/${userId}/password-reset`, { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Reset de senha enviado", description: "O usuário receberá um e-mail com link válido por 1 hora." });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao enviar reset",
        description: err?.data?.error || "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role, coordinatorId }: { userId: number; role: UserRole; coordinatorId?: number }) => {
      return customFetch(`/api/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, coordinatorId }),
      });
    },
  });

  const activeCoordinators = useMemo(
    () => (allUsers ?? []).filter(user => user.role === UserRole.COORDINATOR && user.status === UserStatus.ACTIVE),
    [allUsers],
  );

  const activeStandardUsers = useMemo(
    () => (allUsers ?? []).filter(user => user.role === UserRole.USER && user.status === UserStatus.ACTIVE),
    [allUsers],
  );

  const gestorConfigById = useMemo(() => {
    const map = new Map<number, { coordinatorId: number | null; allowedUserIds: number[] }>();
    for (const row of gestorConfigsQuery.data ?? []) {
      map.set(row.gestorId, { coordinatorId: row.coordinatorId ?? null, allowedUserIds: row.allowedUserIds ?? [] });
    }
    return map;
  }, [gestorConfigsQuery.data]);

  const coordinatorById = useMemo(() => {
    const map: Record<number, UserWithCoordinator> = {};
    for (const user of allUsers ?? []) {
      if (user.role === UserRole.COORDINATOR) map[user.id] = user;
    }
    return map;
  }, [allUsers]);

  const groupedByMunicipality = useMemo(() => {
    const safe = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const byKey = new Map<string, { key: string; label: string; usersByRole: Record<RoleGroupKey, UserRow[]>; total: number }>();

    for (const user of allUsers ?? []) {
      const municipality = safe(user.municipality) || "Sem município";
      const uf = safe(user.uf) || "--";
      const key = `${municipality}__${uf}`;
      const label = `${municipality} - ${uf}`;

      const effectiveRole = selectedRoles[user.id] ?? user.role;
      const effectiveCoordinatorId = associationCoordinatorByUser[user.id] ?? (user.coordinatorId ? String(user.coordinatorId) : "");

      const row: UserRow = { ...user, effectiveRole, effectiveCoordinatorId };

      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          key,
          label,
          total: 0,
          usersByRole: {
            [UserRole.COORDINATOR]: [],
            [UserRole.GESTOR]: [],
            [UserRole.ANALYST]: [],
            [UserRole.USER]: [],
            [UserRole.ADMIN]: [],
          },
        };
        byKey.set(key, entry);
      }

      entry.total += 1;
      entry.usersByRole[effectiveRole].push(row);
    }

    const out = Array.from(byKey.values());
    out.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    for (const group of out) {
      for (const { key } of ROLE_GROUPS) {
        group.usersByRole[key].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      }
    }
    return out;
  }, [allUsers, associationCoordinatorByUser, selectedRoles]);

  const defaultOpenMunicipality = groupedByMunicipality[0]?.key;

  useEffect(() => {
    if (!defaultOpenMunicipality) return;
    if (openMunicipalities.length > 0) return;
    setOpenMunicipalities([defaultOpenMunicipality]);
  }, [defaultOpenMunicipality, openMunicipalities.length]);

  const handleExpandAll = () => {
    const municipalityKeys = groupedByMunicipality.map(m => m.key);
    const roleGroups: Record<string, string[]> = {};
    const coordinatorGroups: Record<string, string[]> = {};
    for (const municipality of groupedByMunicipality) {
      roleGroups[municipality.key] = ROLE_GROUPS
        .map(r => `${municipality.key}__${r.key}`)
        .filter((value) => {
          const roleKey = value.split("__").slice(-1)[0] as RoleGroupKey;
          return municipality.usersByRole[roleKey]?.length > 0;
        });

      const users = municipality.usersByRole["USER" as UserRole] ?? [];
      const coordinatorIds = new Set<number>();
      for (const user of users) {
        const raw = user.effectiveCoordinatorId;
        if (!raw || raw === "__none__") continue;
        const id = Number(raw);
        if (Number.isFinite(id) && id > 0) coordinatorIds.add(id);
      }
      coordinatorGroups[municipality.key] = Array.from(coordinatorIds)
        .sort((a, b) => {
          const aName = coordinatorById[a]?.name ?? `Coordenador #${a}`;
          const bName = coordinatorById[b]?.name ?? `Coordenador #${b}`;
          return aName.localeCompare(bName, "pt-BR");
        })
        .map(id => `C_${id}`);
    }
    setOpenMunicipalities(municipalityKeys);
    setOpenRoleGroupsByMunicipality(roleGroups);
    setOpenCoordinatorGroupsByMunicipality(coordinatorGroups);
  };

  const handleCollapseAll = () => {
    setOpenMunicipalities([]);
    setOpenRoleGroupsByMunicipality({});
    setOpenCoordinatorGroupsByMunicipality({});
  };

  const handleApprove = (userId: number) => {
    const role = selectedRoles[userId] || UserRole.USER;
    const coordinatorId = approvalCoordinatorByUser[userId];
    const payload: { role: UserRole; coordinatorId?: number } = { role };
    if ((role === UserRole.USER || role === UserRole.GESTOR) && !coordinatorId) {
      toast({ title: "Selecione um coordenador para aprovar este perfil.", variant: "destructive" });
      return;
    }
    if ((role === UserRole.USER || role === UserRole.GESTOR) && coordinatorId) {
      payload.coordinatorId = Number(coordinatorId);
    }

    approveMutation.mutate(
      { id: userId, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Usuário aprovado com sucesso" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
          setApprovalCoordinatorByUser(prev => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }
      }
    );
  };

  const handleAssociateCoordinator = (userId: number, coordinatorId: string) => {
    setAssociationCoordinatorByUser(prev => ({ ...prev, [userId]: coordinatorId }));
    associateCoordinatorMutation.mutate(
      { userId, coordinatorId: coordinatorId === "__none__" ? null : Number(coordinatorId) },
      {
        onSuccess: () => {
          toast({ title: "Coordenador associado com sucesso" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
        },
        onError: () => {
          toast({ title: "Erro ao associar coordenador", variant: "destructive" });
        },
      },
    );
  };

  const handleToggleStatus = (userId: number, currentStatus: UserStatus) => {
    const nextStatus = currentStatus === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE;
    statusMutation.mutate(
      { userId, status: nextStatus },
      {
        onSuccess: () => {
          toast({ title: `Status alterado para ${nextStatus}` });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) });
        },
        onError: () => {
          toast({ title: "Erro ao alterar status do usuário", variant: "destructive" });
        },
      },
    );
  };

  const renderUsersTable = (rows: UserRow[]) => (
    <div className="w-full overflow-x-auto">
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Coordenador</TableHead>
              <TableHead>Ações</TableHead>
              <TableHead className="text-right">Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((user) => {
              const effectiveRole = user.effectiveRole;
              const effectiveCoordinatorId = user.effectiveCoordinatorId;
              const gestorConfig = effectiveRole === UserRole.GESTOR
                ? (gestorConfigById.get(user.id) ?? { coordinatorId: null, allowedUserIds: [] })
                : null;

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <UserAvatar userId={user.id} name={user.name} className="h-8 w-8" />
                      <span>{user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={effectiveRole}
                      onValueChange={(v) => {
                        const nextRole = v as UserRole;
                        setSelectedRoles((prev) => ({ ...prev, [user.id]: nextRole }));

                        const coordinatorId = effectiveCoordinatorId && effectiveCoordinatorId !== "__none__"
                          ? Number(effectiveCoordinatorId)
                          : undefined;

                        const gestorCoordinatorId = (() => {
                          const fromConfig = gestorConfigById.get(user.id)?.coordinatorId ?? null;
                          if (typeof fromConfig === "number") return fromConfig;
                          const draft = associationCoordinatorByUser[user.id];
                          if (draft && draft !== "__none__") return Number(draft);
                          if (effectiveCoordinatorId && effectiveCoordinatorId !== "__none__") return Number(effectiveCoordinatorId);
                          const fallback = activeCoordinators[0]?.id;
                          return typeof fallback === "number" ? fallback : null;
                        })();

                        if (nextRole === UserRole.GESTOR && gestorCoordinatorId == null) {
                          toast({ title: "Selecione um coordenador para o Gestor antes de salvar.", variant: "destructive" });
                          return;
                        }
                        changeRoleMutation.mutate(
                          {
                            userId: user.id,
                            role: nextRole,
                            coordinatorId: nextRole === UserRole.USER ? coordinatorId : nextRole === UserRole.GESTOR ? gestorCoordinatorId ?? undefined : undefined,
                          },
                          {
                            onSuccess: () => {
                              toast({ title: "Perfil atualizado com sucesso" });
                              queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
                              queryClient.invalidateQueries({ queryKey: getGetGestorConfigsQueryKey() });
                            },
                            onError: () => {
                              toast({ title: "Erro ao atualizar perfil", variant: "destructive" });
                            },
                          },
                        );
                      }}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UserRole.USER}>Usuário Padrão</SelectItem>
                        <SelectItem value={UserRole.GESTOR}>Gestor</SelectItem>
                        <SelectItem value={UserRole.COORDINATOR}>Coordenador</SelectItem>
                        <SelectItem value={UserRole.ANALYST}>Analista</SelectItem>
                        <SelectItem value={UserRole.ADMIN}>Administrador</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === UserStatus.ACTIVE ? "default" : user.status === UserStatus.PENDING ? "secondary" : "destructive"}>
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {effectiveRole === UserRole.USER ? (
                      <Select
                        value={effectiveCoordinatorId}
                        onValueChange={(v) => handleAssociateCoordinator(user.id, v)}
                        disabled={associateCoordinatorMutation.isPending}
                      >
                        <SelectTrigger className="w-[250px]">
                          <SelectValue placeholder="Selecione e associe" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sem coordenador</SelectItem>
                          {activeCoordinators.map(coordinator => (
                            <SelectItem key={coordinator.id} value={String(coordinator.id)}>
                              {coordinator.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : effectiveRole === UserRole.GESTOR ? (
                      <div className="space-y-2">
                        <Select
                          value={gestorConfig?.coordinatorId != null ? String(gestorConfig.coordinatorId) : "__none__"}
                          onValueChange={(v) => {
                            const nextCoordinatorId = v && v !== "__none__" ? Number(v) : null;
                            updateGestorConfigMutation.mutate({
                              id: user.id,
                              data: {
                                coordinatorId: nextCoordinatorId,
                                allowedUserIds: gestorConfig?.allowedUserIds ?? [],
                              }
                            });
                          }}
                          disabled={updateGestorConfigMutation.isPending || gestorConfigsQuery.isLoading}
                        >
                          <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder="Coordenador principal" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem coordenador</SelectItem>
                            {activeCoordinators.map(coordinator => (
                              <SelectItem key={coordinator.id} value={String(coordinator.id)}>
                                {coordinator.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Usuários adicionais</div>
                          {(gestorConfig?.allowedUserIds?.length ?? 0) === 0 ? (
                            <div className="text-sm text-muted-foreground">Nenhum</div>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(gestorConfig?.allowedUserIds ?? []).map((uid) => (
                                <Badge key={uid} variant="outline" className="flex items-center gap-2">
                                  <span>
                                    {allUsers?.find((u) => u.id === uid)?.name ?? `ID ${uid}`}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2"
                                    disabled={updateGestorConfigMutation.isPending}
                                    onClick={() => {
                                      updateGestorConfigMutation.mutate({
                                        id: user.id,
                                        data: {
                                          coordinatorId: gestorConfig?.coordinatorId ?? null,
                                          allowedUserIds: (gestorConfig?.allowedUserIds ?? []).filter((x) => x !== uid),
                                        }
                                      });
                                    }}
                                  >
                                    Remover
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Select
                            value={gestorAddUserByGestorId[user.id] ?? ""}
                            onValueChange={(v) => setGestorAddUserByGestorId((prev) => ({ ...prev, [user.id]: v }))}
                            disabled={updateGestorConfigMutation.isPending || gestorConfigsQuery.isLoading}
                          >
                            <SelectTrigger className="w-[250px]">
                              <SelectValue placeholder="Adicionar usuário" />
                            </SelectTrigger>
                            <SelectContent>
                              {activeStandardUsers
                                .filter((u) => !(gestorConfig?.allowedUserIds ?? []).includes(u.id))
                                .map((u) => (
                                  <SelectItem key={u.id} value={String(u.id)}>
                                    {u.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={updateGestorConfigMutation.isPending || !gestorAddUserByGestorId[user.id]}
                            onClick={() => {
                              const v = gestorAddUserByGestorId[user.id];
                              if (!v) return;
                              const uid = Number(v);
                              const next = Array.from(new Set([...(gestorConfig?.allowedUserIds ?? []), uid]));
                              updateGestorConfigMutation.mutate({
                                id: user.id,
                                data: {
                                  coordinatorId: gestorConfig?.coordinatorId ?? null,
                                  allowedUserIds: next,
                                }
                              });
                              setGestorAddUserByGestorId((prev) => ({ ...prev, [user.id]: "" }));
                            }}
                          >
                            Adicionar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Não se aplica</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {user.status !== UserStatus.PENDING && (
                        <Button
                          size="sm"
                          variant={user.status === UserStatus.ACTIVE ? "destructive" : "default"}
                          onClick={() => handleToggleStatus(user.id, user.status)}
                          disabled={statusMutation.isPending}
                        >
                          {user.status === UserStatus.ACTIVE ? "Desativar" : "Ativar"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {format(new Date(user.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <Card className="border-primary/20 shadow-md">
        <CardHeader>
          <CardTitle>Reset de senha (Administrador)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-md w-full">
              <Input
                value={resetSearch}
                onChange={(e) => setResetSearch(e.target.value)}
                placeholder="Filtrar por nome ou e-mail"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResetPage((p) => Math.max(1, p - 1))}
                disabled={resetPage <= 1 || adminUsersQuery.isLoading}
              >
                Anterior
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResetPage((p) => p + 1)}
                disabled={adminUsersQuery.isLoading || (adminUsersQuery.data?.items?.length ?? 0) < resetPageSize}
              >
                Próxima
              </Button>
            </div>
          </div>

          {adminUsersQuery.isLoading ? (
            <div className="text-center py-4">Carregando...</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Perfil</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(adminUsersQuery.data?.items ?? []).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>{getRoleLabel(u.role)}</TableCell>
                        <TableCell>
                          <Badge variant={u.status === UserStatus.ACTIVE ? "default" : "secondary"}>
                            {u.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() => adminResetMutation.mutate(u.id)}
                            disabled={adminResetMutation.isPending}
                          >
                            Resetar senha
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(adminUsersQuery.data?.items?.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          Nenhum usuário encontrado.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 shadow-md">
        <CardHeader>
          <CardTitle>Aprovações Pendentes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingPending ? (
            <div className="text-center py-4">Carregando...</div>
          ) : pendingUsers?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Não há usuários aguardando aprovação.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Localidade</TableHead>
                  <TableHead>Perfil Desejado</TableHead>
                  <TableHead>Coordenador</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingUsers?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.municipality} - {user.uf}</TableCell>
                    <TableCell>
                      <Select 
                        value={selectedRoles[user.id] || UserRole.USER}
                        onValueChange={(v) => setSelectedRoles(prev => ({ ...prev, [user.id]: v as UserRole }))}
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UserRole.USER}>Usuário Padrão</SelectItem>
                          <SelectItem value={UserRole.GESTOR}>Gestor</SelectItem>
                          <SelectItem value={UserRole.COORDINATOR}>Coordenador</SelectItem>
                          <SelectItem value={UserRole.ANALYST}>Analista</SelectItem>
                          <SelectItem value={UserRole.ADMIN}>Administrador</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={approvalCoordinatorByUser[user.id] || ""}
                        onValueChange={(v) => setApprovalCoordinatorByUser(prev => ({ ...prev, [user.id]: v }))}
                        disabled={!((selectedRoles[user.id] || UserRole.USER) === UserRole.USER || (selectedRoles[user.id] || UserRole.USER) === UserRole.GESTOR)}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeCoordinators.map(coordinator => (
                            <SelectItem key={coordinator.id} value={String(coordinator.id)}>
                              {coordinator.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => handleApprove(user.id)} disabled={approveMutation.isPending}>
                        Aprovar Acesso
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Todos os Usuários</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExpandAll}>
              Expandir todos
            </Button>
            <Button size="sm" variant="outline" onClick={handleCollapseAll}>
              Recolher todos
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingAll ? (
             <div className="text-center py-4">Carregando...</div>
          ) : (
            <Accordion
              type="multiple"
              value={openMunicipalities}
              onValueChange={setOpenMunicipalities}
              className="space-y-3"
            >
              {groupedByMunicipality.map((municipality) => (
                <AccordionItem
                  key={municipality.key}
                  value={municipality.key}
                  className="border rounded-lg px-4 data-[state=open]:shadow-sm"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex flex-1 items-center justify-between pr-2">
                      <div className="flex items-center gap-3">
                        <span className="text-base font-semibold">{municipality.label}</span>
                        <Badge variant="secondary" className="uppercase tracking-wide">
                          {municipality.total} usuários
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-1">
                    <Accordion
                      type="multiple"
                      value={openRoleGroupsByMunicipality[municipality.key] ?? []}
                      onValueChange={(next) => {
                        setOpenRoleGroupsByMunicipality((prev) => ({
                          ...prev,
                          [municipality.key]: next,
                        }));
                      }}
                      className="space-y-2"
                    >
                      {ROLE_GROUPS.map((roleGroup) => {
                        const users = municipality.usersByRole[roleGroup.key];
                        if (users.length === 0) return null;

                        return (
                          <AccordionItem
                            key={`${municipality.key}__${roleGroup.key}`}
                            value={`${municipality.key}__${roleGroup.key}`}
                            className="border rounded-md px-3 bg-background"
                          >
                            <AccordionTrigger className="py-2 hover:no-underline">
                              <div className="flex flex-1 items-center justify-between pr-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{roleGroup.label}</span>
                                  <span className="text-muted-foreground text-xs">({users.length})</span>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2">
                              {(() => {
                                const isUserGroup = roleGroup.key === ("USER" as UserRole);
                                if (!isUserGroup) return renderUsersTable(users);

                                const noCoordinator: UserRow[] = [];
                                const byCoordinator = new Map<number, UserRow[]>();

                                for (const user of users) {
                                  const raw = user.effectiveCoordinatorId;
                                  if (!raw || raw === "__none__") {
                                    noCoordinator.push(user);
                                    continue;
                                  }

                                  const coordinatorId = Number(raw);
                                  if (!Number.isFinite(coordinatorId) || coordinatorId <= 0) {
                                    noCoordinator.push(user);
                                    continue;
                                  }

                                  const list = byCoordinator.get(coordinatorId);
                                  if (list) list.push(user);
                                  else byCoordinator.set(coordinatorId, [user]);
                                }

                                const coordinatorGroups = Array.from(byCoordinator.entries())
                                  .map(([coordinatorId, rows]) => {
                                    const label = coordinatorById[coordinatorId]?.name ?? `Coordenador #${coordinatorId}`;
                                    rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
                                    return { coordinatorId, label, rows };
                                  })
                                  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

                                noCoordinator.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

                                return (
                                  <div className="space-y-3">
                                    {coordinatorGroups.length > 0 ? (
                                      <Accordion
                                        type="multiple"
                                        value={openCoordinatorGroupsByMunicipality[municipality.key] ?? []}
                                        onValueChange={(next) => {
                                          setOpenCoordinatorGroupsByMunicipality((prev) => ({
                                            ...prev,
                                            [municipality.key]: next,
                                          }));
                                        }}
                                        className="space-y-2"
                                      >
                                        {coordinatorGroups.map((group) => (
                                          <AccordionItem
                                            key={`${municipality.key}__C_${group.coordinatorId}`}
                                            value={`C_${group.coordinatorId}`}
                                            className="border rounded-md px-3 bg-muted/10"
                                          >
                                            <AccordionTrigger className="py-2 hover:no-underline">
                                              <div className="flex flex-1 items-center justify-between pr-2">
                                                <div className="flex items-center gap-3">
                                                  <UserAvatar
                                                    userId={group.coordinatorId}
                                                    name={group.label}
                                                    className="h-7 w-7"
                                                  />
                                                  <span className="font-medium">{group.label}</span>
                                                  <span className="text-muted-foreground text-xs">({group.rows.length})</span>
                                                </div>
                                              </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="pt-2">
                                              {renderUsersTable(group.rows)}
                                            </AccordionContent>
                                          </AccordionItem>
                                        ))}
                                      </Accordion>
                                    ) : null}

                                    {noCoordinator.length > 0 ? renderUsersTable(noCoordinator) : null}
                                  </div>
                                );
                              })()}
                            </AccordionContent>
                          </AccordionItem>
                        );
                      })}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Ajustes da sua conta e, para administradores, gerenciamento de usuários.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Meu Perfil</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Atualize seus dados pessoais, preferências e localidade.
          </div>
          <Button asChild>
            <Link href="/perfil">Editar perfil</Link>
          </Button>
        </CardContent>
      </Card>

      {user?.role === "ADMIN" ? <AdminSettings /> : null}
    </div>
  );
}
