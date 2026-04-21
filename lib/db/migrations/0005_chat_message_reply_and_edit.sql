ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id integer REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_history text;

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS reply_to_id integer REFERENCES public.direct_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_history text;

CREATE INDEX IF NOT EXISTS chat_messages_reply_to_id_idx ON public.chat_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS direct_messages_reply_to_id_idx ON public.direct_messages(reply_to_id);

