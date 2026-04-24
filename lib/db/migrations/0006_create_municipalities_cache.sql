CREATE TABLE IF NOT EXISTS public.municipalities (
  ibge_code integer PRIMARY KEY,
  name text NOT NULL,
  name_normalized text NOT NULL,
  uf text NOT NULL,
  uf_code integer NOT NULL,
  region text NOT NULL,
  region_code integer NOT NULL,
  population integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS municipalities_uf_idx ON public.municipalities (uf);
CREATE INDEX IF NOT EXISTS municipalities_uf_code_idx ON public.municipalities (uf_code);
CREATE INDEX IF NOT EXISTS municipalities_name_normalized_idx ON public.municipalities (name_normalized);
CREATE INDEX IF NOT EXISTS municipalities_uf_name_normalized_idx ON public.municipalities (uf, name_normalized);

CREATE TABLE IF NOT EXISTS public.municipalities_sync_state (
  id integer PRIMARY KEY,
  last_sync_at timestamptz NULL,
  last_success_at timestamptz NULL,
  next_due_at timestamptz NULL,
  last_error text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.municipalities_sync_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

