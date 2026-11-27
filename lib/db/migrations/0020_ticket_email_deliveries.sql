-- Registro dos avisos por e-mail enviados com sucesso para cada chamado.
-- Alimenta o indicador "e-mail enviado" nos cards. Por LGPD, nao guarda
-- endereco de e-mail nem conteudo: apenas o chamado, o destinatario (id) e quando.
CREATE TABLE IF NOT EXISTS public.ticket_email_deliveries (
  id bigserial PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  recipient_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  is_requester boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_email_deliveries_ticket_sent_idx
  ON public.ticket_email_deliveries (ticket_id, sent_at DESC);
