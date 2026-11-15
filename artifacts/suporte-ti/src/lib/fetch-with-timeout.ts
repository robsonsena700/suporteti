// Wrapper fino em torno de `fetch` para chamadas que não passam pelo
// customFetch (principalmente uploads via FormData, que usam fetch cru para
// controlar headers/multipart manualmente). Sem isso, uma requisição presa
// numa rede móvel instável nunca resolve nem rejeita, deixando o estado de
// "enviando..." travado para sempre e nenhum feedback de erro para o usuário
// (um dos sintomas relatados como "problema ao anexar arquivos").
export class FetchTimeoutError extends Error {
  readonly name = "FetchTimeoutError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Uploads legitimamente podem demorar mais que uma chamada de API comum em
// conexões lentas, então o padrão aqui é maior que o do customFetch.
const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_UPLOAD_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExistingAbort = () => controller.abort();
  const existing = init.signal ?? null;
  if (existing) {
    if (existing.aborted) controller.abort();
    else existing.addEventListener("abort", onExistingAbort);
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new FetchTimeoutError(
        `A requisição demorou mais que ${Math.round(timeoutMs / 1000)}s e foi cancelada. Verifique sua conexão e tente novamente.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (existing) existing.removeEventListener("abort", onExistingAbort);
  }
}
