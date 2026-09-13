import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Paperclip, X, FileText } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TELA DE TESTE — "Abrir Chamados 2"
//
// Propósito único: isolar se o problema de anexo no mobile é causado pela
// complexidade da tela normal de "Novo Chamado" (rascunho automático em
// IndexedDB, múltiplos listeners nativos, sondagem de foco/visibilidade,
// autosave, etc.) ou se é um problema mais fundamental do aparelho/navegador.
//
// Esta tela é DELIBERADAMENTE simples: um único <input type="file"> com
// onChange padrão do React, sem nenhum truque extra. Se o anexo funcionar
// aqui e falhar na tela normal, o problema está na complexidade daquela
// tela. Se falhar aqui também, o problema é do aparelho/navegador em si.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ACCEPT = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/heic", "image/heif",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt",
].join(",");

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function logTest(level: "info" | "warn" | "error", event: string, context: Record<string, unknown> = {}) {
  const payload = {
    source: "attachment-debug-test-screen",
    event,
    timestamp: new Date().toISOString(),
    route: "/chamados/novo-teste",
    href: typeof window !== "undefined" ? window.location.href : null,
    ...context,
  };
  if (level === "error") console.error("[attachment-debug-teste]", payload);
  else if (level === "warn") console.warn("[attachment-debug-teste]", payload);
  else console.log("[attachment-debug-teste]", payload);

  try {
    const token = window.localStorage.getItem("ti_support_token");
    if (!token) return;
    void fetch("/api/attachment-diagnostics/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ level, event, sessionId: "teste-tela-2", context: payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}

export default function NewTicketTest() {
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    logTest("info", "test.page.mounted", {});
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    logTest("info", "test.input.change_event", {
      fileCount: list.length,
      files: list.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });

    if (list.length === 0) {
      logTest("warn", "test.input.empty_selection", {});
      return;
    }

    const f = list[0];
    if (f.size > MAX_FILE_SIZE) {
      toast({
        title: "Arquivo muito grande",
        description: `Máximo permitido: ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
        variant: "destructive",
      });
      logTest("warn", "test.input.rejected_size", { name: f.name, size: f.size });
      return;
    }

    setFiles([f]);
    setPreviews([isImage(f.type) ? URL.createObjectURL(f) : ""]);
    setSaved(false);
    logTest("info", "test.input.accepted", { name: f.name, size: f.size, type: f.type });
  };

  const removeFile = () => {
    if (previews[0]) URL.revokeObjectURL(previews[0]);
    setFiles([]);
    setPreviews([]);
    setSaved(false);
  };

  const handleSave = () => {
    if (files.length === 0) {
      toast({
        title: "Anexo obrigatório",
        description: "Selecione ao menos 1 arquivo antes de salvar.",
        variant: "destructive",
      });
      logTest("warn", "test.save.blocked_no_file", {});
      return;
    }
    setSaved(true);
    logTest("info", "test.save.success", {
      name: files[0].name,
      size: files[0].size,
      type: files[0].type,
    });
    toast({
      title: "Teste OK!",
      description: `Arquivo capturado com sucesso: ${files[0].name} (${formatBytes(files[0].size)}).`,
    });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chamados">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Abrir Chamados 2 (teste)</h1>
          <p className="text-sm text-muted-foreground">
            Tela simplificada só para testar o anexo de arquivo no celular.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <label className="mb-2 block text-sm font-medium">
              Anexo <span className="text-destructive">*</span>
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Imagens ou documentos. Máximo 8 MB. Obrigatório para salvar.
            </p>
            <input
              type="file"
              accept={ACCEPT}
              onChange={onInputChange}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
          </div>

          {files.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              {isImage(files[0].type) && previews[0] ? (
                <img src={previews[0]} alt={files[0].name} className="h-12 w-12 rounded object-cover" />
              ) : (
                <FileText className="h-8 w-8 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{files[0].name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(files[0].size)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={removeFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {saved && (
            <div className="rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2 text-sm text-green-700">
              Salvo com sucesso nesta tela de teste.
            </div>
          )}

          <Button type="button" className="w-full" onClick={handleSave}>
            <Paperclip className="mr-2 h-4 w-4" />
            Salvar (teste)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
