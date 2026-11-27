-- Privacidade e proteção de dados (LGPD).
-- privacy_acceptances: aceite no cadastro e ciência de novas versões da Política de
--   Privacidade e dos Termos de Uso. APPEND-ONLY (trigger impede UPDATE/DELETE) e sem FK
--   para users: a evidência de aceite não some se o cadastro for removido.
-- privacy_requests + privacy_request_history: solicitações do titular (LGPD, art. 18),
--   com protocolo e histórico imutável. Nada é executado automaticamente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.privacy_acceptances (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('POLITICA_PRIVACIDADE', 'TERMOS_USO')),
  document_version integer NOT NULL CHECK (document_version > 0),
  content_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ACEITE_CADASTRO', 'CIENCIA')),
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_acceptances_user_idx
  ON public.privacy_acceptances (user_id, document_type, document_version DESC);

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id serial PRIMARY KEY,
  protocol text NOT NULL UNIQUE,
  user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  request_type text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'EM_ANALISE', 'CONCLUIDA', 'INDEFERIDA')),
  response text,
  resolved_by_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_requests_user_idx ON public.privacy_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON public.privacy_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.privacy_request_history (
  id bigserial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.privacy_requests(id) ON DELETE CASCADE,
  actor_user_id integer,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_request_history_req_idx ON public.privacy_request_history (request_id, created_at);

CREATE OR REPLACE FUNCTION public.privacy_append_only() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'Registro de % é imutável (somente inclusão).', TG_TABLE_NAME;
END;
$f$;

DROP TRIGGER IF EXISTS privacy_acceptances_append_only ON public.privacy_acceptances;
CREATE TRIGGER privacy_acceptances_append_only BEFORE UPDATE OR DELETE ON public.privacy_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.privacy_append_only();

DROP TRIGGER IF EXISTS privacy_request_history_append_only ON public.privacy_request_history;
CREATE TRIGGER privacy_request_history_append_only BEFORE UPDATE ON public.privacy_request_history
  FOR EACH ROW EXECUTE FUNCTION public.privacy_append_only();

COMMIT;
