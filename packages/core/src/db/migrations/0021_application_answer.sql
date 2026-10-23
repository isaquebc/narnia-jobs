-- Respostas sugeridas do formulário de candidatura (F12/M4, §5): uma linha por versão de cada pergunta (a mais nova
-- vale; refazer pelo chat no M5 cria outra); o formulário guarda o estado da geração. Aditiva.
alter table application_form add column answers_status text not null default 'idle';
alter table application_form add column answers_error text;
create table application_answer (
  id text primary key,
  form_id text not null,
  question_id text not null,
  version integer not null,
  answer text,
  origins_json text not null default '[]',
  gap text,
  source text not null check (source in ('model', 'chat', 'edited')),
  created_at text not null
);
create index application_answer_form on application_answer (form_id, question_id, version);
