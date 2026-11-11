-- F13/M4 · análise da entrevista gravada (plans/plan-v0/tasks/done/F13 §3): pessoas, turnos, eventos, quadros e relatório.
-- As medições brutas ficam em `<dados>/interviews/<id>/work/*.json` (fora do backup, junto do vídeo); o que entra aqui
-- é o resultado consolidado, que vai para o backup com o banco. Os quadros escolhidos ficam em
-- `<dados>/interview-frames/<id>/` (dentro do backup).
alter table recorded_interview add column step text;
alter table recorded_interview add column progress integer not null default 0;
alter table recorded_interview add column language text;
alter table recorded_interview add column meeting_start_s real;
alter table recorded_interview add column approximate integer not null default 0;
alter table recorded_interview add column models text;          -- JSON: modelos usados em cada etapa
alter table recorded_interview add column measurements text;    -- JSON: medições gerais (volume integrado, ruído…)
alter table recorded_interview add column frames text;          -- JSON: quadros escolhidos [{t, file, reason, person, events}]
alter table recorded_interview add column facts_version integer;
alter table recorded_interview add column analyzed_at text;

create table recorded_interview_person (
  id                text primary key,
  recording_id      text not null references recorded_interview (id) on delete cascade,
  key               text not null,                 -- P1, P2… (ordem da análise)
  name              text,
  name_source       text,                          -- ocr | user
  is_candidate      integer not null default 0,
  candidate_source  text,                          -- name | talk | user
  contact_id        text references posting_contact (id) on delete set null,
  speaker           text,
  track             text,
  ambiguous         integer not null default 0,
  measurements      text,                          -- JSON: voz, áudio, rosto, câmera, confiabilidade
  card              text,                          -- JSON: ficha da pessoa (M5)
  position          integer not null
);
create index recorded_interview_person_rec on recorded_interview_person (recording_id, position);

create table recorded_interview_turn (
  id                text primary key,
  recording_id      text not null references recorded_interview (id) on delete cascade,
  idx               integer not null,
  person_id         text references recorded_interview_person (id) on delete set null,
  start_s           real not null,
  end_s             real not null,
  text              text not null,
  words             text,                          -- JSON: [{w, start, end, p}]
  corrected         integer not null default 0
);
create index recorded_interview_turn_rec on recorded_interview_turn (recording_id, idx);

create table recorded_interview_event (
  id                text primary key,
  recording_id      text not null references recorded_interview (id) on delete cascade,
  key               text not null,                 -- e1, e2… (id da etapa de eventos)
  person_id         text references recorded_interview_person (id) on delete set null,
  t                 real not null,
  duration_s        real,
  type              text not null,                 -- note | smile | brow_raise | frown
  level             text,                          -- confirmed | probable (anotações)
  reading           text,                          -- favorable | unfavorable | indeterminate (hipótese do recrutador)
  reason            text,
  turn_idx          integer,
  frame             text,
  data              text                           -- JSON: pista, intensidade, evidência
);
create index recorded_interview_event_rec on recorded_interview_event (recording_id, t);

create table recorded_interview_report (
  id                text primary key,
  recording_id      text not null references recorded_interview (id) on delete cascade,
  version           integer not null,
  content           text not null,                 -- JSON do relatório (§2.5), já conferido por código
  warnings          text,                          -- JSON: correções e remoções da checagem
  model             text,
  usage_event_id    text,
  created_at        text not null
);
create index recorded_interview_report_rec on recorded_interview_report (recording_id, version);
