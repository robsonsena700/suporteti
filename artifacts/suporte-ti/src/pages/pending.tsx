import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, LogOut } from "lucide-react";

export default function Pending() {
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg text-center">
        <CardHeader className="space-y-4 pb-8">
          <div className="mx-auto w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-2">
            <Clock className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Acesso Pendente</CardTitle>
          <CardDescription className="text-base">
            Olá, {user?.name}. Sua conta foi criada com sucesso, mas precisa ser aprovada por um administrador antes de você poder acessar o sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted p-4 rounded-md text-sm text-left">
            <p><strong>E-mail:</strong> {user?.email}</p>
            <p><strong>Região:</strong> {user?.municipality} - {user?.uf}</p>
            <p><strong>Status:</strong> Aguardando aprovação</p>
          </div>
          <Button onClick={() => logout()} variant="outline" className="w-full">
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
