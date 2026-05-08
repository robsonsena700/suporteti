DO $$
BEGIN
  CREATE TYPE public.message_format AS ENUM ('PLAIN', 'HTML');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS format public.message_format NOT NULL DEFAULT 'PLAIN';

CREATE TABLE IF NOT EXISTS public.ticket_message_attachments (
  id serial PRIMARY KEY,
  message_id integer NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  ticket_id integer NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_message_attachments_message_id ON public.ticket_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_ticket_message_attachments_ticket_id ON public.ticket_message_attachments(ticket_id);

