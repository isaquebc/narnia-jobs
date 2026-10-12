-- F04 · Chat com o recrutador (M1). Só para frente. Ver plans/plan-v0/tasks/F04-chat-recrutador.md §3.
-- Tabelas de sessão, mensagens, pesquisa e domínios confiáveis; colunas de dedupe em usage_event; índice FTS5 de fatos
-- e resumos mantido por gatilhos (F04-12), com carga inicial dos dados existentes.

create table chat_session (
  id                  text primary key,
  profile_id          text not null references profile (id) on delete cascade,
  category            text not null check (category in ('career', 'clarify', 'ingest', 'interview')),
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
create index chat_session_profile on chat_session (profile_id, last_activity_at);

create table chat_message (
  id              text primary key,
  session_id      text not null references chat_session (id) on delete cascade,
  turn_index      integer not null,
  role            text not null check (role in ('user', 'assistant', 'system_note')),
  content_md      text not null,
  tool_calls_json text not null default '[]',
  usage_json      text,
  created_at      text not null
);
create index chat_message_session on chat_message (session_id, turn_index, created_at);

create table research_source (
  id          text primary key,
  profile_id  text references profile (id) on delete set null,
  session_id  text references chat_session (id) on delete set null,
  url         text not null,
  domain      text not null,
  title       text not null,
  excerpt     text not null,
  used_for    text not null,
  trust_tag   text not null check (trust_tag in ('official', 'survey', 'jobboard', 'other')),
  accepted    integer,
  accessed_at text not null
);
create index research_source_profile on research_source (profile_id, accessed_at);

create table trusted_domain (
  id         text primary key,
  pattern    text not null unique,
  trust_tag  text not null check (trust_tag in ('official', 'survey', 'jobboard', 'other')),
  builtin    integer not null default 0,
  enabled    integer not null default 1,
  created_at text not null
);
insert into trusted_domain (id, pattern, trust_tag, builtin, enabled, created_at) values
  ('td-gov-br',        '*.gov.br',           'official', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-ibge',          'ibge.gov.br',        'official', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-dieese',        'dieese.org.br',      'official', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-gov-us',        '*.gov',              'official', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-glassdoor',     'glassdoor.*',        'survey',   1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-levels',        'levels.fyi',         'survey',   1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-salario',       'salario.com.br',     'survey',   1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-linkedin',      'linkedin.com',       'jobboard', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-indeed',        'indeed.*',           'jobboard', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-gupy',          'gupy.io',            'jobboard', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-vagas',         'vagas.com.br',       'jobboard', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-catho',         'catho.com.br',       'jobboard', 1, 1, '2026-10-11T00:00:00.000Z'),
  ('td-programathor',  'programathor.com.br','jobboard', 1, 1, '2026-10-11T00:00:00.000Z');

alter table usage_event add column provider_session_id text;
alter table usage_event add column turn_index integer;
-- dedupe do uso informado pelo agente (modo B) com o já registrado pelo SDK (modo A): um turno conta uma vez
create unique index usage_event_turn on usage_event (provider_session_id, turn_index)
  where provider_session_id is not null and turn_index is not null;

-- Busca de fatos sem ler tudo (F02-2, F04-12): acentos ignorados, prefixo com `termo*`.
create virtual table fact_fts using fts5 (
  kind unindexed,
  fact_id unindexed,
  title,
  body,
  tokenize = "unicode61 remove_diacritics 2"
);

-- experiência: "empresa · cargo" + resumo, local e tecnologias
create trigger fact_fts_experience_ai after insert on experience begin
  insert into fact_fts (kind, fact_id, title, body)
  values ('experience', new.id, new.company || ' · ' || new.title,
          coalesce(new.summary, '') || ' ' || coalesce(new.location, '') || ' ' || coalesce(new.tech_json, ''));
end;
create trigger fact_fts_experience_au after update on experience begin
  delete from fact_fts where kind = 'experience' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body)
  values ('experience', new.id, new.company || ' · ' || new.title,
          coalesce(new.summary, '') || ' ' || coalesce(new.location, '') || ' ' || coalesce(new.tech_json, ''));
end;
create trigger fact_fts_experience_ad after delete on experience begin
  delete from fact_fts where kind = 'experience' and fact_id = old.id;
end;

create trigger fact_fts_achievement_ai after insert on achievement begin
  insert into fact_fts (kind, fact_id, title, body) values ('achievement', new.id, new.text, coalesce(new.metric, ''));
end;
create trigger fact_fts_achievement_au after update on achievement begin
  delete from fact_fts where kind = 'achievement' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body) values ('achievement', new.id, new.text, coalesce(new.metric, ''));
end;
create trigger fact_fts_achievement_ad after delete on achievement begin
  delete from fact_fts where kind = 'achievement' and fact_id = old.id;
end;

create trigger fact_fts_project_ai after insert on project begin
  insert into fact_fts (kind, fact_id, title, body)
  values ('project', new.id, new.name,
          coalesce(new.description, '') || ' ' || coalesce(new.role, '') || ' ' || coalesce(new.tech_json, ''));
end;
create trigger fact_fts_project_au after update on project begin
  delete from fact_fts where kind = 'project' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body)
  values ('project', new.id, new.name,
          coalesce(new.description, '') || ' ' || coalesce(new.role, '') || ' ' || coalesce(new.tech_json, ''));
end;
create trigger fact_fts_project_ad after delete on project begin
  delete from fact_fts where kind = 'project' and fact_id = old.id;
end;

create trigger fact_fts_skill_ai after insert on skill begin
  insert into fact_fts (kind, fact_id, title, body) values ('skill', new.id, new.name, coalesce(new.category, ''));
end;
create trigger fact_fts_skill_au after update on skill begin
  delete from fact_fts where kind = 'skill' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body) values ('skill', new.id, new.name, coalesce(new.category, ''));
end;
create trigger fact_fts_skill_ad after delete on skill begin
  delete from fact_fts where kind = 'skill' and fact_id = old.id;
end;

create trigger fact_fts_education_ai after insert on education begin
  insert into fact_fts (kind, fact_id, title, body)
  values ('education', new.id, new.institution || ' · ' || coalesce(new.course, ''), coalesce(new.degree, ''));
end;
create trigger fact_fts_education_au after update on education begin
  delete from fact_fts where kind = 'education' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body)
  values ('education', new.id, new.institution || ' · ' || coalesce(new.course, ''), coalesce(new.degree, ''));
end;
create trigger fact_fts_education_ad after delete on education begin
  delete from fact_fts where kind = 'education' and fact_id = old.id;
end;

create trigger fact_fts_language_ai after insert on language begin
  insert into fact_fts (kind, fact_id, title, body) values ('language', new.id, new.name, coalesce(new.level, ''));
end;
create trigger fact_fts_language_au after update on language begin
  delete from fact_fts where kind = 'language' and fact_id = old.id;
  insert into fact_fts (kind, fact_id, title, body) values ('language', new.id, new.name, coalesce(new.level, ''));
end;
create trigger fact_fts_language_ad after delete on language begin
  delete from fact_fts where kind = 'language' and fact_id = old.id;
end;

-- resumos (digests) de arquivo e de repositório: o recrutador lê o resumo em vez do original
create trigger fact_fts_file_digest_ai after insert on file_digest begin
  insert into fact_fts (kind, fact_id, title, body)
  values ('file', new.file_id,
          coalesce((select original_name from source_file where id = new.file_id), 'Texto livre'),
          new.summary || ' ' || coalesce(new.key_points_json, ''));
end;
create trigger fact_fts_file_digest_au after update on file_digest begin
  delete from fact_fts where kind = 'file' and fact_id = old.file_id;
  insert into fact_fts (kind, fact_id, title, body)
  values ('file', new.file_id,
          coalesce((select original_name from source_file where id = new.file_id), 'Texto livre'),
          new.summary || ' ' || coalesce(new.key_points_json, ''));
end;
create trigger fact_fts_file_digest_ad after delete on file_digest begin
  delete from fact_fts where kind = 'file' and fact_id = old.file_id;
end;

create trigger fact_fts_repo_digest_ai after insert on repo_digest begin
  insert into fact_fts (kind, fact_id, title, body)
  values ('repo', new.repo_id, coalesce((select full_name from repo where id = new.repo_id), ''),
          new.summary || ' ' || coalesce(new.key_points_json, ''));
end;
create trigger fact_fts_repo_digest_au after update on repo_digest begin
  delete from fact_fts where kind = 'repo' and fact_id = old.repo_id;
  insert into fact_fts (kind, fact_id, title, body)
  values ('repo', new.repo_id, coalesce((select full_name from repo where id = new.repo_id), ''),
          new.summary || ' ' || coalesce(new.key_points_json, ''));
end;
create trigger fact_fts_repo_digest_ad after delete on repo_digest begin
  delete from fact_fts where kind = 'repo' and fact_id = old.repo_id;
end;

-- carga inicial com o que já existe
insert into fact_fts (kind, fact_id, title, body)
  select 'experience', id, company || ' · ' || title,
         coalesce(summary, '') || ' ' || coalesce(location, '') || ' ' || coalesce(tech_json, '') from experience;
insert into fact_fts (kind, fact_id, title, body) select 'achievement', id, text, coalesce(metric, '') from achievement;
insert into fact_fts (kind, fact_id, title, body)
  select 'project', id, name, coalesce(description, '') || ' ' || coalesce(role, '') || ' ' || coalesce(tech_json, '')
  from project;
insert into fact_fts (kind, fact_id, title, body) select 'skill', id, name, coalesce(category, '') from skill;
insert into fact_fts (kind, fact_id, title, body)
  select 'education', id, institution || ' · ' || coalesce(course, ''), coalesce(degree, '') from education;
insert into fact_fts (kind, fact_id, title, body) select 'language', id, name, coalesce(level, '') from language;
insert into fact_fts (kind, fact_id, title, body)
  select 'file', d.file_id, coalesce(f.original_name, 'Texto livre'), d.summary || ' ' || coalesce(d.key_points_json, '')
  from file_digest d left join source_file f on f.id = d.file_id;
insert into fact_fts (kind, fact_id, title, body)
  select 'repo', d.repo_id, coalesce(r.full_name, ''), d.summary || ' ' || coalesce(d.key_points_json, '')
  from repo_digest d left join repo r on r.id = d.repo_id;
