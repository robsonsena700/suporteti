import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

const schema = z.object({
  newPassword: z.string().min(8, "A senha deve possuir no mínimo 8 caracteres"),
  confirmPassword: z.string().min(8, "Confirme a senha"),
}).refine((v) => v.newPassword === v.confirmPassword, {
  message: "As senhas não conferem",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (data: FormValues) => {
    if (!token) {
      toast({ title: "Token inválido", variant: "destructive" });
      return;
    }
    try {
      await customFetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: data.newPassword }),
      });
      toast({ title: "Senha redefinida com sucesso" });
      setLocation("/");
    } catch (err: any) {
      const code = err?.data?.code;
      const description =
        code === "TOKEN_EXPIRED"
          ? "O link expirou. Solicite uma nova recuperação de senha."
          : (err?.data?.error || "Não foi possível redefinir a senha.");
      toast({
        title: "Erro na redefinição",
        description,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg border-primary/10">
        <CardHeader className="space-y-2 text-center pb-8">
          <CardTitle className="text-2xl font-bold tracking-tight text-primary">Redefinir senha</CardTitle>
          <CardDescription>Crie uma nova senha para acessar o SuporteTI.</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Token inválido ou ausente. Solicite um novo link de recuperação.
              </div>
              <Button asChild className="w-full">
                <Link href="/esqueci-senha">Solicitar novo link</Link>
              </Button>
              <div className="text-center text-sm">
                <Link href="/" className="text-primary font-medium hover:underline">
                  Voltar para o login
                </Link>
              </div>
            </div>
          ) : (
            <>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nova senha</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirmar nova senha</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? "Salvando..." : "Salvar nova senha"}
                  </Button>
                </form>
              </Form>
              <div className="mt-6 text-center text-sm">
                <Link href="/" className="text-primary font-medium hover:underline">
                  Voltar para o login
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

