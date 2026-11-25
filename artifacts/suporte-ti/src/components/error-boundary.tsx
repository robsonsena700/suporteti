import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

function dbgBoundary(event: Record<string, unknown>) {
  const reporter = (window as any).__ti_dbg as undefined | ((payload: Record<string, unknown>) => Promise<void> | void);
  if (typeof reporter !== "function") return;
  try {
    void reporter(event);
  } catch {}
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Rede de segurança contra "tela branca": sem isso, qualquer exceção não
// tratada durante a renderização (um campo inesperado na resposta da API,
// um valor nulo não previsto, etc.) derruba a árvore React inteira e deixa a
// página completamente em branco, sem nenhuma mensagem — exatamente o
// sintoma relatado em debug-mobile-white-screen.md. Com o ErrorBoundary, o
// usuário vê uma mensagem com opção de recarregar em vez de uma tela vazia.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary capturou um erro de renderização:", error, info);
    dbgBoundary({
      level: "error",
      source: "error_boundary.caught",
      path: window.location.pathname,
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-sm text-muted-foreground max-w-sm">
            Ocorreu um erro inesperado ao exibir esta página. Recarregue para tentar novamente.
          </p>
          <Button type="button" onClick={this.handleReload}>
            Recarregar página
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
