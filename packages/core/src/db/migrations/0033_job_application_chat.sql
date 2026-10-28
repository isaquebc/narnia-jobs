-- F07/M6 · conversa sobre a candidatura: uma por candidatura (como a do formulário, F12/M5); a primeira mensagem cria.
alter table job_application add column chat_session_id text references chat_session (id) on delete set null;
