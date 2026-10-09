-- narnia: foreign-keys-off
-- F03 · Ingestão (M1). Só para frente. Ver plans/plan-v0/tasks/F03-ingestao.md §3 e §2.9-2.
-- ingestion_run é reconstruída: file_id passa a nulo (GitHub não tem arquivo) e o CHECK de status ganha estados
-- novos; o SQLite não altera CHECK/NOT NULL, então: cria nova → copia → apaga → renomeia (com FKs desligadas pelo
-- executor e foreign_key_check antes do commit). As tabelas que referenciam ingestion_run apontam pelo nome.

create table ingestion_run_new (
  id            text primary key,
  file_id       text references source_file (id),
  source        text not null default 'cv' check (source in ('cv', 'text', 'github')),
  mode          text check (mode in ('public', 'private')),
  provider      text not null,
  models_json   text not null,
  options_json  text not null,
  depth         text not null default 'quick',
  status        text not null check (status in ('estimating', 'queued', 'running', 'awaiting_confirmation',
                  'awaiting_decision', 'paused', 'review', 'done', 'error', 'cancelled')),
  estimate_json text,
  usage_json    text,
  error         text,
  params_json   text not null default '{}',
  budget_json   text,
  model         text,
  report_json   text,
  parent_run_id text references ingestion_run (id),
  created_at    text not null,
  started_at    text,
  finished_at   text,
  check (source = 'github' or file_id is not null)
);

insert into ingestion_run_new (id, file_id, source, provider, models_json, options_json, depth, status,
  estimate_json, usage_json, error, created_at, started_at, finished_at)
select r.id, r.file_id, coalesce((select f.kind from source_file f where f.id = r.file_id), 'cv'), r.provider,
  r.models_json, r.options_json, r.depth, r.status, r.estimate_json, r.usage_json, r.error, r.created_at,
  r.started_at, r.finished_at
from ingestion_run r;

drop table ingestion_run;
alter table ingestion_run_new rename to ingestion_run;
create index ingestion_run_status on ingestion_run (status, created_at);
create index ingestion_run_file on ingestion_run (file_id);

-- Revisão: reconciliação (novo/existente/conflito), resolução por campo, evidência literal e selo anti-alucinação.
alter table ingestion_proposal add column match text not null default 'new' check (match in ('new', 'existing', 'conflict'));
alter table ingestion_proposal add column match_target_id text;
alter table ingestion_proposal add column conflict_json text;
alter table ingestion_proposal add column resolution_json text;
alter table ingestion_proposal add column evidence_json text;
alter table ingestion_proposal add column check_status text not null default 'unchecked'
  check (check_status in ('supported', 'partial', 'unsupported', 'unchecked'));
alter table ingestion_proposal add column suggested_profiles_json text not null default '[]';

-- Repositórios do GitHub (metadados da coleta, 0 tokens) e suas análises (relatório, cobertura, commit analisado).
create table repo (
  id               text primary key,
  full_name        text not null unique,
  owner            text not null,
  url              text not null,
  description      text,
  is_private       integer not null default 0,
  is_fork          integer not null default 0,
  is_archived      integer not null default 0,
  languages_json   text not null default '{}',
  topics_json      text not null default '[]',
  stars            integer not null default 0,
  pushed_at        text,
  default_branch   text,
  head_sha         text,
  relevance        real,
  last_analysis_id text,
  created_at       text not null,
  updated_at       text not null
);

create table repo_analysis (
  id            text primary key,
  repo_id       text not null references repo (id) on delete cascade,
  run_id        text references ingestion_run (id),
  parent_id     text references repo_analysis (id),
  head_sha      text,
  base_sha      text,
  depth         text not null check (depth in ('quick', 'balanced', 'deep')),
  kind          text not null check (kind in ('full', 'incremental', 'deepen', 'cover')),
  report_json   text,
  coverage_json text not null default '{"files":[],"topics":[]}',
  usage_json    text not null default '{"inputTokens":0,"outputTokens":0}',
  status        text not null default 'running' check (status in ('running', 'done', 'skipped_budget', 'error')),
  created_at    text not null
);
create index repo_analysis_repo on repo_analysis (repo_id, created_at);
create index repo_analysis_run on repo_analysis (run_id);

-- Digest de repositório em tabela irmã de file_digest, mesmo formato (F03-11).
create table repo_digest (
  repo_id         text primary key references repo (id) on delete cascade,
  summary         text not null,
  key_points_json text not null default '[]',
  sections_json   text not null default '[]',
  meta_json       text not null default '{}',
  edited_by_user  integer not null default 0,
  updated_at      text not null
);

-- Métricas quantitativas (F03-3 §3): uma linha por escopo (repo:<id>, year:<ano>, global), substituída a cada coleta.
create table github_metric (
  id           text primary key,
  scope        text not null check (scope in ('repo', 'year', 'global')),
  scope_key    text not null unique,
  repo_id      text references repo (id) on delete cascade,
  year         integer,
  metrics_json text not null,
  collected_at text not null
);

-- Snapshots do que foi lido (re-rodar sem rede), com teto configurável e limpeza LRU manual (F03-9).
create table snapshot (
  id           text primary key,
  source       text not null,
  ref          text not null,
  head_sha     text,
  path         text not null,
  sha256       text not null,
  size         integer not null,
  taken_at     text not null,
  last_used_at text
);

-- Notificações (F03-10): pendência aberta é única por (tipo, assunto); o fluxo dono resolve; dispensar só esconde.
create table notification (
  id           text primary key,
  kind         text not null,
  subject_kind text not null,
  subject_id   text not null,
  title        text not null,
  body         text,
  action_url   text not null,
  severity     text not null default 'info' check (severity in ('info', 'warning', 'error')),
  created_at   text not null,
  read_at      text,
  dismissed_at text,
  resolved_at  text
);
create unique index notification_open on notification (kind, subject_kind, subject_id) where resolved_at is null;
create index notification_created on notification (resolved_at, created_at);

-- Vínculos: projeto ↔ repositório; fonte do fato ↔ repositório e análise.
alter table project add column repo_id text references repo (id);
alter table fact_source add column repo_id text references repo (id);
alter table fact_source add column analysis_id text references repo_analysis (id);
