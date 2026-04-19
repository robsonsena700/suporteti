import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";

type AttachmentMeta = {
  id: number;
  filename: string;
  mimeType: string;
};

type ImageItem = {
  id: number;
  filename: string;
  mimeType: string;
  url?: string;
};

export function TicketImageModal({
  open,
  onOpenChange,
  ticketId,
  ticketTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: number;
  ticketTitle: string;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);

  const current = images[index] ?? null;

  const token = useMemo(() => localStorage.getItem("ti_support_token"), []);

  const apiUrl = (attachmentId: number) => `/api/tickets/${ticketId}/attachments/${attachmentId}`;

  const cleanupUrls = (items: ImageItem[]) => {
    for (const it of items) {
      if (it.url) URL.revokeObjectURL(it.url);
    }
  };

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setIndex(0);
    setImages([]);
    setLoadError(null);

    const run = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/tickets/${ticketId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!resp.ok) {
          setLoadError("Não foi possível carregar os anexos do chamado.");
          return;
        }
        const data = await resp.json();
        const atts: AttachmentMeta[] = Array.isArray(data?.attachments) ? data.attachments : [];
        const imgs = atts
          .filter(a => typeof a?.mimeType === "string" && a.mimeType.startsWith("image/"))
          .map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType }));
        setImages(imgs);
        if (imgs.length === 0) {
          setLoadError("Este chamado não possui imagens anexadas.");
        }
      } catch {
        setLoadError("Erro ao carregar anexos. Verifique sua conexão e tente novamente.");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [open, ticketId, token]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => (i > 0 ? i - 1 : i));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndex((i) => (i < images.length - 1 ? i + 1 : i));
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale(s => Math.min(3, Number((s + 0.25).toFixed(2))));
      }
      if (e.key === "-") {
        e.preventDefault();
        setScale(s => Math.max(1, Number((s - 0.25).toFixed(2))));
      }
      if (e.key === "0") {
        e.preventDefault();
        setScale(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, images.length]);

  useEffect(() => {
    if (!open) return;
    if (!current) return;
    if (current.url) return;

    let cancelled = false;
    const run = async () => {
      try {
        const resp = await fetch(apiUrl(current.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!resp.ok) {
          if (!cancelled) setLoadError("Não foi possível carregar a imagem.");
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setImages((prev) =>
          prev.map((it) => (it.id === current.id ? { ...it, url } : it)),
        );
      } catch {
        if (!cancelled) setLoadError("Não foi possível carregar a imagem.");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, current, token]);

  useEffect(() => {
    if (open) return;
    setLoading(false);
    setLoadError(null);
    setIndex(0);
    setScale(1);
    setImages((prev) => {
      cleanupUrls(prev);
      return [];
    });
  }, [open]);

  const canPrev = index > 0;
  const canNext = index < images.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-base">
              {ticketTitle}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {images.length > 0 ? `Imagem ${index + 1} de ${images.length}` : "Imagens anexadas"}
            </p>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="bg-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b bg-background">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => setIndex(i => (i > 0 ? i - 1 : i))} disabled={!canPrev} aria-label="Imagem anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setIndex(i => (i < images.length - 1 ? i + 1 : i))} disabled={!canNext} aria-label="Próxima imagem">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => setScale(s => Math.max(1, Number((s - 0.25).toFixed(2))))} disabled={scale <= 1} aria-label="Diminuir zoom">
                <Minus className="h-4 w-4" />
              </Button>
              <div className="min-w-[72px] text-center text-sm tabular-nums">
                {Math.round(scale * 100)}%
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setScale(s => Math.min(3, Number((s + 0.25).toFixed(2))))} disabled={scale >= 3} aria-label="Aumentar zoom">
                <Plus className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setScale(1)} disabled={scale === 1} aria-label="Resetar zoom">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="p-4">
            {loading ? (
              <div className="h-[60vh] flex items-center justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : loadError ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center gap-2">
                <p className="text-sm">{loadError}</p>
                <p className="text-xs text-muted-foreground">
                  Verifique se você possui permissão para acessar este chamado e se a API está disponível.
                </p>
              </div>
            ) : current ? (
              <div className="rounded-md bg-background border overflow-auto max-h-[70vh]">
                <div className="min-h-[60vh] flex items-center justify-center p-4">
                  {current.url ? (
                    <img
                      src={current.url}
                      alt={current.filename}
                      className="max-w-full max-h-[65vh] object-contain"
                      style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
                    />
                  ) : (
                    <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                      <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
                      Carregando imagem...
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

