ALTER TYPE ticket_audit_type ADD VALUE IF NOT EXISTS 'COLLABORATOR_ADDED';
ALTER TYPE ticket_audit_type ADD VALUE IF NOT EXISTS 'COLLABORATOR_REMOVED';

CREATE TABLE IF NOT EXISTS public.ticket_collaborators (
  ticket_id integer NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by_user_id integer REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE INDEX IF NOT EXISTS ticket_collaborators_ticket_id_idx ON public.ticket_collaborators(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_collaborators_user_id_idx ON public.ticket_collaborators(user_id);
