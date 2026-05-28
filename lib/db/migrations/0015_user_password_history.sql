CREATE TABLE IF NOT EXISTS public.user_password_history (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_password_history_user_id_created_at
  ON public.user_password_history(user_id, created_at DESC);

