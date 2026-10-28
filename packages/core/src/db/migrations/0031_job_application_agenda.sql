-- F07/M5 · agenda das etapas e histórico das colunas (funil).
-- Evento: data e hora gravadas em UTC com o fuso da pessoa no momento do registro (F07-3); `ics_sequence` sobe a cada
-- edição para reimportar o `.ics` atualizar o evento; `google_event_id` fica para a integração opcional (M7).
create table job_application_event (
  id                  text primary key,
  job_application_id  text not null references job_application (id) on delete cascade,
  stage_id            text references job_application_stage (id) on delete set null,
  kind                text not null check (kind in ('interview', 'test', 'deadline', 'followup', 'other')),
  title               text not null,
  starts_at           text not null,
  duration_min        integer not null,
  timezone            text not null,
  location            text,
  link                text,
  notes               text,
  done_at             text,
  ics_sequence        integer not null default 0,
  google_event_id     text,
  created_at          text not null,
  updated_at          text not null
);
create index job_application_event_app on job_application_event (job_application_id, starts_at);
create index job_application_event_start on job_application_event (done_at, starts_at);

-- Cada mudança de coluna (a primeira é a criação, sem origem): o funil sai daqui.
create table job_application_move (
  id                  text primary key,
  job_application_id  text not null references job_application (id) on delete cascade,
  from_column         text,
  to_column           text not null,
  at                  text not null
);
create index job_application_move_app on job_application_move (job_application_id, at);

-- candidaturas de antes: a criação e, se já saíram de Aplicado, a mudança para a coluna atual
insert into job_application_move (id, job_application_id, from_column, to_column, at)
  select id || '-m0', id, null, 'applied', created_at from job_application;
insert into job_application_move (id, job_application_id, from_column, to_column, at)
  select id || '-m1', id, 'applied', board_column, updated_at from job_application where board_column <> 'applied';
