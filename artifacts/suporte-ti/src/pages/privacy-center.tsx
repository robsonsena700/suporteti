import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, ExternalLink, FileText, Inbox, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  DOCUMENT_PATHS,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS_LABELS,
  downloadMyData,
  privacyErrorMessage,
  useAdminPrivacyRequests,
  useCreatePrivacyRequest,
  useMyPrivacyRequests,
  usePrivacyDocuments,
  usePrivacyMe,
  useUpdatePrivacyRequest,
  type PrivacyRequest,
} from "@/lib/privacy";

const DESCRIPTION_MAX = 2000;

function fmt(value: string | null | undefined, pattern = "dd/MM/yyyy HH:mm"): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, pattern, { locale: ptBR });
}

function StatusBadge({ status }: { status: PrivacyRequest["status"] }) {
  const cls =
    status === "CONCLUIDA"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "INDEFERIDA"
        ? "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300"
        : status === "EM_ANALISE"
          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300"
          : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300";
  return <Badge variant="outline" className={cls}>{PRIVACY_STATUS_LABELS[status]}</Badge>;
}

export default function PrivacyCenter() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const { toast } = useToast();
  const docs = usePrivacyDocuments();
  const me = usePrivacyMe(Boolean(user));
  const myRequests = useMyPrivacyRequests(Boolean(user));
  const createRequest = useCreatePrivacyRequest();
  const [type, setType] = useState("ACESSO");
  const [description, setDescription] = useState("");
  const [downloading, setDownloading] = useState(false);

  const lastAcceptance = useMemo(() => {
    const map = new Map<string, { version: number; createdAt: string; kind: string }>();
    for (const a of me.data?.acceptances ?? []) {
      const cur = map.get(a.documentType);
      if (!cur || a.version > cur.version) map.set(a.documentType, a);
    }
    return map;
  }, [me.data]);

  const contacts = docs.data?.contacts;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadMyData();
      toast({ title: "Arquivo com os seus dados baixado." });
    } catch (err) {
      toast({ title: privacyErrorMessage(err, "Não foi possível gerar a cópia agora."), variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const submit = () => {
    const text = description.trim();
    if (text.length < 10) {
      toast({ title: "Descreva o pedido com pelo menos 10 caracteres.", variant: "destructive" });
      return;
    }
    createRequest.mutate(
      { type, description: text },
      {
        onSuccess: (r) => {
          setDescription("");
          toast({ title: `Solicitação registrada: ${r.protocol}`, description: "Acompanhe o andamento nesta página." });
        },
        onError: (err) => toast({ title: privacyErrorMessage(err, "Não foi possível registrar agora."), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ShieldCheck className="h-7 w-7 text-primary" /> Privacidade
        </h1>
        <p className="mt-1 text-muted-foreground">
          Documentos, seus dados e solicitações sobre proteção de dados pessoais (LGPD).
        </p>
      </div>

      <Tabs defaultValue="documentos">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="dados">Meus dados</TabsTrigger>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          {isAdmin ? <TabsTrigger value="admin">Solicitações recebidas</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="documentos" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {(docs.data?.documents ?? []).map((d) => {
              const acc = lastAcceptance.get(d.type);
              const upToDate = acc && acc.version >= d.version;
              return (
                <Card key={d.type}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="h-4 w-4 text-primary" /> {d.title}
                    </CardTitle>
                    <CardDescription>Versão {d.version} · vigente desde {d.effectiveDate.split("-").reverse().join("/")}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className={upToDate ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                      {upToDate
                        ? `${acc!.kind === "ACEITE_CADASTRO" ? "Aceito no cadastro" : "Ciência confirmada"} em ${fmt(acc!.createdAt)}`
                        : "Ciência pendente nesta versão"}
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <a href={DOCUMENT_PATHS[d.type]} target="_blank" rel="noopener noreferrer">
                        Ler documento <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Encarregado pelo tratamento de dados</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p>Responsável (controlador): <span className="text-foreground">{contacts?.controller ?? "a definir"}</span></p>
              <p>Encarregado: <span className="text-foreground">{contacts?.dpoName ?? "a definir"}</span></p>
              <p>Contato: <span className="text-foreground">{contacts?.dpoEmail ?? "a definir"}</span></p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dados" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Baixar uma cópia dos meus dados</CardTitle>
              <CardDescription>
                Gera na hora um arquivo (JSON) com o seu cadastro, os chamados que você abriu, as mensagens que enviou, avaliações,
                aceites de privacidade, solicitações e eventos de segurança da sua conta. Senhas não são incluídas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={() => void download()} disabled={downloading}>
                <Download className="mr-2 h-4 w-4" /> {downloading ? "Gerando..." : "Baixar meus dados"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Para corrigir dados de cadastro, use o seu Perfil. Para outros pedidos (eliminação, oposição, compartilhamento etc.),
                registre uma solicitação.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="solicitacoes" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nova solicitação do titular</CardTitle>
              <CardDescription>
                Você recebe um protocolo. O pedido é analisado por pessoa responsável, que pode confirmar a sua identidade antes de
                atender. Não inclua dados de pacientes nem senhas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="privacy_req_type">Tipo de pedido</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="privacy_req_type" className="md:w-[420px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIVACY_REQUEST_TYPES).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="privacy_req_desc">Descreva o pedido</Label>
                <Textarea
                  id="privacy_req_desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  placeholder="Ex.: Quero saber com quem meus dados de contato são compartilhados."
                />
                <p className="text-right text-xs text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</p>
              </div>
              <Button onClick={submit} disabled={createRequest.isPending}>
                <Send className="mr-2 h-4 w-4" /> {createRequest.isPending ? "Enviando..." : "Registrar solicitação"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Minhas solicitações</CardTitle>
            </CardHeader>
            <CardContent>
              {myRequests.isLoading ? (
                <p className="text-sm text-muted-foreground">Carregando...</p>
              ) : (myRequests.data ?? []).length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Inbox className="h-4 w-4" /> Nenhuma solicitação registrada.</p>
              ) : (
                <ul className="space-y-3">
                  {(myRequests.data ?? []).map((r) => (
                    <li key={r.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold tabular-nums">{r.protocol}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1 text-muted-foreground">{r.typeLabel} · aberta em {fmt(r.createdAt)}</p>
                      <p className="mt-2 whitespace-pre-wrap">{r.description}</p>
                      {r.response ? (
                        <div className="mt-2 rounded-md bg-muted/50 p-2">
                          <p className="text-xs font-medium">Resposta ({fmt(r.resolvedAt ?? r.updatedAt)})</p>
                          <p className="mt-1 whitespace-pre-wrap">{r.response}</p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="admin" className="mt-4">
            <AdminRequests />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function AdminRequests() {
  const { toast } = useToast();
  const list = useAdminPrivacyRequests(true);
  const update = useUpdatePrivacyRequest();
  const [editing, setEditing] = useState<PrivacyRequest | null>(null);
  const [status, setStatus] = useState<PrivacyRequest["status"]>("CONCLUIDA");
  const [response, setResponse] = useState("");

  const openEditor = (r: PrivacyRequest) => {
    setEditing(r);
    setStatus(r.status === "ABERTA" ? "EM_ANALISE" : "CONCLUIDA");
    setResponse(r.response ?? "");
  };

  const save = () => {
    if (!editing) return;
    update.mutate(
      { id: editing.id, status, response: response.trim() },
      {
        onSuccess: () => {
          toast({ title: `Solicitação ${editing.protocol} atualizada.` });
          setEditing(null);
        },
        onError: (err) => toast({ title: privacyErrorMessage(err, "Não foi possível atualizar."), variant: "destructive" }),
      },
    );
  };

  const rows = list.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Solicitações de titulares</CardTitle>
        <CardDescription>
          Confirme a identidade do titular quando necessário. Nada é executado automaticamente: faça a ação no sistema e registre a
          resposta. Pedidos encerrados não podem ser alterados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Inbox className="h-4 w-4" /> Nenhuma solicitação.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums">{r.protocol}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {r.status === "ABERTA" || r.status === "EM_ANALISE" ? (
                      <Button size="sm" variant="outline" onClick={() => openEditor(r)}>Responder</Button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {r.typeLabel} · {r.user ? `${r.user.name} (${r.user.email})` : "titular removido"} · {fmt(r.createdAt)}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{r.description}</p>
                {r.response ? (
                  <p className="mt-2 rounded-md bg-muted/50 p-2 whitespace-pre-wrap">
                    <span className="block text-xs font-medium">Resposta{r.resolvedByName ? ` de ${r.resolvedByName}` : ""}:</span>
                    {r.response}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing != null} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Responder {editing?.protocol}</DialogTitle>
            <DialogDescription>{editing?.typeLabel}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="privacy_admin_status">Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as PrivacyRequest["status"])}>
                <SelectTrigger id="privacy_admin_status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EM_ANALISE">Em análise</SelectItem>
                  <SelectItem value="CONCLUIDA">Concluída</SelectItem>
                  <SelectItem value="INDEFERIDA">Indeferida (com justificativa)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="privacy_admin_response">Resposta ao titular</Label>
              <Textarea id="privacy_admin_response" rows={5} value={response} onChange={(e) => setResponse(e.target.value.slice(0, 4000))} />
              <p className="text-xs text-muted-foreground">Obrigatória para concluir ou indeferir. O titular verá este texto.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} disabled={update.isPending}>{update.isPending ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
