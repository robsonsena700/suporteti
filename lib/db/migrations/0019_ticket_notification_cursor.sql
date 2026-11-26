-- Notificacao por e-mail de interacoes em chamados.
-- Guarda ate qual registro de ticket_audit_logs o envio ja foi processado,
-- para nao reenviar avisos apos reinicio da API nem avisar sobre o historico
-- antigo (na primeira execucao o cursor comeca no registro mais recente).
CREATE TABLE IF NOT EXISTS public.ticket_notification_cursor (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_audit_id integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
