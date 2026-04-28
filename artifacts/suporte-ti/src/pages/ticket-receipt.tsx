import { useEffect, useMemo, useRef } from "react";
import { useRoute } from "wouter";
import { getGetTicketQueryKey, useGetTicket, TicketPriority, TicketStatus, TicketType } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Printer, ArrowLeft } from "lucide-react";
import { UserAvatar } from "@/components/user/user-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function labelStatus(status: TicketStatus): string {
  if (status === TicketStatus.OPEN) return "Aberto";
  if (status === TicketStatus.IN_PROGRESS) return "Em Andamento";
  if (status === TicketStatus.AWAITING_CUSTOMER) return "Aguardando Cliente";
  if (status === TicketStatus.RESOLVED) return "Resolvido";
  return "Cancelado";
}

export function labelPriority(priority: TicketPriority): string {
  if (priority === TicketPriority.LOW) return "Baixa";
  if (priority === TicketPriority.MEDIUM) return "Média";
  return "Alta";
}

export function labelType(type: TicketType, hardwareSubtype?: string | null): string {
  if (type === TicketType.HARDWARE) return hardwareSubtype ? `Hardware • ${hardwareSubtype}` : "Hardware";
  return "Software";
}

export default function TicketReceipt() {
  const [, params] = useRoute("/chamados/:id/comprovante");
  const id = useMemo(() => {
    const raw = params?.id ?? "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [params?.id]);

  const search = typeof window !== "undefined" ? window.location.search : "";
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const autoPrint = query.get("autoprint") === "1";
  const paper = (query.get("paper") || "a4").toLowerCase() === "letter" ? "Letter" : "A4";
  const bw = query.get("bw") === "1";

  const printedRef = useRef(false);
  const { data: ticket, isLoading, isError } = useGetTicket(id, {
    query: { enabled: id > 0, queryKey: getGetTicketQueryKey(id) },
  });

  const protocol = ticket ? `#${ticket.id}` : "#—";
  const qrUrl = useMemo(() => {
    const text = ticket ? String(ticket.id) : "";
    const size = 180;
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  }, [ticket]);

  useEffect(() => {
    if (!autoPrint) return;
    if (!ticket) return;
    if (printedRef.current) return;
    printedRef.current = true;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, [autoPrint, ticket]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="min-h-screen bg-white p-6">
        <p className="text-sm text-slate-700">Não foi possível gerar o comprovante deste chamado.</p>
      </div>
    );
  }

  const openedAt = format(new Date(ticket.createdAt), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
  const updatedAt = format(new Date(ticket.updatedAt), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const docId = `ST-${ticket.id}-${format(new Date(ticket.createdAt), "yyyyMMddHHmm", { locale: ptBR })}`;
  const messages = ticket.messages ?? [];

  return (
    <div className={`bg-white text-slate-900 antialiased ${bw ? "bw-print" : ""}`}>
      <style>{`
        @page { size: ${paper}; margin: 18mm; }
        body { background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-container { width: 100% !important; box-shadow: none !important; border: none !important; }
        .transcript-line { border-bottom: 1px solid #e5e7eb; padding: 10px 0; }
        .transcript-line:last-child { border-bottom: none; }
        @media print { .no-print { display: none !important; } }
        .bw-print * { color: #000 !important; background: transparent !important; border-color: #000 !important; }
      `}</style>

      <div className="no-print sticky top-0 bg-white border-b">
        <div className="max-w-[880px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href={`/chamados/${ticket.id}`} className="inline-flex items-center gap-2 text-sm text-slate-700 hover:underline">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao chamado
          </a>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir / Salvar PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-[880px] mx-auto p-4 md:p-8 print-container">
        <div className="border-b-2 border-slate-900 pb-4 mb-8 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <img src="/favicon.png" alt="Logo" className="w-10 h-10 object-contain" />
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight uppercase">Comprovante de Atendimento</h1>
                <p className="text-sm font-semibold text-slate-500 mt-1">SuporteTI • Documento gerado automaticamente</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ID do Documento</p>
            <p className="text-lg font-bold">{docId}</p>
          </div>
        </div>

        <header className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div>
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Assunto do Chamado</span>
            <h2 className="text-xl md:text-2xl font-bold mt-1 break-words">{protocol} — {ticket.title}</h2>
            <div className="flex flex-wrap items-center gap-6 mt-4">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Status</span>
                <div className="text-sm font-bold">{labelStatus(ticket.status)}</div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Prioridade</span>
                <div className="text-sm font-bold">{labelPriority(ticket.priority)}</div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Categoria</span>
                <div className="text-sm font-bold">{labelType(ticket.type, (ticket as any).hardwareSubtype ?? null)}</div>
              </div>
            </div>
          </div>
          <div className="md:text-right">
            <div className="mb-4">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Data e Hora de Abertura</span>
              <p className="text-base md:text-lg font-bold mt-1">{openedAt}</p>
              <p className="text-xs text-slate-500 mt-1">Última atualização: {updatedAt}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Localização</span>
              <p className="text-sm mt-1">{ticket.uf} • {ticket.municipality}{ticket.establishment ? ` • ${ticket.establishment}` : ""}</p>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="md:col-span-2 space-y-10">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-300 mb-4 pb-1">
                Descrição do Problema
              </h3>
              <div className="p-6 rounded border border-slate-200 bg-slate-50">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-300 mb-4 pb-1">
                Transcrição das Interações
              </h3>
              <div className="space-y-0">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-600">Nenhuma interação registrada.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="transcript-line flex items-start gap-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="shrink-0">
                            <UserAvatar
                              userId={(m as any).senderId ?? m.sender?.id ?? null}
                              name={m.sender?.name ?? "—"}
                              className="h-8 w-8"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>{m.sender?.name ?? "—"}</span>
                        </TooltipContent>
                      </Tooltip>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4 mb-1">
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {m.sender?.name ?? "—"} ({m.sender?.role ?? "—"})
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
                            {format(new Date(m.createdAt), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="space-y-8">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-200 mb-4 pb-1 text-slate-700">
                Solicitante
              </h3>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Nome</p>
                  <p className="text-sm font-semibold">{ticket.createdBy?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Email</p>
                  <p className="text-sm">{ticket.createdBy?.email ?? "—"}</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-200 mb-4 pb-1 text-slate-700">
                Responsável
              </h3>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Atendente</p>
                  <p className="text-sm font-semibold">{ticket.assignedTo?.name ?? "Não atribuído"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Perfil</p>
                  <p className="text-sm">{ticket.assignedTo?.role ?? "—"}</p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-200 mb-4 pb-1 text-slate-700">
                Verificação (QR Code)
              </h3>
              <div className="flex gap-4 items-start">
                <div className="w-24 h-24 border border-slate-200 bg-white p-1 shrink-0">
                  <img src={qrUrl} alt="QR Code" className="w-full h-full object-contain" />
                </div>
                <div>
                  <p className="text-[11px] text-slate-600 leading-snug">
                    Use o QR Code para localizar rapidamente o protocolo <span className="font-bold">{protocol}</span>.
                  </p>
                  <p className="text-[10px] text-slate-500 mt-2">
                    Código: <span className="font-mono font-bold">{ticket.id}</span>
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest border-b border-slate-200 mb-4 pb-1 text-slate-700">
                Contato do Suporte
              </h3>
              <div className="text-sm text-slate-700 space-y-1">
                <p>Email: suporte@suporteti.local</p>
                <p>Telefone: (00) 0000-0000</p>
                <p>Horário: Seg–Sex, 08:00–18:00</p>
              </div>
            </section>
          </div>
        </div>

        <footer className="mt-16 pt-6 border-t border-slate-200 flex items-start justify-between text-slate-500">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700">SuporteTI</p>
            <p className="text-[9px] mt-1">© {new Date().getFullYear()} — Documento gerado automaticamente.</p>
          </div>
          <div className="text-right text-[10px] font-bold">PÁGINA 1</div>
        </footer>
      </div>
    </div>
  );
}
