-- F14/M6 · atualizações, convites e desfazer (plans/plan-v0/tasks/F14-leitura-de-emails.md §2.3, §2.4, §3). Aditiva.

-- Histórico das mudanças de etapa (de, para, instante, origem): base do desfazer e do aprendizado (F14-2). `manual` é a
-- pessoa (página, chat); `email` é o automático do e-mail; `suggestion` é uma sugestão aprovada.
create table job_application_stage_change (
  id                  text primary key,
  job_application_id  text not null references job_application (id) on delete cascade,
  from_stage_id       text,
  to_stage_id         text,
  at                  text not null,
  source              text not null check (source in ('manual', 'email', 'suggestion', 'undo')),
  mail_message_id     text references mail_message (id) on delete set null,
  created_at          text not null
);
create index job_application_stage_change_app on job_application_stage_change (job_application_id, at);

-- Etapa sugerida (ou movida sozinha) por um e-mail (§2.4). `decision`: null (aberta), approved, rejected, undone
-- (automático desfeito), corrected (a pessoa trocou a etapa à mão depois). `hint` é a etapa com as palavras do e-mail;
-- `company` e `platform` guardam o vocabulário aprendido por empresa e plataforma.
create table stage_suggestion (
  id                  text primary key,
  mail_message_id     text not null references mail_message (id) on delete cascade,
  job_application_id  text not null references job_application (id) on delete cascade,
  from_stage_id       text,
  to_stage_id         text,
  to_stage_name       text not null,
  hint                text,
  company             text,
  platform            text,
  confidence          real not null,
  mode                text not null check (mode in ('suggested', 'auto')),
  decision            text check (decision in ('approved', 'rejected', 'undone', 'corrected')),
  decided_at          text,
  -- corrigida: a etapa que a pessoa escolheu (o vocabulário aprende com ela)
  corrected_stage_name text,
  -- a etapa em que a candidatura ficou (automático ou aprovação, inclusive com outra etapa escolhida)
  applied_stage_id    text,
  created_at          text not null
);
create index stage_suggestion_open on stage_suggestion (decision, created_at);
create index stage_suggestion_app on stage_suggestion (job_application_id, created_at);

-- Convites (F14-3): o evento oficial é o do `.ics` da empresa (`ics_uid`); sem `.ics`, a etapa nasce provisória e a
-- pessoa bloqueia a agenda por clique (`blocked_at`); o cancelamento marca `cancelled_at` (não lembra mais).
alter table job_application_event add column provisional integer not null default 0 check (provisional in (0, 1));
alter table job_application_event add column ics_uid text;
alter table job_application_event add column mail_message_id text references mail_message (id) on delete set null;
alter table job_application_event add column blocked_at text;
alter table job_application_event add column cancelled_at text;
alter table job_application_event add column ics_remote_sequence integer;
create index job_application_event_uid on job_application_event (ics_uid);

-- Desfazer por e-mail: o que o e-mail fez (ids criados e o estado anterior), para reverter.
alter table mail_message add column undo_json text;
