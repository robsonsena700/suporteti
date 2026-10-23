import { useCallback, useEffect, useRef } from "react";

type PersistedEnvelope<T> = {
  actorUserId: number;
  savedAt: number;
  data: T;
};

export type UsePersistedDraftOptions<T> = {
  /**
   * Chave única de armazenamento. Inclua um namespace e uma versão (ex:
   * "suporte-ti:ticket:detail:state:v2") - ao mudar o formato de T, bump a
   * versão pra evitar aplicar um rascunho salvo num formato antigo.
   */
  key: string;
  /** Dono do rascunho. Sem isso, nada é salvo nem restaurado. */
  actorUserId: number | null | undefined;
  /**
   * Mecanismo de armazenamento. Default: localStorage - sobrevive a fechar
   * a aba/app, não só a trocar de janela. Passe sessionStorage se o
   * rascunho não deve sobreviver ao fechamento da aba.
   */
  storage?: Storage;
  /** Monta o snapshot atual a partir do estado em memória da tela. */
  get: () => T;
  /** Aplica de volta no estado em memória um snapshot restaurado. */
  apply: (value: T) => void;
  /** Valida se um snapshot salvo ainda é aplicável (ex: mesmo ticketId/entidade). */
  matches?: (value: T) => boolean;
  /**
   * Quando esse valor muda (ex: o id da entidade sendo editada), tenta
   * restaurar de novo - cobre navegar para outra entidade do mesmo tipo
   * (outro chamado) sem a tela desmontar.
   */
  restoreKey?: string | number | null;
  /**
   * Chamado no beforeunload, antes de decidir se mostra a confirmação
   * nativa do navegador. Retorne true para pedir confirmação (há dado não
   * salvo relevante o bastante pra isso).
   */
  shouldConfirmUnload?: () => boolean;
};

/**
 * Camada genérica de persistência temporária de rascunhos de formulário.
 *
 * Resolve a classe de bug "dados digitados somem ao trocar de janela/app e
 * voltar": salva um snapshot do estado em memória quando a aba fica oculta
 * (visibilitychange -> hidden) ou a página está prestes a descarregar
 * (beforeunload), e restaura esse snapshot quando a aba volta a ficar
 * visível ou quando a tela habilita a persistência (ex: usuário carregado,
 * ou restoreKey muda ao navegar para outra entidade).
 *
 * Isso é complementar ao salvamento oficial no backend, nunca um
 * substituto: os dados ficam fora do servidor só até o usuário confirmar o
 * envio/salvamento. Chame clear() assim que isso acontecer, ou quando o
 * usuário cancelar a edição explicitamente, para não deixar rascunho obsoleto
 * no armazenamento.
 *
 * É a mesma mecânica (storage + visibilitychange + beforeunload) que antes
 * vivia duplicada e espalhada em cada tela (ticket-detail, new-ticket,
 * chat); aqui ela é um hook único e reaproveitável - cada tela só descreve
 * "o que" persistir (get/apply/matches), não "como".
 */
export function usePersistedDraft<T>({
  key,
  actorUserId,
  storage,
  get,
  apply,
  matches,
  restoreKey,
  shouldConfirmUnload,
}: UsePersistedDraftOptions<T>) {
  const enabled = Boolean(actorUserId);
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);

  const getRef = useRef(get);
  getRef.current = get;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const shouldConfirmUnloadRef = useRef(shouldConfirmUnload);
  shouldConfirmUnloadRef.current = shouldConfirmUnload;

  const load = useCallback((): T | null => {
    if (!store || !actorUserId) return null;
    try {
      const raw = store.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedEnvelope<T>;
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.actorUserId !== actorUserId) return null;
      if (matchesRef.current && !matchesRef.current(parsed.data)) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }, [store, actorUserId, key]);

  const save = useCallback(() => {
    if (!store || !actorUserId) return;
    try {
      const envelope: PersistedEnvelope<T> = {
        actorUserId,
        savedAt: Date.now(),
        data: getRef.current(),
      };
      store.setItem(key, JSON.stringify(envelope));
    } catch {
      // Armazenamento indisponível (modo privado, cota excedida etc.) - a
      // persistência temporária é best-effort e nunca deve quebrar a tela.
    }
  }, [store, actorUserId, key]);

  const clear = useCallback(() => {
    if (!store) return;
    try {
      store.removeItem(key);
    } catch {
    }
  }, [store, key]);

  const restore = useCallback((): boolean => {
    const data = load();
    if (data == null) return false;
    applyRef.current(data);
    return true;
  }, [load]);

  // Restaura ao habilitar (usuário carregado) e de novo sempre que
  // restoreKey mudar (ex: navegou para outro chamado sem desmontar a tela).
  useEffect(() => {
    if (!enabled) return;
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, restoreKey]);

  // Cobre especificamente "alternar para outra janela/app e voltar": salva
  // ao perder visibilidade, restaura ao recuperar. beforeunload também
  // salva, e opcionalmente pede confirmação antes de fechar/recarregar.
  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        save();
      } else if (document.visibilityState === "visible") {
        restore();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      save();
      if (shouldConfirmUnloadRef.current?.()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [enabled, save, restore]);

  return { save, restore, clear, load };
}
