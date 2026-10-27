-- F07/M1 · candidaturas (plans/plan-v0/tasks/F07-candidaturas.md §0, requisitos do dono 2026-10-27). `job_application`
-- porque `application_form` já é o formulário da extensão (F12). Nasce só do botão "Aplicar": a vaga e as versões do CV
-- (obrigatória) e da carta ficam travadas; as chaves sem `on delete` fazem o banco recusar apagar a vaga ou o documento
-- que foi enviado. A coluna do quadro é independente do pipeline de etapas (F07-8).
create table job_application (
  id                      text primary key,
  posting_id              text not null references posting (id),
  profile_id              text references profile (id) on delete set null,
  cv_version_id           text not null references document_version (id),
  cover_letter_version_id text references document_version (id),
  applied_on              text not null,
  board_column            text not null default 'applied'
                            check (board_column in ('applied', 'first_interview', 'in_process', 'offer', 'closed')),
  closed_reason           text check (closed_reason in ('hired', 'declined', 'rejected', 'withdrew', 'no_response')),
  current_stage_id        text,
  last_activity_at        text not null,
  archived_at             text,
  created_at              text not null,
  updated_at              text not null
);
create index job_application_posting on job_application (posting_id);
create index job_application_activity on job_application (archived_at, last_activity_at);

-- Pipeline de cada candidatura (uma pode ter 3 etapas, outra 6): nome livre e posição 1..N.
create table job_application_stage (
  id                  text primary key,
  job_application_id  text not null references job_application (id) on delete cascade,
  name                text not null,
  position            integer not null,
  created_at          text not null
);
create index job_application_stage_app on job_application_stage (job_application_id, position);
