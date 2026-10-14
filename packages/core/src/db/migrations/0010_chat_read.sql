-- Última mensagem lida pelo usuário em cada conversa (ponto verde no menu, 2026-10-13). Conversas que já existiam
-- começam lidas até a última mensagem.
alter table chat_session add column read_message_id text;
update chat_session set read_message_id = (
  select m.id from chat_message m where m.session_id = chat_session.id order by m.rowid desc limit 1
);
