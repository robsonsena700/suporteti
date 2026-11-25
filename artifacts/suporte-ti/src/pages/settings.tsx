import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { 
  useListUsers, 
  useApproveUser,
  useGetGestorConfigs,
  getGetGestorConfigsQueryKey,
  useUpdateGestorConfig,
  useUpdateUser,
  getListUsersQueryKey,
  UserStatus,
  UserRole
} from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { UFS, fetchMunicipalitiesByUf, getCachedMunicipalities } from "@/lib/municipalities";
import { MunicipalityCombobox } from "@/components/forms/municipality-combobox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { z } from "zod";

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

type LocationEditTarget = { id: number; name: string; uf: string; municipality: string };

/**
 * Dialogo compartilhado para editar UF/Municipio de um usuario cadastrado.
 * Usado tanto na tela "Todos os Usuarios" (ADMIN) quanto no diretorio de
 * usuarios disponivel para COORDINATOR (escopo do proprio municipio) e
 * ANALYST (sem restricao de escopo) - a autorizacao real e sempre aplicada
 * no backend (PATCH /users/:id), esse dialogo so monta a requisicao.
 */
function EditUserLocationDialog({
  open,
  onOpenChange,
  targetUser,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetUser: LocationEditTarget | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const updateMutation = useUpdateUser();
  const [uf, setUf] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [isLoadingMunicipalities, setIsLoadingMunicipalities] = useState(false);

  useEffect(() => {
    if (open && targetUser) {
      setUf(targetUser.uf || "");
      setMunicipality(targetUser.municipality || "");
    }
  }, [open, targetUser]);

  useEffect(() => {
    if (!uf) {
      setMunicipalities([]);
      return;
    }

    const cached = getCachedMunicipalities(uf);
    if (cached.length > 0) {
      setMunicipalities(cached);
    }

    let cancelled = false;
    setIsLoadingMunicipalities(true);
    fetchMunicipalitiesByUf(uf)
      .then((data) => {
        if (cancelled) return;
        setMunicipalities(data);
      })
      .catch(() => {
        if (cancelled) return;
        setMunicipalities([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingMunicipalities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uf]);

  const handleUfChange = (next: string) => {
    setUf(next);
    setMunicipality("");
  };

  const handleSave = () => {
    if (!targetUser) return;
    if (!uf || !municipality) {
      toast({ title: "Selecione UF e município", variant: "destructive" });
      return;
    }
    updateMutation.mutate(
      { id: targetUser.id, data: { uf, municipality } },
      {
        onSuccess: () => {
          toast({ title: "Localidade atualizada com sucesso" });
          onOpenChange(false);
          onSaved();
        },
        onError: (err: any) => {
          toast({
            title: "Não foi possível atualizar a localidade",
            description: err?.data?.error || "Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar localidade</DialogTitle>
          <DialogDescription>
            {targetUser ? `Atualize a UF e o município de ${targetUser.name}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">UF</label>
            <Select value={uf} onValueChange={handleUfChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {UFS.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Município</label>
            <MunicipalityCombobox
              uf={uf}
              value={municipality}
              options={municipalities}
              loading={isLoadingMunicipalities}
              disabled={!uf}
              onChange={setMunicipality}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diretorio de usuarios para perfis que podem editar localidade (UF/
 * Municipio) mas nao devem ter acesso as demais ferramentas administrativas
 * (troca de perfil/role, configuracao de gestor, reset de senha, troca de
 * e-mail) - hoje COORDINATOR (escopado ao proprio municipio pelo backend) e
 * ANALYST (sem escopo). A ativacao/desativacao de usuarios continua restrita
 * a quem ja tinha essa permissao (ADMIN/ANALYST) e nao existe exclusao de
 * usuario em lugar nenhum do sistema, so desativacao.
 */
function UserDirectorySettings({ scopeDescription }: { scopeDescription: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<LocationEditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const usersQueryKey = [...getListUsersQueryKey({}), "directory"];
  const { data: users, isLoading } = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => {
      return customFetch<UserWithCoordinator[]>("/api/users");
    },
  });

  const canToggleStatus = currentUser?.role === "ADMIN" || currentUser?.role === "ANALYST";
  const statusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: number; status: UserStatus }) => {
      return customFetch(`/api/users/${userId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      toast({ title: "Status atualizado com sucesso" });
      queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (err: any) => {
      toast({
        title: "Não foi possível atualizar o status",
        description: err?.data?.error || "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = (users ?? []).filter((u) => u.status !== UserStatus.PENDING);
    const matched = term
      ? rows.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      : rows;
    return [...matched].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [users, search]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Todos os Usuários</CardTitle>
        <CardDescription>{scopeDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Buscar por nome ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {isLoading ? (
          <div className="text-center py-4">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">Nenhum usuário encontrado.</div>
        ) : (
          <div className="w-full overflow-x-auto">
            <div className="max-h-[480px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Localidade</TableHead>
                    <TableHead>Status</TableHead>
                    {canToggleStatus ? <TableHead>Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <UserAvatar userId={u.id} name={u.name} className="h-8 w-8" />
                          <span>{u.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>{getRoleLabel(u.role)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{u.municipality} - {u.uf}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditTarget({ id: u.id, name: u.name, uf: u.uf, municipality: u.municipality });
                              setEditOpen(true);
                            }}
                          >
                            Editar
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.status === UserStatus.ACTIVE ? "default" : "destructive"}>
                          {u.status}
                        </Badge>
                      </TableCell>
                      {canToggleStatus ? (
                        <TableCell>
                          <Button
                            size="sm"
                            variant={u.status === UserStatus.ACTIVE ? "destructive" : "default"}
                            onClick={() => statusMutation.mutate({
                              userId: u.id,
                              status: u.status === UserStatus.ACTIVE ? UserStatus.INACTIVE : UserStatus.ACTIVE,
                            })}
                            disabled={statusMutation.isPending}
                          >
                            {u.status === UserStatus.ACTIVE ? "Desativar" : "Ativar"}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
      <EditUserLocationDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        targetUser={editTarget}
        onSaved={() => queryClient.invalidateQueries({ queryKey: usersQueryKey })}
      />
    </Card>
  );
}

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
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  const [editEmailUser, setEditEmailUser] = useState<{ id: number; name: string; email: string } | null>(null);
  const [editLocationOpen, setEditLocationOpen] = useState(false);
  const [editLocationTarget, setEditLocationTarget] = useState<LocationEditTarget | null>(null);
  const [editNewEmail, setEditNewEmail] = useState("");
  const [editConfirmNewEmail, setEditConfirmNewEmail] = useState("");
  const [editAdminPassword, setEditAdminPassword] = useState("");
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

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

  const adminEditEmailMutation = useMutation({
    mutationFn: async (payload: { userId: number; newEmail: string; confirmNewEmail: string; adminPassword: string }) => {
      return customFetch(`/api/admin/users/${payload.userId}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          newEmail: payload.newEmail,
          confirmNewEmail: payload.confirmNewEmail,
          adminPassword: payload.adminPassword,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "E-mail atualizado com sucesso" });
      setEditEmailOpen(false);
      setEditEmailUser(null);
      setEditNewEmail("");
      setEditConfirmNewEmail("");
      setEditAdminPassword("");
      setEditErrors({});
      queryClient.invalidateQueries({ queryKey: ["admin-users-password-reset"] });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao atualizar e-mail",
        description: err?.data?.error || "Tente novamente.",
        variant: "destructive",
      });
    },
  });

  const emailEditSchema = z.object({
    newEmail: z.string().email("E-mail inválido"),
    confirmNewEmail: z.string().email("E-mail inválido"),
    adminPassword: z.string().min(1, "Informe sua senha"),
  }).refine((v) => v.newEmail === v.confirmNewEmail, { path: ["confirmNewEmail"], message: "Os e-mails não conferem" });

  const validateEditEmailForm = (values: { newEmail: string; confirmNewEmail: string; adminPassword: string }) => {
    const parsed = emailEditSchema.safeParse(values);
    if (parsed.success) return {};
    const out: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] ? String(issue.path[0]) : "form";
      if (!out[key]) out[key] = issue.message;
    }
    return out;
  };

  const openEditEmail = (u: { id: number; name: string; email: string }) => {
    setEditEmailUser({ id: u.id, name: u.name, email: u.email });
    setEditNewEmail(u.email);
    setEditConfirmNewEmail(u.email);
    setEditAdminPassword("");
    setEditErrors({});
    setEditEmailOpen(true);
  };

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
    if (role === UserRole.GESTOR && !coordinatorId) {
      toast({ title: "Selecione um coordenador para aprovar este Gestor.", variant: "destructive" });
      return;
    }
    if ((role === UserRole.USER || role === UserRole.GESTOR) && coordinatorId && coordinatorId !== "__none__") {
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
              <TableHead>Localidade</TableHead>
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
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span>{user.municipality} - {user.uf}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditLocationTarget({ id: user.id, name: user.name, uf: user.uf, municipality: user.municipality });
                          setEditLocationOpen(true);
                        }}
                      >
                        Editar
                      </Button>
                    </div>
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
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditEmail({ id: u.id, name: u.name, email: u.email })}
                              disabled={adminEditEmailMutation.isPending}
                            >
                              Editar E-mail
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => adminResetMutation.mutate(u.id)}
                              disabled={adminResetMutation.isPending}
                            >
                              Resetar senha
                            </Button>
                          </div>
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

      <EditUserLocationDialog
        open={editLocationOpen}
        onOpenChange={setEditLocationOpen}
        targetUser={editLocationTarget}
        onSaved={() => queryClient.invalidateQueries({ queryKey: [...getListUsersQueryKey({}), "includeCoordinator"] })}
      />

      <Dialog open={editEmailOpen} onOpenChange={(v) => {
        if (!v) {
          setEditEmailOpen(false);
          setEditErrors({});
          return;
        }
        setEditEmailOpen(true);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar e-mail</DialogTitle>
            <DialogDescription>
              Atualize o e-mail do usuário selecionado. Uma notificação será enviada para o e-mail antigo e para o novo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">Usuário:</span>{" "}
              <span className="text-muted-foreground">{editEmailUser?.name ?? "—"}</span>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Novo e-mail</div>
              <Input
                type="email"
                value={editNewEmail}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditNewEmail(v);
                  setEditErrors(validateEditEmailForm({ newEmail: v, confirmNewEmail: editConfirmNewEmail, adminPassword: editAdminPassword }));
                }}
              />
              {editErrors.newEmail ? <div className="text-xs text-destructive">{editErrors.newEmail}</div> : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Confirmar novo e-mail</div>
              <Input
                type="email"
                value={editConfirmNewEmail}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditConfirmNewEmail(v);
                  setEditErrors(validateEditEmailForm({ newEmail: editNewEmail, confirmNewEmail: v, adminPassword: editAdminPassword }));
                }}
              />
              {editErrors.confirmNewEmail ? <div className="text-xs text-destructive">{editErrors.confirmNewEmail}</div> : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Senha do administrador</div>
              <Input
                type="password"
                value={editAdminPassword}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditAdminPassword(v);
                  setEditErrors(validateEditEmailForm({ newEmail: editNewEmail, confirmNewEmail: editConfirmNewEmail, adminPassword: v }));
                }}
              />
              {editErrors.adminPassword ? <div className="text-xs text-destructive">{editErrors.adminPassword}</div> : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditEmailOpen(false)}
              disabled={adminEditEmailMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!editEmailUser) return;
                const errors = validateEditEmailForm({ newEmail: editNewEmail, confirmNewEmail: editConfirmNewEmail, adminPassword: editAdminPassword });
                setEditErrors(errors);
                if (Object.keys(errors).length > 0) return;
                adminEditEmailMutation.mutate({
                  userId: editEmailUser.id,
                  newEmail: editNewEmail.trim(),
                  confirmNewEmail: editConfirmNewEmail.trim(),
                  adminPassword: editAdminPassword,
                });
              }}
              disabled={adminEditEmailMutation.isPending || !editEmailUser}
            >
              {adminEditEmailMutation.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                        value={approvalCoordinatorByUser[user.id] || "__none__"}
                        onValueChange={(v) => setApprovalCoordinatorByUser(prev => ({ ...prev, [user.id]: v }))}
                        disabled={!((selectedRoles[user.id] || UserRole.USER) === UserRole.USER || (selectedRoles[user.id] || UserRole.USER) === UserRole.GESTOR)}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Selecione" />
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

function CoordinatorApprovalSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: pendingUsers,
    isLoading,
    error,
  } = useListUsers(
    { status: UserStatus.PENDING },
    { query: { queryKey: [...getListUsersQueryKey({ status: UserStatus.PENDING }), "coordinator-scope"] } },
  );
  const approveMutation = useApproveUser();
  const visiblePendingUsers = pendingUsers ?? [];

  const handleApprove = (userId: number) => {
    approveMutation.mutate(
      { id: userId, data: { role: UserRole.USER } },
      {
        onSuccess: () => {
          toast({ title: "Usuário aprovado com sucesso" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) });
        },
        onError: (err: any) => {
          toast({
            title: "Não foi possível aprovar o cadastro",
            description: err?.data?.error || "Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const errorMessage =
    (error as any)?.data?.error
    || (error as Error | null)?.message
    || "Não foi possível carregar as solicitações de aprovação.";

  return (
    <Card className="border-primary/20 shadow-md">
      <CardHeader>
        <CardTitle>Aprovações Pendentes do Meu Município</CardTitle>
        <CardDescription>
          Como coordenador, você só pode visualizar e aprovar cadastros do seu próprio município.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-4">Carregando...</div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : visiblePendingUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Não há cadastros pendentes no seu município.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Localidade</TableHead>
                <TableHead>Perfil de Aprovação</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePendingUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.municipality} - {user.uf}</TableCell>
                  <TableCell>Usuário Padrão</TableCell>
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
  );
}

function AnalystPendingApprovalsSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<Record<number, UserRole>>({});
  const [approvalCoordinatorByUser, setApprovalCoordinatorByUser] = useState<Record<number, string>>({});
  const {
    data: pendingUsers,
    isLoading: isLoadingPending,
    error: pendingError,
  } = useListUsers(
    { status: UserStatus.PENDING },
    { query: { queryKey: [...getListUsersQueryKey({ status: UserStatus.PENDING }), "analyst-pending-approvals"] } },
  );
  const { data: allUsers, isLoading: isLoadingUsers } = useQuery({
    queryKey: [...getListUsersQueryKey({}), "includeCoordinator", "analyst-pending-approvals"],
    queryFn: async () => {
      return customFetch<UserWithCoordinator[]>("/api/users?includeCoordinator=true");
    },
  });
  const approveMutation = useApproveUser();
  const visiblePendingUsers = pendingUsers ?? [];

  const activeCoordinators = useMemo(
    () => (allUsers ?? []).filter((user) => user.role === UserRole.COORDINATOR && user.status === UserStatus.ACTIVE),
    [allUsers],
  );

  const handleApprove = (userId: number) => {
    const role = selectedRoles[userId] || UserRole.USER;
    const coordinatorId = approvalCoordinatorByUser[userId];
    const payload: { role: UserRole; coordinatorId?: number } = { role };

    if (role === UserRole.GESTOR && !coordinatorId) {
      toast({ title: "Selecione um coordenador para aprovar este Gestor.", variant: "destructive" });
      return;
    }

    if ((role === UserRole.USER || role === UserRole.GESTOR) && coordinatorId && coordinatorId !== "__none__") {
      payload.coordinatorId = Number(coordinatorId);
    }

    approveMutation.mutate(
      { id: userId, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Usuário aprovado com sucesso" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
          setApprovalCoordinatorByUser((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        },
        onError: (err: any) => {
          toast({
            title: "Não foi possível aprovar o cadastro",
            description: err?.data?.error || "Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const errorMessage =
    (pendingError as any)?.data?.error
    || (pendingError as Error | null)?.message
    || "Não foi possível carregar as solicitações de aprovação.";

  return (
    <Card className="border-primary/20 shadow-md">
      <CardHeader>
        <CardTitle>Aprovações Pendentes</CardTitle>
        <CardDescription>
          Como analista, você pode revisar o perfil, vincular coordenador quando necessário e aprovar cadastros pendentes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pendingError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : isLoadingPending || isLoadingUsers ? (
          <div className="text-center py-4">Carregando...</div>
        ) : visiblePendingUsers.length === 0 ? (
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
              {visiblePendingUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.municipality} - {user.uf}</TableCell>
                  <TableCell>
                    <Select
                      value={selectedRoles[user.id] || UserRole.USER}
                      onValueChange={(v) => setSelectedRoles((prev) => ({ ...prev, [user.id]: v as UserRole }))}
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
                      value={approvalCoordinatorByUser[user.id] || "__none__"}
                      onValueChange={(v) => setApprovalCoordinatorByUser((prev) => ({ ...prev, [user.id]: v }))}
                      disabled={!((selectedRoles[user.id] || UserRole.USER) === UserRole.USER || (selectedRoles[user.id] || UserRole.USER) === UserRole.GESTOR)}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sem coordenador</SelectItem>
                        {activeCoordinators.map((coordinator) => (
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
  );
}

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Ajustes da sua conta e, para administradores, analistas ou coordenadores autorizados, gerenciamento de aprovações.
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
      {user?.role === "COORDINATOR" ? (
        <>
          <CoordinatorApprovalSettings />
          <UserDirectorySettings scopeDescription="Como coordenador, você pode visualizar e editar a localidade (UF/Município) dos usuários do seu próprio município." />
        </>
      ) : null}
      {user?.role === "ANALYST" ? (
        <>
          <AnalystPendingApprovalsSettings />
          <UserDirectorySettings scopeDescription="Como analista, você pode visualizar todos os usuários e editar a localidade (UF/Município) de qualquer cadastro." />
        </>
      ) : null}
    </div>
  );
}
