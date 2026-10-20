ALTER TABLE public.ticket_message_attachments
  ADD COLUMN IF NOT EXISTS content_sha256 text;
