-- Indices para as consultas mais frequentes (listagem de chamados por perfil,
-- detalhe do chamado com mensagens/anexos/auditoria, relatorios e DMs).
-- Ate aqui nenhuma migration indexava "tickets" nem "messages", entao toda
-- listagem fazia varredura sequencial nessas tabelas.
--
-- CONCURRENTLY nao bloqueia escrita durante a criacao (seguro em producao).
-- Funciona porque apply_sql_migrations.sh roda o arquivo com "psql -f" sem
-- transacao unica (cada comando em autocommit). Se uma criacao falhar no
-- meio, o Postgres deixa um indice INVALID: remova-o com DROP INDEX
-- CONCURRENTLY <nome>; e reaplique este arquivo.

-- tickets: filtros por dono/responsavel/status e ordenacao por data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_created_by_id ON public.tickets (created_by_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_assigned_to_id ON public.tickets (assigned_to_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_status_created_at ON public.tickets (status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_uf_municipality ON public.tickets (uf, municipality);

-- filhos de tickets: carregados no detalhe e nas listagens
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_ticket_id_created_at ON public.messages (ticket_id, created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_attachments_ticket_id ON public.ticket_attachments (ticket_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_audit_logs_ticket_id ON public.ticket_audit_logs (ticket_id);

-- vinculos usuario -> coordenador (visibilidade de COORDINATOR/GESTOR)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_coordinators_coordinator_id ON public.user_coordinators (coordinator_id);

-- mensagens diretas: conversas entre dois usuarios
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_messages_sender_receiver ON public.direct_messages (sender_id, receiver_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_messages_receiver_sender ON public.direct_messages (receiver_id, sender_id);
