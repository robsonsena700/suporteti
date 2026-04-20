DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_attachment_scope') THEN
    CREATE TYPE chat_attachment_scope AS ENUM ('GROUP', 'DM');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id serial PRIMARY KEY,
  scope chat_attachment_scope NOT NULL,
  uploader_id integer NOT NULL REFERENCES public.users(id),
  dm_receiver_id integer REFERENCES public.users(id),
  chat_message_id integer REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  direct_message_id integer REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_attachments_chat_message_id_idx ON public.chat_attachments(chat_message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_direct_message_id_idx ON public.chat_attachments(direct_message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_uploader_id_idx ON public.chat_attachments(uploader_id);

