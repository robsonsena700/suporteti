import { useMemo, useState } from "react";
import { 
  useListUsers, 
  useApproveUser,
  getListUsersQueryKey,
  UserStatus,
  UserRole
} from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

type ResetInfo = {
  userName: string;
  userEmail: string;
  userPhone: string | null;
  temporaryPassword: string;
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<Record<number, UserRole>>({});
  const [approvalCoordinatorByUser, setApprovalCoordinatorByUser] = useState<Record<number, string>>({});
  const [associationCoordinatorByUser, setAssociationCoordinatorByUser] = useState<Record<number, string>>({});
  const [resetInfo, setResetInfo] = useState<ResetInfo | null>(null);

  const { data: pendingUsers, isLoading: isLoadingPending } = useListUsers({ status: UserStatus.PENDING }, {
    query: { queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) }
  });

  const { data: allUsers, isLoading: isLoadingAll } = useQuery({
    queryKey: [...getListUsersQueryKey({}), "includeCoordinator"],
    queryFn: async () => {
      return customFetch<UserWithCoordinator[]>("/api/users?includeCoordinator=true");
    },
  });

  const approveMutation = useApproveUser();
  const associateCoordinatorMutation = useMutation({
    mutationFn: async ({ userId, coordinatorId }: { userId: number; coordinatorId: number }) => {
      return customFetch(`/api/users/${userId}/coordinators`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinatorId }),
      });
    },
  });
  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: number) => {
      return customFetch<{ message: string; temporaryPassword: string }>(`/api/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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

  const activeCoordinators = useMemo(
    () => (allUsers ?? []).filter(user => user.role === UserRole.COORDINATOR && user.status === UserStatus.ACTIVE),
    [allUsers],
  );

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copiado para a área de transferência" });
    } catch {
      toast({ title: "Não foi possível copiar automaticamente", description: "Copie manualmente o texto exibido.", variant: "destructive" });
    }
  };

  const handleApprove = (userId: number) => {
    const role = selectedRoles[userId] || UserRole.USER;
    const coordinatorId = approvalCoordinatorByUser[userId];
    if (role === UserRole.USER && !coordinatorId) {
      toast({ title: "Selecione um coordenador para o usuário", variant: "destructive" });
      return;
    }
    const payload: { role: UserRole; coordinatorId?: number } = { role };
    if (role === UserRole.USER && coordinatorId) {
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
      { userId, coordinatorId: Number(coordinatorId) },
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

  const handleResetPassword = (user: UserWithCoordinator) => {
    resetPasswordMutation.mutate(user.id, {
      onSuccess: (result) => {
        setResetInfo({
          userName: user.name,
          userEmail: user.email,
          userPhone: user.contactPhone,
          temporaryPassword: result.temporaryPassword,
        });
      },
      onError: () => {
        toast({ title: "Erro ao resetar senha", variant: "destructive" });
      },
    });
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Gerenciamento de usuários e perfis de acesso.
        </p>
      </div>

      {resetInfo ? (
        <Card className="border-primary/20 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Senha provisória gerada</CardTitle>
            <Button variant="ghost" onClick={() => setResetInfo(null)}>Fechar</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Usuário: <span className="text-foreground font-medium">{resetInfo.userName}</span> ({resetInfo.userEmail})
            </div>
            <div className="rounded-md border p-3 font-mono text-sm break-all">
              {resetInfo.temporaryPassword}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copyToClipboard(resetInfo.temporaryPassword)}>Copiar senha</Button>
              <Button
                variant="outline"
                onClick={() => {
                  const msg = `Olá ${resetInfo.userName}, sua senha provisória é: ${resetInfo.temporaryPassword}\n\nAo entrar, será solicitado alterar a senha.`;
                  copyToClipboard(msg);
                }}
              >
                Copiar mensagem pronta
              </Button>
              {resetInfo.userPhone ? (
                <Button
                  asChild
                  variant="outline"
                >
                  <a
                    href={`https://wa.me/${resetInfo.userPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Olá ${resetInfo.userName}, sua senha provisória é: ${resetInfo.temporaryPassword}\n\nAo entrar, será solicitado alterar a senha.`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Enviar WhatsApp
                  </a>
                </Button>
              ) : null}
              <Button
                asChild
                variant="outline"
              >
                <a
                  href={`mailto:${encodeURIComponent(resetInfo.userEmail)}?subject=${encodeURIComponent("Senha provisória de acesso")}&body=${encodeURIComponent(
                    `Olá ${resetInfo.userName},\n\nSua senha provisória é: ${resetInfo.temporaryPassword}\n\nAo entrar, será solicitado alterar a senha.`,
                  )}`}
                >
                  Enviar e-mail
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                        disabled={(selectedRoles[user.id] || UserRole.USER) !== UserRole.USER}
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
        <CardHeader>
          <CardTitle>Todos os Usuários</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingAll ? (
             <div className="text-center py-4">Carregando...</div>
          ) : (
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
                {allUsers?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === UserStatus.ACTIVE ? "default" : user.status === UserStatus.PENDING ? "secondary" : "destructive"}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.role === UserRole.USER ? (
                        <Select
                          value={associationCoordinatorByUser[user.id] ?? (user.coordinatorId ? String(user.coordinatorId) : "")}
                          onValueChange={(v) => handleAssociateCoordinator(user.id, v)}
                          disabled={associateCoordinatorMutation.isPending}
                        >
                          <SelectTrigger className="w-[250px]">
                            <SelectValue placeholder="Selecione e associe" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeCoordinators.map(coordinator => (
                              <SelectItem key={coordinator.id} value={String(coordinator.id)}>
                                {coordinator.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-sm">Não se aplica</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleResetPassword(user)}
                          disabled={resetPasswordMutation.isPending}
                        >
                          Resetar senha
                        </Button>
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
