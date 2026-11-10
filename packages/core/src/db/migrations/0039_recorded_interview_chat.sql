-- F13/M5 · conversa sobre a entrevista gravada: uma por entrevista, aberta pela página dela (nota + skill
-- `analisar-entrevista`); as próximas mensagens vão para a mesma conversa.
alter table recorded_interview add column chat_session_id text references chat_session (id) on delete set null;
