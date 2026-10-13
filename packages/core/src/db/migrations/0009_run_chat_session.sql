-- Execução aberta pela conversa (pedido do dono, 2026-10-13): a conversa que a criou e quando ela foi avisada do fim.
-- O recrutador não espera o job; o api chama o agente uma vez quando a execução fica pronta. Aditiva.
alter table ingestion_run add column chat_session_id text references chat_session (id) on delete set null;
alter table ingestion_run add column chat_notified_at text;
