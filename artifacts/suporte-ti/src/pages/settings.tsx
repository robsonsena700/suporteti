import { useState } from "react";
import { 
  useListUsers, 
  useApproveUser,
  getListUsersQueryKey,
  UserStatus,
  UserRole
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<Record<number, UserRole>>({});

  const { data: pendingUsers, isLoading: isLoadingPending } = useListUsers({ status: UserStatus.PENDING }, {
    query: { queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) }
  });

  const { data: allUsers, isLoading: isLoadingAll } = useListUsers({}, {
    query: { queryKey: getListUsersQueryKey({}) }
  });

  const approveMutation = useApproveUser();

  const handleApprove = (userId: number) => {
    const role = selectedRoles[userId] || UserRole.USER;
    approveMutation.mutate(
      { id: userId, data: { role } },
      {
        onSuccess: () => {
          toast({ title: "Usuário aprovado com sucesso" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({ status: UserStatus.PENDING }) });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey({}) });
        }
      }
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
                      <Badge variant={user.status === UserStatus.ACTIVE ? "success" : user.status === UserStatus.PENDING ? "secondary" : "destructive"}>
                        {user.status}
                      </Badge>
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
