import { useEffect, useMemo, useState } from "react";
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
import { Eye, EyeOff } from "lucide-react";

const schema = z.object({
  newPassword: z.string()
    .min(8, "A senha deve possuir no mínimo 8 caracteres")
    .refine((v) => /[A-Za-z]/.test(v), "A senha deve conter letras")
    .refine((v) => /[0-9]/.test(v), "A senha deve conter números")
    .refine((v) => /[^A-Za-z0-9]/.test(v), "A senha deve conter caracteres especiais"),
  confirmPassword: z.string().min(8, "Confirme a senha"),
}).refine((v) => v.newPassword === v.confirmPassword, {
  message: "As senhas não conferem",
  path: ["confirmPassword"],
});

type FormValues = z.infer<typeof schema>;

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tokenStatus, setTokenStatus] = useState<"missing" | "checking" | "ok" | "expired" | "invalid" | "inactive" | "network_error">("checking");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (!token) {
      setTokenStatus("missing");
      return;
    }
    let cancelled = false;
    setTokenStatus("checking");
    customFetch("/api/auth/reset-password/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(() => {
        if (cancelled) return;
        setTokenStatus("ok");
      })
      .catch((err: any) => {
        if (cancelled) return;
        const code = err?.data?.code;
        if (code === "TOKEN_EXPIRED") setTokenStatus("expired");
        else if (code === "TOKEN_INVALID") setTokenStatus("invalid");
        else if (code === "ACCOUNT_INACTIVE") setTokenStatus("inactive");
        else setTokenStatus("network_error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      const description = (() => {
        if (code === "TOKEN_EXPIRED") return "O link expirou. Solicite uma nova recuperação de senha.";
        if (code === "TOKEN_INVALID") return "Este link é inválido. Solicite uma nova recuperação de senha.";
        if (code === "ACCOUNT_INACTIVE") return "Sua conta está desativada. Entre em contato com o suporte.";
        if (code === "PASSWORD_WEAK") return err?.data?.error || "A senha informada não atende aos requisitos de segurança.";
        if (code === "PASSWORD_REUSED") return "A nova senha não pode ser igual às últimas senhas utilizadas.";
        if (err?.status === 0) return "Falha de conexão com o servidor. Verifique sua internet e tente novamente.";
        return err?.data?.error || "Não foi possível redefinir a senha.";
      })();
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
          {tokenStatus === "checking" ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              Validando link...
            </div>
          ) : tokenStatus === "inactive" ? (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Sua conta está desativada. Para redefinir o acesso, entre em contato com o suporte.
              </div>
              <div className="text-center text-sm">
                <Link href="/" className="text-primary font-medium hover:underline">
                  Voltar para o login
                </Link>
              </div>
            </div>
          ) : tokenStatus === "missing" || tokenStatus === "invalid" || tokenStatus === "expired" || tokenStatus === "network_error" ? (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {tokenStatus === "network_error"
                  ? "Falha ao validar o link. Verifique sua conexão e tente novamente."
                  : tokenStatus === "expired"
                    ? "Este link expirou. Solicite um novo link de recuperação."
                    : "Token inválido ou ausente. Solicite um novo link de recuperação."}
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
                          <div className="relative">
                            <Input
                              type={showNewPassword ? "text" : "password"}
                              placeholder="••••••••"
                              autoComplete="new-password"
                              {...field}
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              onClick={() => setShowNewPassword((v) => !v)}
                              aria-label={showNewPassword ? "Ocultar senha" : "Mostrar senha"}
                              aria-pressed={showNewPassword}
                              title={showNewPassword ? "Ocultar senha" : "Mostrar senha"}
                            >
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
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
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="••••••••"
                              autoComplete="new-password"
                              {...field}
                            />
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              onClick={() => setShowConfirmPassword((v) => !v)}
                              aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                              aria-pressed={showConfirmPassword}
                              title={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}
                            >
                              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="text-xs text-muted-foreground">
                    Requisitos: mínimo 8 caracteres, letras, números e caracteres especiais. Não é permitido reutilizar as últimas 3 senhas.
                  </div>
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
