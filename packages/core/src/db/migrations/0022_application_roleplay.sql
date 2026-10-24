-- Roleplay e edição das respostas (F12-18, F12-19): a origem ganha `roleplay` (o rascunho escrito como a pessoa) e
-- cada resposta guarda as suposições que a pessoa confere. O SQLite não muda um CHECK: a tabela é refeita com os dados.
create table application_answer_new (
  id text primary key,
  form_id text not null,
  question_id text not null,
  version integer not null,
  answer text,
  origins_json text not null default '[]',
  gap text,
  assumptions_json text not null default '[]',
  source text not null check (source in ('model', 'roleplay', 'chat', 'edited')),
  created_at text not null
);
insert into application_answer_new (id, form_id, question_id, version, answer, origins_json, gap, source, created_at)
  select id, form_id, question_id, version, answer, origins_json, gap, source, created_at from application_answer;
drop table application_answer;
alter table application_answer_new rename to application_answer;
create index application_answer_form on application_answer (form_id, question_id, version);
