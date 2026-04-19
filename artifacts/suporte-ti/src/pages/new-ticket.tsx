import { useState, useRef, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import { useCreateTicket, TicketType, TicketPriority } from "@workspace/api-client-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Paperclip, X, FileText, Image, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Hardware subtype options ──────────────────────────────────────────────────

const HARDWARE_SUBTYPES = [
  "Formatação",
  "Recarga",
  "Troca",
  "Aquisição",
  "CPU",
  "Impressora",
  "Memória",
  "Teclado",
  "Mouse",
  "Cabo de rede",
  "Conector",
  "Tablet",
  "TV",
  "Transformador",
  "Cabo HDMI",
  "VGA",
  "USB",
  "DVI",
  "Força",
  "Outro",
];

// ── Form schema ───────────────────────────────────────────────────────────────

const ticketSchema = z.object({
  type: z.nativeEnum(TicketType),
  title: z.string().min(5, "Título muito curto (mínimo 5 caracteres)"),
  description: z.string().min(10, "Descrição muito curta (mínimo 10 caracteres)"),
  priority: z.nativeEnum(TicketPriority),
  hardwareSubtype: z.string().optional(),
});

type TicketForm = z.infer<typeof ticketSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB
const MAX_FILES = 3;

const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewTicket() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateTicket();

  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      type: TicketType.SOFTWARE,
      title: "",
      description: "",
      priority: TicketPriority.LOW,
      hardwareSubtype: undefined,
    },
  });

  const selectedType = form.watch("type");

  // ── File handling ─────────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: File[]) => {
    const errors: string[] = [];
    const accepted: File[] = [];

    for (const f of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        errors.push(`Máximo de ${MAX_FILES} arquivos permitidos.`);
        break;
      }
      if (!ALLOWED_MIME.includes(f.type)) {
        errors.push(`"${f.name}": tipo de arquivo não permitido.`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`"${f.name}": arquivo muito grande (máx. 3 MB).`);
        continue;
      }
      accepted.push(f);
    }

    setFileErrors(errors);
    if (!accepted.length) return;

    const newFiles = [...files, ...accepted].slice(0, MAX_FILES);
    setFiles(newFiles);

    // Generate previews
    const previews = [...filePreviews];
    for (const f of accepted.slice(0, MAX_FILES - files.length)) {
      if (isImage(f.type)) {
        previews.push(URL.createObjectURL(f));
      } else {
        previews.push("");
      }
    }
    setFilePreviews(previews);
  }, [files, filePreviews]);

  const removeFile = (idx: number) => {
    if (filePreviews[idx]) URL.revokeObjectURL(filePreviews[idx]);
    setFiles((p) => p.filter((_, i) => i !== idx));
    setFilePreviews((p) => p.filter((_, i) => i !== idx));
    setFileErrors([]);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const onSubmit = async (data: TicketForm) => {
    // Clear subtype if not hardware
    const payload = {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      hardwareSubtype: data.type === TicketType.HARDWARE ? data.hardwareSubtype : undefined,
    };

    createMutation.mutate(
      { data: payload },
      {
        onSuccess: async (ticket) => {
          // Upload attachments if any
          if (files.length > 0) {
            setUploading(true);
            try {
              const formData = new FormData();
              files.forEach((f) => formData.append("files", f));
              await fetch(`/api/tickets/${ticket.id}/attachments`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${localStorage.getItem("ti_support_token")}`,
                },
                body: formData,
              });
            } catch {
              toast({
                title: "Chamado criado, mas erro nos anexos",
                description: "O chamado foi aberto. Você pode adicionar os anexos depois.",
                variant: "destructive",
              });
            } finally {
              setUploading(false);
            }
          }

          toast({
            title: "Chamado criado com sucesso",
            description: `Protocolo #${ticket.id} gerado.`,
          });
          setLocation(`/chamados/${ticket.id}`);
        },
        onError: () => {
          toast({
            title: "Erro ao criar chamado",
            description: "Tente novamente em instantes.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const isSubmitting = createMutation.isPending || uploading;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Novo Chamado</h1>
          <p className="text-muted-foreground mt-1">
            Preencha os dados abaixo para relatar um incidente ou solicitar serviço.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              {/* 1 — Tipo de Solicitação */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>1. Tipo de Solicitação</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue("hardwareSubtype", undefined);
                      }}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TicketType.SOFTWARE}>Software</SelectItem>
                        <SelectItem value={TicketType.HARDWARE}>Hardware</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Hardware subtype — conditional */}
              {selectedType === TicketType.HARDWARE && (
                <FormField
                  control={form.control}
                  name="hardwareSubtype"
                  render={({ field }) => (
                    <FormItem className="-mt-2 ml-4 pl-4 border-l-2 border-primary/20">
                      <FormLabel className="text-sm text-muted-foreground">Subcategoria de Hardware</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a subcategoria" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          {HARDWARE_SUBTYPES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* 2 — Título */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>2. Título resumido</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Monitor não liga após reinicialização" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 3 — Descrição */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>3. Descrição detalhada</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Descreva o problema passo a passo, incluindo o que foi feito, quando ocorreu e qualquer mensagem de erro exibida..."
                        className="min-h-[140px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 4 — Prioridade */}
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>4. Prioridade</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a prioridade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={TicketPriority.LOW}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                            Baixa
                          </span>
                        </SelectItem>
                        <SelectItem value={TicketPriority.MEDIUM}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
                            Média
                          </span>
                        </SelectItem>
                        <SelectItem value={TicketPriority.HIGH}>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
                            Alta
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 5 — Anexos */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium leading-none mb-1">5. Anexo</p>
                  <p className="text-xs text-muted-foreground">
                    Imagens ou documentos. Máximo {MAX_FILES} arquivos de até 3 MB cada.
                  </p>
                </div>

                {/* Drop zone */}
                {files.length < MAX_FILES && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors select-none",
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/30"
                    )}
                  >
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">Clique para selecionar ou arraste arquivos aqui</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPG, PNG, GIF, PDF, DOC, XLS, TXT — máx. 3 MB por arquivo
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ALLOWED_MIME.join(",")}
                      className="hidden"
                      onChange={onFileInput}
                    />
                  </div>
                )}

                {/* File list */}
                {files.length > 0 && (
                  <div className="space-y-2">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                        {isImage(f.type) && filePreviews[i] ? (
                          <img
                            src={filePreviews[i]}
                            alt={f.name}
                            className="h-12 w-12 rounded object-cover shrink-0 border"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            {f.type === "application/pdf"
                              ? <FileText className="h-6 w-6 text-primary" />
                              : <Paperclip className="h-6 w-6 text-primary" />}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{f.name}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="p-1 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Errors */}
                {fileErrors.length > 0 && (
                  <div className="space-y-1">
                    {fileErrors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive">{e}</p>
                    ))}
                  </div>
                )}

                {files.length >= MAX_FILES && (
                  <p className="text-xs text-muted-foreground">
                    Limite de {MAX_FILES} arquivos atingido.
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-4 pt-2">
                <Button variant="outline" asChild>
                  <Link href="/chamados">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? uploading ? "Enviando anexos..." : "Salvando..."
                    : "Abrir Chamado"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
