-- F13/M1 · entrevista gravada (plans/plan-v0/tasks/done/F13 §3 e §6.1.1, R5): só a tabela principal; pessoas, turnos, eventos
-- e relatório vêm no M4. O vídeo fica em `<dados>/interviews/<id>/video.<ext>` (fora do backup, F13-2); a parte em
-- envio em `video.part`. Apagar a candidatura apaga as entrevistas dela (o core apaga as pastas antes).
create table recorded_interview (
  id                  text primary key,
  profile_id          text not null references profile (id) on delete cascade,
  job_application_id  text references job_application (id) on delete cascade,
  stage_id            text references job_application_stage (id) on delete set null,
  title               text,
  state               text not null,
  file_name           text not null,
  mime                text not null,
  ext                 text not null,
  size                integer not null,
  received            integer not null default 0,
  has_video           integer not null default 0,
  duration_s          real,
  error               text,
  created_at          text not null,
  updated_at          text not null
);
create index recorded_interview_app on recorded_interview (job_application_id, created_at);
create index recorded_interview_profile on recorded_interview (profile_id, created_at);
