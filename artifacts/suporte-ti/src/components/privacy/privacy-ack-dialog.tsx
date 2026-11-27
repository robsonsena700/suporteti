import { useMemo, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  DOCUMENT_PATHS,
  privacyErrorMessage,
  useAcknowledgePrivacy,
  usePrivacyDocuments,
  usePrivacyMe,
} from "@/lib/privacy";

const DISMISS_KEY = "ti_privacy_ack_later";

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Aviso de ciência: aparece depois do login quando há versão da Política/Termos ainda não
 * confirmada (usuários antigos ou documento atualizado). "Agora não" vale só para esta aba.
 * Ciência registra que a pessoa foi informada; não é consentimento para tratamento de dados.
 */
export function PrivacyAckDialog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const me = usePrivacyMe(Boolean(user));
  const docs = usePrivacyDocuments();
  const ack = useAcknowledgePrivacy();
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());

  const pending = me.data?.pending ?? [];
  const signature = useMemo(() => pending.map((p) => `${p.type}:${p.version}`).join("|"), [pending]);
  const pendingDocs = useMemo(
    () => (docs.data?.documents ?? []).filter((d) => pending.some((p) => p.type === d.type && p.version === d.version)),
    [docs.data, pending],
  );

  const open = Boolean(user) && pendingDocs.length > 0 && dismissed !== signature;
  if (!open) return null;

  const later = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, signature);
    } catch {
    }
    setDismissed(signature);
  };

  const confirm = () => {
    ack.mutate(
      pendingDocs.map((d) => ({ type: d.type, version: d.version, hash: d.hash })),
      {
        onSuccess: () => toast({ title: "Ciência registrada. Obrigado!" }),
        onError: (err) => toast({ title: privacyErrorMessage(err, "Não foi possível registrar agora."), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) later(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Privacidade e proteção de dados
          </DialogTitle>
          <DialogDescription>
            {pendingDocs.length > 1 ? "Estes documentos foram publicados ou atualizados" : "Este documento foi publicado ou atualizado"}.
            Leia e confirme a ciência para continuar usando o SuporteTI com tranquilidade.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {pendingDocs.map((d) => (
            <li key={d.type} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{d.title}</span>
                <span className="text-muted-foreground"> · versão {d.version}</span>
              </span>
              <a href={DOCUMENT_PATHS[d.type]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Ler <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Não inclua dados de pacientes em chamados, mensagens ou anexos.</li>
          <li>Seu login é pessoal: não compartilhe a sua senha.</li>
          <li>Você pode baixar os seus dados e fazer solicitações em Privacidade, no menu.</li>
        </ul>
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} aria-label="Li e estou ciente" />
          <span>Li e estou ciente da Política de Privacidade e dos Termos de Uso.</span>
        </label>
        <p className="text-[11px] text-muted-foreground">
          A ciência fica registrada com a versão do documento, data/hora e IP. Ela não é um consentimento para tratamento de dados.
        </p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={later}>Agora não</Button>
          <Button onClick={confirm} disabled={!checked || ack.isPending}>
            {ack.isPending ? "Registrando..." : "Confirmar ciência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
