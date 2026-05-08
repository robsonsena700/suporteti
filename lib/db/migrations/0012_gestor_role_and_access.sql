ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'GESTOR';

CREATE TABLE IF NOT EXISTS public.gestor_coordinators (
  gestor_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  coordinator_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gestor_id)
);

CREATE INDEX IF NOT EXISTS gestor_coordinators_coordinator_id_idx ON public.gestor_coordinators(coordinator_id);

CREATE TABLE IF NOT EXISTS public.gestor_allowed_users (
  gestor_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gestor_id, user_id)
);

CREATE INDEX IF NOT EXISTS gestor_allowed_users_user_id_idx ON public.gestor_allowed_users(user_id);
