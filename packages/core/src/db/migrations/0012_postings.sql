-- F06 · M2 · vagas (postings), contatos, notas e análises. Só para frente. Ver plans/plan-v0/tasks/F06-analisar-vaga.md §3.
-- A vaga é editável e cresce aos poucos (§1.2): quase tudo é opcional. Listas em JSON; datas em UTC (ISO 8601).
-- `identity_hash` (F06-2, F06-9) cobre empresa, cliente, cargo e role (sem a data de publicação) e é recalculado pelo
-- repositório quando esses campos mudam; não é único: o hash repetido dispara a comparação de duplicata.

create table posting (
  id                    text primary key,
  status                text not null default 'draft' check (status in ('draft', 'extracting', 'ready', 'error')),
  company               text,
  client                text,
  title                 text,
  role                  text,
  seniority             text,
  city                  text,
  state                 text,
  country               text,
  work_mode             text check (work_mode in ('remote', 'hybrid', 'onsite')),
  contract_type         text,
  currency              text,
  salary_min            real,
  salary_max            real,
  salary_period         text check (salary_period in ('monthly', 'yearly', 'hourly')),
  benefits_json         text not null default '[]',
  responsibilities_json text not null default '[]',
  skills_required_json  text not null default '[]',
  skills_nice_json      text not null default '[]',
  company_summary       text,
  posting_url           text,
  company_url           text,
  jd_text               text,
  published_at          text,
  identity_hash         text,
  field_sources_json    text not null default '{}',
  pre_analysis_json     text,
  raw_path              text,
  created_at            text not null,
  updated_at            text not null
);
create index posting_identity on posting (identity_hash);
create index posting_created on posting (created_at);

create table posting_contact (
  id          text primary key,
  posting_id  text not null references posting (id) on delete cascade,
  name        text not null,
  origin      text not null check (origin in ('linkedin', 'whatsapp', 'email', 'other')),
  email       text,
  phone       text,
  created_at  text not null
);
create index posting_contact_posting on posting_contact (posting_id);

-- edição do recrutador numa nota do usuário espera confirmação (F06-17): fica em pending_body até o usuário decidir
create table posting_note (
  id            text primary key,
  posting_id    text not null references posting (id) on delete cascade,
  author        text not null check (author in ('user', 'recruiter')),
  body          text not null,
  pending_body  text,
  pending_at    text,
  created_at    text not null,
  updated_at    text not null
);
create index posting_note_posting on posting_note (posting_id);
create index posting_note_pending on posting_note (pending_at) where pending_body is not null;

-- reanálise cria outra linha (F06-10): a mais recente é a atual; facts_version e posting_updated_at dizem se envelheceu
create table job_analysis (
  id                      text primary key,
  posting_id              text not null references posting (id) on delete cascade,
  analysis_json           text not null,
  recommended_profile_id  text references profile (id) on delete set null,
  facts_version           integer not null,
  posting_updated_at      text not null,
  models_json             text not null default '[]',
  usage_json              text,
  chat_session_id         text references chat_session (id) on delete set null,
  created_at              text not null
);
create index job_analysis_posting on job_analysis (posting_id, created_at);

-- conversa da análise (categoria job): a vaga que ela trata
alter table chat_session add column posting_id text references posting (id) on delete set null;
