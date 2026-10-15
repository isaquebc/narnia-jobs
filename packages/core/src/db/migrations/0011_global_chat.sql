-- narnia: foreign-keys-off
-- F06 · M1 · recrutador global (F06-8). Só para frente. Ver plans/plan-v0/tasks/F06-analisar-vaga.md §3.
-- A conversa deixa de pertencer a um perfil: `profile_id` vira contexto opcional (o perfil em foco quando a conversa
-- nasceu) e apagar o perfil não apaga a conversa. Categoria nova `job` (análise de vaga). O SQLite não altera CHECK
-- nem NOT NULL, então chat_session é reconstruída como na 0006 (FKs desligadas pelo executor e foreign_key_check antes
-- do commit). chat_message, research_source e ingestion_run apontam pelo nome e seguem válidas.

create table chat_session_new (
  id                  text primary key,
  profile_id          text references profile (id) on delete set null,
  category            text not null check (category in ('career', 'clarify', 'ingest', 'interview', 'discovery', 'job')),
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
  last_activity_at    text not null,
  read_message_id     text
);

insert into chat_session_new (id, profile_id, category, title, provider, provider_session_id, model, state,
  ingestion_run_id, card_hash, tokens_in, tokens_out, cost_usd_est, created_at, last_activity_at, read_message_id)
select id, profile_id, category, title, provider, provider_session_id, model, state,
  ingestion_run_id, card_hash, tokens_in, tokens_out, cost_usd_est, created_at, last_activity_at, read_message_id
from chat_session;

drop table chat_session;
alter table chat_session_new rename to chat_session;
create index chat_session_activity on chat_session (last_activity_at);
create index chat_session_profile on chat_session (profile_id);
