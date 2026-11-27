import { Fragment, type ReactNode } from "react";

/**
 * Renderiza o formato simples dos documentos de privacidade ("## ", "### ", "- " e **negrito**)
 * como elementos React. Não usa innerHTML: nenhum HTML do texto é interpretado.
 */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  );
}

export function PrivacyMarkdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-6">
        {items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ul>,
    );
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) {
      blocks.push(<h3 key={blocks.length} className="mt-4 mb-1 text-base font-semibold">{inline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      blocks.push(<h2 key={blocks.length} className="mt-6 mb-2 text-lg font-bold tracking-tight">{inline(line.slice(3))}</h2>);
    } else {
      blocks.push(<p key={blocks.length} className="my-2 leading-relaxed">{inline(line)}</p>);
    }
  }
  flush();
  return <div className="text-sm text-foreground/90">{blocks}</div>;
}
