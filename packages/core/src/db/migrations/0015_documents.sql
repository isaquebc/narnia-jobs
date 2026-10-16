-- F05 · CV e carta de apresentação (§3). Um documento por (tipo, perfil) sem vaga e um por (tipo, perfil, vaga);
-- cada geração, edição ou troca de template cria uma versão. O conteúdo JSON é a verdade; PDF e prévias são derivados.
create table document (
  id               text primary key,
  kind             text not null check (kind in ('cv', 'cover_letter')),
  profile_id       text not null references profile (id) on delete cascade,
  posting_id       text references posting (id) on delete cascade,
  template_id      text not null default 'classico',
  paper            text not null default 'A4' check (paper in ('A4', 'Letter')),
  locale           text not null check (locale in ('pt-BR', 'en-US')),
  format           text not null default 'pdf' check (format in ('pdf', 'text')),
  current_version  integer not null default 0,
  created_at       text not null,
  updated_at       text not null
);
create unique index document_profile_only on document (kind, profile_id) where posting_id is null;
create unique index document_profile_posting on document (kind, profile_id, posting_id) where posting_id is not null;
create index document_posting on document (posting_id);

create table document_version (
  id                  text primary key,
  document_id         text not null references document (id) on delete cascade,
  version             integer not null,
  source              text not null check (source in ('agent', 'edit', 'recruiter', 'template')),
  instructions        text,
  template_id         text not null,
  locale              text not null,
  paper               text not null,
  format              text not null,
  content_json        text,
  status              text not null default 'queued' check (status in ('queued', 'collecting', 'generating',
                        'validating', 'rendering', 'checking', 'reviewing', 'retrying', 'ready', 'ready_with_issues', 'error')),
  attempts            integer not null default 0,
  review_json         text,
  ats_score           real,
  pages_rendered      integer,
  pdf_path            text,
  text_body           text,
  -- validade (F05-18): fatos, vaga e perfil (campos e ênfases) no momento da geração
  facts_version       integer not null,
  posting_updated_at  text,
  profile_hash        text not null,
  job_id              text,
  usage_json          text not null default '[]',
  error               text,
  created_at          text not null,
  updated_at          text not null,
  unique (document_id, version)
);

-- templates enviados pela pessoa (.zip, F05 §2.6); os padrão vivem no código
create table cv_template (
  id                      text primary key,
  name                    text not null,
  engine                  text not null default 'handlebars' check (engine in ('handlebars')),
  path                    text not null,
  manifest_json           text not null default '{}',
  preview_path            text,
  status                  text not null default 'validating' check (status in ('validating', 'valid', 'invalid')),
  validation_errors_json  text not null default '[]',
  created_at              text not null,
  updated_at              text not null
);
