-- 0001_init · esquema do F01 (plans/plan-v0/tasks/F01-onboarding.md §3)
-- Convenções: ids UUID v7 em texto; timestamps ISO 8601 em UTC; JSON em colunas *_json; booleanos em integer 0/1.
-- Colunas de contato do usuário são nullable no banco (a identidade do CV chega antes do telefone);
-- a obrigatoriedade é garantida pelo UserSchema do pacote shared nas fronteiras da API (decisão F01-33).

create table settings (
  key        text primary key,
  value_json text not null
);
insert into settings (key, value_json) values ('facts_version', '0');

create table user (
  id              text primary key,
  display_name    text,
  full_name       text,
  pronouns        text,
  email           text,
  phone_e164      text,
  phone_country   text,
  phone_national  text,
  city            text,
  region          text,
  country         text,
  timezone        text,
  remote_pref     text,
  relocation_json text,
  work_auth_json  text,
  links_json      text not null default '[]',
  created_at      text not null,
  updated_at      text not null
);

create table source_file (
  id            text primary key,
  original_name text,
  mime          text not null,
  size          integer not null,
  sha256        text not null,
  path          text not null,
  kind          text not null check (kind in ('cv', 'text')),
  uploaded_at   text not null
);
create index source_file_sha256 on source_file (sha256);

create table ingestion_run (
  id            text primary key,
  file_id       text not null references source_file (id),
  provider      text not null,
  models_json   text not null,
  options_json  text not null,
  depth         text not null default 'quick',
  status        text not null check (status in ('estimating', 'queued', 'running', 'review', 'done', 'error')),
  estimate_json text,
  usage_json    text,
  error         text,
  created_at    text not null,
  started_at    text,
  finished_at   text
);

create table fact_source (
  id         text primary key,
  kind       text not null check (kind in ('cv', 'text', 'github', 'linkedin', 'chat', 'clarificacao', 'pesquisa', 'manual')),
  file_id    text references source_file (id),
  run_id     text references ingestion_run (id),
  url        text,
  created_at text not null
);

create table language (
  id         text primary key,
  user_id    text not null references user (id),
  name       text not null,
  level      text not null,
  source_id  text references fact_source (id),
  confidence real not null default 1,
  verified   integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table experience (
  id              text primary key,
  user_id         text not null references user (id),
  company         text not null,
  title           text not null,
  employment_type text,
  start_date      text not null,
  end_date        text,
  is_current      integer not null default 0,
  location        text,
  summary         text,
  tech_json       text not null default '[]',
  source_id       text references fact_source (id),
  confidence      real not null default 1,
  verified        integer not null default 0,
  created_at      text not null,
  updated_at      text not null
);

create table achievement (
  id            text primary key,
  experience_id text not null references experience (id) on delete cascade,
  text          text not null,
  metric        text,
  source_id     text references fact_source (id),
  confidence    real not null default 1,
  verified      integer not null default 0,
  created_at    text not null,
  updated_at    text not null
);

create table education (
  id          text primary key,
  user_id     text not null references user (id),
  institution text not null,
  course      text not null,
  degree      text,
  start_date  text,
  end_date    text,
  status      text not null,
  source_id   text references fact_source (id),
  confidence  real not null default 1,
  verified    integer not null default 0,
  created_at  text not null,
  updated_at  text not null
);

create table skill (
  id              text primary key,
  user_id         text not null references user (id),
  name            text not null,
  name_normalized text not null,
  category        text not null,
  level           integer,
  source_id       text references fact_source (id),
  confidence      real not null default 1,
  verified        integer not null default 0,
  created_at      text not null,
  updated_at      text not null
);
create index skill_name_normalized on skill (name_normalized);

create table profile (
  id                     text primary key,
  user_id                text not null references user (id),
  name                   text not null,
  target_title           text not null,
  alt_titles_json        text not null default '[]',
  seniority              text not null,
  area                   text not null,
  goal                   text not null,
  market                 text not null,
  doc_locale             text not null,
  salary_min             real,
  salary_max             real,
  salary_currency        text,
  salary_period          text,
  salary_below_reference integer not null default 0,
  contract_types_json    text not null default '[]',
  locations_json         text not null default '[]',
  available_from         text,
  needs_research_json    text not null default '[]',
  pitch                  text,
  card_json              text,
  card_updated_at        text,
  is_active              integer not null default 0,
  created_at             text not null,
  updated_at             text not null
);

create table salary_reference (
  id              text primary key,
  country         text not null,
  source          text not null,
  indicator       text not null,
  value           real not null,
  currency        text not null,
  period          text not null,
  reference_month text not null,
  source_url      text not null,
  fetched_at      text not null,
  is_current      integer not null default 0
);
create index salary_reference_current on salary_reference (country, indicator, is_current);

-- Seed DIEESE (decisão F01-15). ATENÇÃO: valor PLACEHOLDER plausível para o salário mínimo necessário;
-- deve ser confirmado em https://www.dieese.org.br/analisecestabasica/salarioMinimo.html na primeira
-- execução real e atualizado por F04 (pesquisa do recrutador) ou F10 (Configurações).
insert into salary_reference (id, country, source, indicator, value, currency, period, reference_month, source_url, fetched_at, is_current)
values ('seed-dieese-br', 'BR', 'dieese', 'salario_minimo_necessario', 7300.00, 'BRL', 'monthly', '2026-09',
        'https://www.dieese.org.br/analisecestabasica/salarioMinimo.html', '2026-10-07T00:00:00.000Z', 1);

create table file_digest (
  file_id         text primary key references source_file (id),
  summary         text not null,
  key_points_json text not null,
  sections_json   text not null,
  meta_json       text not null,
  text_path       text,
  edited_by_user  integer not null default 0,
  updated_at      text not null
);

create table reading (
  id          text primary key,
  run_id      text not null references ingestion_run (id),
  kind        text not null check (kind in ('text_layer', 'ocr', 'model_read')),
  text_path   text not null,
  quality     real not null,
  pages_json  text,
  usage_json  text,
  duration_ms integer,
  created_at  text not null
);
create index reading_run on reading (run_id);

create table reading_segment (
  id               text primary key,
  run_id           text not null references ingestion_run (id),
  idx              integer not null,
  section_hint     text,
  text             text not null,
  origin           text not null,
  agreement        real not null,
  divergences_json text not null default '[]'
);
create index reading_segment_run on reading_segment (run_id, idx);

create table ingestion_proposal (
  id                  text primary key,
  run_id              text not null references ingestion_run (id),
  idx                 integer not null,
  kind                text not null,
  payload_json        text not null,
  confidence          real not null,
  decision            text not null default 'pending' check (decision in ('pending', 'accepted', 'edited', 'rejected', 'skipped')),
  edited_payload_json text,
  target_id           text,
  decided_at          text
);
create index ingestion_proposal_run on ingestion_proposal (run_id, idx);

create table job (
  id           text primary key,
  queue        text not null,
  type         text not null,
  parent_id    text,
  profile_id   text,
  status       text not null check (status in ('queued', 'active', 'done', 'error', 'cancelled', 'stalled')),
  progress     real not null default 0,
  stage        text not null,
  payload_json text not null default '{}',
  result_json  text,
  error        text,
  attempts     integer not null default 0,
  created_at   text not null,
  started_at   text,
  finished_at  text,
  updated_at   text not null
);
create index job_parent on job (parent_id);
create index job_status on job (status);

create table usage_event (
  id            text primary key,
  ts            text not null,
  origin        text not null,
  category      text not null,
  job_id        text,
  session_id    text,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cache_read    integer not null default 0,
  cache_write   integer not null default 0,
  cost_usd_est  real not null default 0
);
create index usage_event_category_ts on usage_event (category, ts);
