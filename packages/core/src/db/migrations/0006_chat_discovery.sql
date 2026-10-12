-- narnia: foreign-keys-off
-- Auditoria pós-F04 · bloco E2 (18a). Só para frente. Ver plans/plan-v0/tasks/F04-chat-recrutador.md §8.
-- Categoria `discovery` (entrevista de descoberta, passo 7 do primeiro uso). O SQLite não altera CHECK, então
-- chat_session é reconstruída: cria nova → copia → apaga → renomeia (FKs desligadas pelo executor e
-- foreign_key_check antes do commit). chat_message e research_source apontam pelo nome e seguem válidas.

create table chat_session_new (
  id                  text primary key,
  profile_id          text not null references profile (id) on delete cascade,
  category            text not null check (category in ('career', 'clarify', 'ingest', 'interview', 'discovery')),
  title               text not null,
  provider            text not null,
  provider_session_id text,
  model               text not null,
  state               text not null default 'live' check (state in ('live', 'hibernated', 'archived', 'error')),
  ingestion_run_id    text references ingestion_run (id) on delete set null,
  card_hash           text,
  tokens_in           integer not null default 0,
  tokens_out          integer not null default 0,
  cost_usd_est        real not null default 0,
  created_at          text not null,
  last_activity_at    text not null
);

insert into chat_session_new (id, profile_id, category, title, provider, provider_session_id, model, state,
  ingestion_run_id, card_hash, tokens_in, tokens_out, cost_usd_est, created_at, last_activity_at)
select id, profile_id, category, title, provider, provider_session_id, model, state,
  ingestion_run_id, card_hash, tokens_in, tokens_out, cost_usd_est, created_at, last_activity_at
from chat_session;

drop table chat_session;
alter table chat_session_new rename to chat_session;
create index chat_session_profile on chat_session (profile_id, last_activity_at);
