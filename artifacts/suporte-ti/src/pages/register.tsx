import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useToast } from "@/hooks/use-toast";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff } from "lucide-react";
import { formatBrazilPhone, formatCpf, isValidBrazilMobile, isValidCpf, onlyDigits } from "@/lib/validators";

const registerSchema = z.object({
  name: z.string().min(2, "Nome é obrigatório"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
  cpf: z.string().refine(isValidCpf, "CPF inválido"),
  establishment: z.string().min(2, "Estabelecimento/Unidade de Saúde é obrigatório"),
  contactPhone: z.string().refine(isValidBrazilMobile, "Contato inválido"),
  prefersWhatsapp: z.boolean().default(false),
  prefersTelegram: z.boolean().default(false),
  termsAccepted: z.boolean().refine((v) => v, "Aceite os termos para continuar"),
  uf: z.string().min(2, "UF é obrigatória"),
  municipality: z.string().min(2, "Município é obrigatório"),
});

type RegisterForm = z.infer<typeof registerSchema>;

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const registerMutation = useRegister();
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [isLoadingMunicipalities, setIsLoadingMunicipalities] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      cpf: "",
      establishment: "",
      contactPhone: "+55 ",
      prefersWhatsapp: false,
      prefersTelegram: false,
      termsAccepted: false,
      uf: "",
      municipality: "",
    },
  });

  const uf = form.watch("uf");

  useEffect(() => {
    if (!uf) {
      setMunicipalities([]);
      form.setValue("municipality", "");
      return;
    }

    let cancelled = false;
    setIsLoadingMunicipalities(true);

    customFetch<string[]>(`/api/ibge/ufs/${encodeURIComponent(uf)}/municipalities`)
      .then((data) => {
        if (cancelled) return;
        setMunicipalities(Array.isArray(data) ? data : []);
        const current = form.getValues("municipality");
        if (current && !data.includes(current)) {
          form.setValue("municipality", "");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMunicipalities([]);
        form.setValue("municipality", "");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingMunicipalities(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uf, form]);

  const municipalityOptions = useMemo(() => municipalities, [municipalities]);

  const onSubmit = (data: RegisterForm) => {
    registerMutation.mutate(
      {
        data: {
          ...data,
          cpf: onlyDigits(data.cpf),
          contactPhone: data.contactPhone,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Cadastro realizado",
            description: "Sua conta ficará pendente até aprovação do administrador.",
          });
          setLocation("/");
        },
        onError: (error) => {
          const data = (error as any)?.data;
          const description =
            (data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : typeof (error as any)?.message === "string"
                ? (error as any).message
                : null) ?? "Ocorreu um erro durante o cadastro.";

          toast({
            title: "Erro ao registrar",
            description,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4 py-12">
      <Card className="w-full max-w-lg shadow-lg border-primary/10">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="mx-auto w-12 h-12 bg-primary rounded-lg flex items-center justify-center mb-4">
            <span className="text-primary-foreground font-bold text-xl">TI</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-primary">Solicitar Acesso</CardTitle>
          <CardDescription>
            Crie sua conta. O acesso será liberado após aprovação.
          </CardDescription>
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
                      <Input placeholder="João da Silva" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input placeholder="joao@orgao.gov.br" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          {...field}
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="000.000.000-00"
                        value={field.value}
                        onChange={(e) => field.onChange(formatCpf(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="establishment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estabelecimento / Unidade de Saúde</FormLabel>
                    <FormControl>
                      <Input placeholder="Nome da unidade" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contato</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='+55 (XX) X XXXX-XXXX'
                        value={field.value}
                        onChange={(e) => field.onChange(formatBrazilPhone(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="prefersWhatsapp"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                      </FormControl>
                      <FormLabel className="mb-0">WhatsApp</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="prefersTelegram"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                      </FormControl>
                      <FormLabel className="mb-0">Telegram</FormLabel>
                    </FormItem>
                  )}
                />
              </div>
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
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!uf || isLoadingMunicipalities || municipalityOptions.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                !uf
                                  ? "Selecione a UF"
                                  : isLoadingMunicipalities
                                    ? "Carregando..."
                                    : "Selecione"
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {municipalityOptions.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="termsAccepted"
                render={({ field }) => (
                  <FormItem className="flex items-start gap-2 space-y-0 rounded-md border p-3">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(Boolean(v))} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="mb-0">
                        Eu concordo com os Termos de Uso e a Política de Privacidade.
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full mt-6" 
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? "Cadastrando..." : "Solicitar Acesso"}
              </Button>
            </form>
          </Form>
          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">Já possui conta? </span>
            <Link href="/" className="text-primary font-medium hover:underline">
              Fazer login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
