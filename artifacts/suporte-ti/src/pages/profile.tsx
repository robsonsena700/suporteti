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
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { formatBrazilPhone, formatCpf, isValidBrazilMobile, isValidCpf, onlyDigits } from "@/lib/validators";
import { UserAvatar } from "@/components/user/user-avatar";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const profileSchema = z.object({
  name: z.string().min(2, "Nome é obrigatório"),
  cpf: z.string().refine(isValidCpf, "CPF inválido"),
  establishment: z.string().min(2, "Estabelecimento/Unidade de Saúde é obrigatório"),
  contactPhone: z.string().refine(isValidBrazilMobile, "Contato inválido"),
  prefersWhatsapp: z.boolean().default(false),
  prefersTelegram: z.boolean().default(false),
  uf: z.string().min(2, "UF é obrigatória"),
  municipality: z.string().min(2, "Município é obrigatório"),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateUser();
  const [municipalities, setMunicipalities] = useState<string[]>([]);
  const [isLoadingMunicipalities, setIsLoadingMunicipalities] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string>("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name || "",
      cpf: user?.cpf ? formatCpf(user.cpf) : "",
      establishment: user?.establishment || "",
      contactPhone: user?.contactPhone ? formatBrazilPhone(user.contactPhone) : "+55 ",
      prefersWhatsapp: user?.prefersWhatsapp ?? false,
      prefersTelegram: user?.prefersTelegram ?? false,
      uf: user?.uf || "",
      municipality: user?.municipality || "",
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

  useEffect(() => {
    if (!avatarFile) {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [avatarFile]);

  const uploadAvatar = async () => {
    if (!user) return;
    if (!avatarFile) {
      toast({ title: "Selecione uma imagem", variant: "destructive" });
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", avatarFile);
      const token = localStorage.getItem("ti_support_token");
      const resp = await fetch("/api/users/me/avatar", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!resp.ok) {
        throw new Error();
      }
      await queryClient.invalidateQueries({ queryKey: ["user-avatar", user.id] });
      setAvatarFile(null);
      toast({ title: "Foto do perfil atualizada" });
    } catch {
      toast({
        title: "Erro ao atualizar foto",
        description: "Verifique o arquivo (JPG/PNG/WEBP/GIF, até 1 MB) e tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!user) return;
    setIsUploadingAvatar(true);
    try {
      const token = localStorage.getItem("ti_support_token");
      const resp = await fetch("/api/users/me/avatar", {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!resp.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["user-avatar", user.id] });
      toast({ title: "Foto do perfil removida" });
    } catch {
      toast({ title: "Erro ao remover foto", variant: "destructive" });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const onSubmit = (data: ProfileForm) => {
    if (!user) return;
    updateMutation.mutate(
      {
        id: user.id,
        data: {
          ...data,
          cpf: onlyDigits(data.cpf),
        },
      },
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
            <div className="w-24 h-24 mb-4">
              {avatarPreviewUrl ? (
                <img
                  src={avatarPreviewUrl}
                  alt="Prévia do avatar"
                  className="w-24 h-24 rounded-full object-cover border"
                />
              ) : (
                <UserAvatar userId={user.id} name={user.name} className="w-24 h-24" />
              )}
            </div>
            <h2 className="font-semibold text-lg">{user.name}</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-4 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              {user.role}
            </div>

            <div className="w-full mt-6 space-y-2 text-left">
              <p className="text-xs font-medium text-muted-foreground">Foto do perfil</p>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-[11px] text-muted-foreground">
                JPG, PNG, WEBP ou GIF — até 1 MB.
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={uploadAvatar} disabled={!avatarFile || isUploadingAvatar}>
                  {isUploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Salvar
                </Button>
                <Button type="button" variant="outline" onClick={removeAvatar} disabled={isUploadingAvatar}>
                  Remover
                </Button>
              </div>
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
                        <Input {...field} />
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
