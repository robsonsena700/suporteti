CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  purpose text NOT NULL,
  requested_by_user_id integer NULL REFERENCES public.users(id) ON DELETE SET NULL,
  requested_ip text NULL,
  requested_user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  used_ip text NULL,
  used_user_agent text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON public.password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON public.password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON public.password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_used_at ON public.password_reset_tokens(used_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_requested_by_user_id ON public.password_reset_tokens(requested_by_user_id);

CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id serial PRIMARY KEY,
  event_type text NOT NULL,
  actor_user_id integer NULL REFERENCES public.users(id) ON DELETE SET NULL,
  target_user_id integer NULL REFERENCES public.users(id) ON DELETE SET NULL,
  target_email text NULL,
  ip text NULL,
  user_agent text NULL,
  detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type ON public.security_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_actor_user_id ON public.security_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_target_user_id ON public.security_audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON public.security_audit_logs(created_at);
