import { Link } from "wouter";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrivacyMarkdown } from "@/components/privacy/privacy-markdown";
import { useAuth } from "@/lib/auth";
import { DOCUMENT_PATHS, fillPrivacyPlaceholders, usePrivacyDocuments, type PrivacyDocumentType } from "@/lib/privacy";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Página pública (sem login) da Política de Privacidade ou dos Termos de Uso. */
export function PrivacyDocumentPage({ type }: { type: PrivacyDocumentType }) {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = usePrivacyDocuments();
  const doc = data?.documents.find((d) => d.type === type);
  const other = data?.documents.find((d) => d.type !== type);

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">TI</span>
            SuporteTI
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={user ? "/privacidade" : "/"}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {user ? "Central de Privacidade" : "Voltar ao login"}
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="p-6 sm:p-8">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : isError || !doc ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Não foi possível carregar o documento.
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
                </div>
              </div>
            ) : (
              <article>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Versão {doc.version} · Vigente desde {formatDate(doc.effectiveDate)}
                    </p>
                  </div>
                </div>
                {!doc.legallyValidated ? (
                  <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    Minuta pendente de validação jurídica. Os trechos marcados com [A DEFINIR] dependem de decisão do responsável pelo tratamento.
                  </p>
                ) : null}
                <div className="mt-4">
                  <PrivacyMarkdown content={fillPrivacyPlaceholders(doc.content, data?.contacts)} />
                </div>
              </article>
            )}
          </CardContent>
        </Card>

        {other ? (
          <p className="text-center text-sm">
            <Link href={DOCUMENT_PATHS[other.type]} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <FileText className="h-4 w-4" /> Ler também: {other.title}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function PrivacyPolicyPage() {
  return <PrivacyDocumentPage type="POLITICA_PRIVACIDADE" />;
}

export function TermsOfUsePage() {
  return <PrivacyDocumentPage type="TERMOS_USO" />;
}

export default PrivacyPolicyPage;
