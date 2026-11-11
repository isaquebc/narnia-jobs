-- narnia: foreign-keys-off
-- F14/M5 · candidatura vinda de e-mail (F14-15, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.0.2). A confirmação de
-- candidatura pode ser de uma vaga em que a pessoa se candidatou fora do narnia: o CV deixa de ser obrigatório na
-- tabela (o botão Aplicar continua exigindo, no código). Novos: `source` (de onde veio), `cv_presumed` (CV gerado para
-- a vaga ligado sem a pessoa confirmar), `source_ref_json` (e-mail de origem) e `profile_pending` (perfil a escolher).
-- O SQLite não muda NOT NULL: a tabela é reconstruída (FKs desligadas pelo executor, foreign_key_check antes do commit).
create table job_application_new (
  id                      text primary key,
  posting_id              text not null references posting (id),
  profile_id              text references profile (id) on delete set null,
  cv_version_id           text references document_version (id),
  cover_letter_version_id text references document_version (id),
  applied_on              text not null,
  board_column            text not null default 'applied'
                            check (board_column in ('applied', 'first_interview', 'in_process', 'offer', 'closed')),
  closed_reason           text check (closed_reason in ('hired', 'declined', 'rejected', 'withdrew', 'no_response')),
  current_stage_id        text,
  last_activity_at        text not null,
  archived_at             text,
  created_at              text not null,
  updated_at              text not null,
  chat_session_id         text references chat_session (id) on delete set null,
  closed_stage            text,
  closed_entry_id         text references job_application_entry (id) on delete set null,
  source                  text not null default 'manual' check (source in ('manual', 'email')),
  cv_presumed             integer not null default 0 check (cv_presumed in (0, 1)),
  source_ref_json         text,
  profile_pending         integer not null default 0 check (profile_pending in (0, 1))
);
insert into job_application_new (id, posting_id, profile_id, cv_version_id, cover_letter_version_id, applied_on,
  board_column, closed_reason, current_stage_id, last_activity_at, archived_at, created_at, updated_at, chat_session_id,
  closed_stage, closed_entry_id)
select id, posting_id, profile_id, cv_version_id, cover_letter_version_id, applied_on, board_column, closed_reason,
  current_stage_id, last_activity_at, archived_at, created_at, updated_at, chat_session_id, closed_stage, closed_entry_id
from job_application;
drop table job_application;
alter table job_application_new rename to job_application;
create index job_application_posting on job_application (posting_id);
create index job_application_activity on job_application (archived_at, last_activity_at);

-- passagem de coluna vinda de e-mail: o instante é o do e-mail (a data e hora pedidas pelo dono) e o e-mail fica ligado
alter table job_application_move add column source text not null default 'manual' check (source in ('manual', 'email'));
alter table job_application_move add column mail_message_id text references mail_message (id) on delete set null;
