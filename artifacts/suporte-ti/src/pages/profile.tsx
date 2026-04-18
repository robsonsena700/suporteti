import { useAuth } from "@/lib/auth";
import { useUpdateUser, getGetMeQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { UserCircle } from "lucide-react";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const profileSchema = z.object({
  name: z.string().min(2, "Nome é obrigatório"),
  uf: z.string().min(2, "UF é obrigatória"),
  municipality: z.string().min(2, "Município é obrigatório"),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateUser();

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name || "",
      uf: user?.uf || "",
      municipality: user?.municipality || "",
    },
  });

  const onSubmit = (data: ProfileForm) => {
    if (!user) return;
    updateMutation.mutate(
      { id: user.id, data },
      {
        onSuccess: (updatedUser) => {
          queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
          toast({ title: "Perfil atualizado com sucesso" });
        },
        onError: () => {
          toast({ title: "Erro ao atualizar perfil", variant: "destructive" });
        }
      }
    );
  };

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Meu Perfil</h1>
        <p className="text-muted-foreground mt-1">
          Gerencie suas informações pessoais e localidade.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 border-none shadow-none bg-muted/30">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UserCircle className="w-16 h-16 text-primary" />
            </div>
            <h2 className="font-semibold text-lg">{user.name}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-4 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              {user.role}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Dados Pessoais</CardTitle>
            <CardDescription>Atualize seus dados de identificação.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome Completo</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="uf"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UF</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {UFS.map(uf => (
                              <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="municipality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Município</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
