-- F15 (plans/plan-v0/tasks/F15-tarefas-e-avisos.md §3): tarefas da pessoa num kanban (A fazer, Fazendo, Feito), manuais
-- ou nascidas de um e-mail que pede uma ação (triagem, teste, formulário). Ligadas, se for o caso, à candidatura, à vaga e
-- ao e-mail; apagar um deles só solta a ligação. Os avisos de prazo ficam marcados para sair uma vez só (F15-4).
create table todo (
  id                   text primary key,
  title                text not null,
  note                 text,
  status               text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  position             real not null default 0,
  due_at               text,
  action_url           text,
  source               text not null default 'manual' check (source in ('manual', 'email')),
  kind                 text,
  job_application_id   text references job_application (id) on delete set null,
  posting_id           text references posting (id) on delete set null,
  mail_message_id      text references mail_message (id) on delete set null,
  notified_due_soon_at text,
  notified_overdue_at  text,
  done_at              text,
  created_at           text not null,
  updated_at           text not null
);
create index todo_board on todo (status, position);
create index todo_due on todo (due_at) where due_at is not null and status <> 'done';
create index todo_application on todo (job_application_id);
create index todo_mail on todo (mail_message_id);

create table todo_tag (
  todo_id text not null references todo (id) on delete cascade,
  tag     text not null,
  primary key (todo_id, tag)
);
create index todo_tag_tag on todo_tag (tag);
