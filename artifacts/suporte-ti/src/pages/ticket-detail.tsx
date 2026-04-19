import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { 
  useGetTicket, 
  useUpdateTicket, 
  useListMessages,
  useCreateMessage,
  useGetTicketRating,
  useRateTicket,
  useListUsers,
  useAssignTicket,
  getGetTicketQueryKey,
  getListMessagesQueryKey,
  getGetTicketRatingQueryKey,
  TicketStatus,
  TicketPriority,
  UserRole
} from "@workspace/api-client-react";
import { StatusBadge, PriorityBadge, TypeBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Star, UserCircle2, FileText, Paperclip, Download, Eye } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Attachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export default function TicketDetail() {
  const [, params] = useRoute("/chamados/:id");
  const ticketId = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [textPreview, setTextPreview] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");

  useEffect(() => {
    if (previewOpen) return;
    setPreviewAtt(null);
    setTextPreview("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  }, [previewOpen, previewUrl]);

  const {
    data: ticket,
    isLoading,
    isError,
    error,
  } = useGetTicket(ticketId, {
    query: {
      enabled: Number.isFinite(ticketId) && ticketId > 0,
      queryKey: getGetTicketQueryKey(ticketId),
    }
  });

  const { data: messages } = useListMessages(ticketId, {
    query: {
      enabled: !!ticketId,
      queryKey: getListMessagesQueryKey(ticketId),
    }
  });

  const { data: ratingData } = useGetTicketRating(ticketId, {
    query: {
      enabled: !!ticketId && ticket?.status === TicketStatus.RESOLVED,
      queryKey: getGetTicketRatingQueryKey(ticketId),
    }
  });

  const updateMutation = useUpdateTicket();
  const messageMutation = useCreateMessage();
  const rateMutation = useRateTicket();
  const assignMutation = useAssignTicket();

  const handleUpdateStatus = (status: TicketStatus) => {
    updateMutation.mutate(
      { id: ticketId, data: { status } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
          toast({ title: "Status atualizado com sucesso" });
        }
      }
    );
  };

  const handleSendMessage = () => {
    if (!message.trim()) return;
    messageMutation.mutate(
      { ticketId, data: { message: message.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(ticketId) });
          setMessage("");
        }
      }
    );
  };

  const handleRate = () => {
    if (!rating) return;
    rateMutation.mutate(
      { ticketId, data: { score: rating, feedback } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTicketRatingQueryKey(ticketId) });
          toast({ title: "Avaliação enviada com sucesso!" });
        }
      }
    );
  };

  const handleAssignToMe = () => {
    if (!user) return;
    assignMutation.mutate(
      { id: ticketId, data: { assignedToId: user.id } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetTicketQueryKey(ticketId), data);
          toast({ title: "Chamado atribuído a você" });
        }
      }
    );
  };

  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chamados">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chamado inválido</h1>
            <p className="text-muted-foreground text-sm mt-1">O ID do chamado não é válido.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    const message = (error as any)?.message || "Não foi possível carregar o chamado.";
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chamados">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">Erro ao carregar chamado</h1>
            <p className="text-muted-foreground text-sm mt-1">{message}</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm">
              Possíveis causas: API fora do ar, falta de permissão, ou banco desatualizado (migrations pendentes).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/chamados">Voltar</Link>
              </Button>
              <Button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) })}
              >
                Tentar novamente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !ticket) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const canManage = user?.role === UserRole.ADMIN || user?.role === UserRole.ANALYST || user?.role === UserRole.COORDINATOR;
  const isCreator = ticket.createdById === user?.id;
  const attachmentApiUrl = (att: Attachment) => `/api/tickets/${ticket.id}/attachments/${att.id}`;

  const fetchAttachmentBlob = async (att: Attachment) => {
    const resp = await fetch(attachmentApiUrl(att), {
      headers: { Authorization: `Bearer ${localStorage.getItem("ti_support_token")}` },
    });
    if (!resp.ok) throw new Error("Falha ao baixar anexo");
    return resp.blob();
  };

  const downloadAttachment = async (att: Attachment) => {
    try {
      const blob = await fetchAttachmentBlob(att);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Erro ao baixar anexo",
        description: "Tente novamente em instantes.",
        variant: "destructive",
      });
    }
  };

  const openPreview = async (att: Attachment) => {
    setPreviewAtt(att);
    setTextPreview("");
    setPreviewOpen(true);
    try {
      if (att.mimeType === "text/plain") {
        const resp = await fetch(attachmentApiUrl(att), {
          headers: { Authorization: `Bearer ${localStorage.getItem("ti_support_token")}` },
        });
        setTextPreview(resp.ok ? await resp.text() : "Não foi possível carregar a prévia do arquivo.");
        return;
      }

      if (att.mimeType.startsWith("image/") || att.mimeType === "application/pdf") {
        const blob = await fetchAttachmentBlob(att);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch {
      setTextPreview("Não foi possível carregar a prévia do arquivo.");
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">#{ticket.id} - {ticket.title}</h1>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Aberto por {ticket.createdBy.name} em {format(new Date(ticket.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </p>
        </div>
        {canManage && ticket.status !== TicketStatus.CLOSED && (
          <div className="flex gap-2">
            {!ticket.assignedToId && (
               <Button variant="secondary" onClick={handleAssignToMe} disabled={assignMutation.isPending}>
                 Atribuir a mim
               </Button>
            )}
            <Select 
              value={ticket.status} 
              onValueChange={(v) => handleUpdateStatus(v as TicketStatus)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Atualizar status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TicketStatus.OPEN}>Aberto</SelectItem>
                <SelectItem value={TicketStatus.IN_PROGRESS}>Em Andamento</SelectItem>
                <SelectItem value={TicketStatus.RESOLVED}>Resolvido</SelectItem>
                <SelectItem value={TicketStatus.CLOSED}>Fechado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Descrição do Problema</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Interações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {messages?.length ? (
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const isMe = msg.senderId === user?.id;
                    return (
                      <div key={msg.id} className={cn("flex gap-3", isMe ? "flex-row-reverse" : "flex-row")}>
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <UserCircle2 className="w-5 h-5 text-secondary-foreground" />
                        </div>
                        <div className={cn("flex flex-col max-w-[80%]", isMe ? "items-end" : "items-start")}>
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xs font-medium">{isMe ? "Você" : msg.sender.name}</span>
                            <span className="text-[10px] text-muted-foreground">{format(new Date(msg.createdAt), "dd/MM HH:mm")}</span>
                          </div>
                          <div className={cn(
                            "px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap",
                            isMe ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
                          )}>
                            {msg.message}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Nenhuma mensagem registrada.
                </div>
              )}

              {ticket.status !== TicketStatus.CLOSED && (
                <div className="mt-4 pt-4 border-t flex gap-2">
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="min-h-[80px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button 
                    className="self-end" 
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={!message.trim() || messageMutation.isPending}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Detalhes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Tipo</span>
                <TypeBadge type={ticket.type} />
              </div>
              {(ticket as any).hardwareSubtype && (
                <div>
                  <span className="text-muted-foreground block mb-1">Subcategoria</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    {(ticket as any).hardwareSubtype}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground block mb-1">Prioridade</span>
                <PriorityBadge priority={ticket.priority} />
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Localidade</span>
                <p className="font-medium">{ticket.municipality} - {ticket.uf}</p>
              </div>
              {ticket.establishment ? (
                <div>
                  <span className="text-muted-foreground block mb-1">Estabelecimento / Unidade</span>
                  <p className="font-medium">{ticket.establishment}</p>
                </div>
              ) : null}
              <div>
                <span className="text-muted-foreground block mb-1">Responsável</span>
                <p className="font-medium">
                  {ticket.assignedTo ? ticket.assignedTo.name : "Não atribuído"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Attachments */}
          {((ticket as any).attachments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  Anexos ({(ticket as any).attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(ticket as any).attachments.map((att: Attachment) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 hover:bg-muted/60 transition-colors group"
                  >
                    <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      {att.mimeType.startsWith("image/")
                        ? <span className="text-lg">🖼️</span>
                        : att.mimeType === "application/pdf"
                        ? <FileText className="h-5 w-5 text-red-500" />
                        : <Paperclip className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{att.filename}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(att.size)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button type="button" variant="outline" size="icon" onClick={() => openPreview(att)} aria-label="Visualizar anexo">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <button
                        type="button"
                        onClick={() => downloadAttachment(att)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background shadow-sm hover:bg-muted/50 tap-target"
                        aria-label="Baixar anexo"
                      >
                        <Download className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      </button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {ticket.status === TicketStatus.RESOLVED && isCreator && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Avalie o Atendimento</CardTitle>
              </CardHeader>
              <CardContent>
                {ratingData ? (
                  <div className="space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} className={cn("w-5 h-5", s <= ratingData.score ? "fill-amber-400 text-amber-400" : "text-muted")} />
                      ))}
                    </div>
                    {ratingData.feedback && (
                      <p className="text-sm italic text-muted-foreground">"{ratingData.feedback}"</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-2 justify-center">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          onClick={() => setRating(s)}
                          className="hover:scale-110 transition-transform"
                        >
                          <Star className={cn("w-8 h-8", s <= rating ? "fill-amber-400 text-amber-400" : "text-muted")} />
                        </button>
                      ))}
                    </div>
                    <Textarea 
                      placeholder="Deixe um comentário (opcional)" 
                      className="resize-none text-sm"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                    <Button 
                      className="w-full" 
                      onClick={handleRate}
                      disabled={!rating || rateMutation.isPending}
                    >
                      Enviar Avaliação
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl w-[95vw] p-0 overflow-hidden">
          <div className="p-4 border-b">
            <DialogHeader>
              <DialogTitle className="text-base">{previewAtt?.filename ?? "Pré-visualização"}</DialogTitle>
            </DialogHeader>
          </div>
          <div className="bg-muted/20 p-4">
            {previewAtt ? (
              previewAtt.mimeType.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt={previewAtt.filename}
                  className="max-h-[70vh] w-full object-contain rounded-md bg-background"
                />
              ) : previewAtt.mimeType === "application/pdf" ? (
                <iframe
                  title={previewAtt.filename}
                  src={previewUrl}
                  className="w-full h-[70vh] rounded-md bg-background"
                />
              ) : previewAtt.mimeType === "text/plain" ? (
                <pre className="whitespace-pre-wrap break-words text-sm rounded-md bg-background p-4 max-h-[70vh] overflow-auto">
                  {textPreview || "Carregando..."}
                </pre>
              ) : (
                <div className="rounded-md bg-background p-4 text-sm">
                  <p className="text-muted-foreground">
                    Pré-visualização não disponível para este tipo de arquivo. Faça o download para abrir no seu dispositivo.
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => previewAtt && downloadAttachment(previewAtt)}
                      className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted/50 tap-target"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Baixar arquivo
                    </button>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
