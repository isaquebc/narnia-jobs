-- F14/M1 · tarefas agendadas (F14-12, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.6). Aditiva.
-- As definições (intervalo padrão e mínimo) ficam no código; aqui ficam a escolha da pessoa, a próxima execução e o
-- histórico com o log e os itens tocados. Execuções e logs saem depois da retenção (padrão 90 dias).
create table scheduled_task (
  id               text primary key,
  interval_minutes integer,
  paused           integer not null default 0 check (paused in (0, 1)),
  next_run_at      text,
  updated_at       text not null
);

create table scheduled_run (
  id          text primary key,
  task_id     text not null,
  trigger     text not null check (trigger in ('schedule', 'manual')),
  status      text not null check (status in ('running', 'done', 'error')),
  started_at  text not null,
  finished_at text,
  counts_json text not null default '{}',
  error       text
);
create index scheduled_run_task on scheduled_run (task_id, started_at);

create table scheduled_run_log (
  id      integer primary key autoincrement,
  run_id  text not null references scheduled_run (id) on delete cascade,
  at      text not null,
  level   text not null check (level in ('info', 'warn', 'error')),
  message text not null
);
create index scheduled_run_log_run on scheduled_run_log (run_id);

create table scheduled_run_item (
  id      integer primary key autoincrement,
  run_id  text not null references scheduled_run (id) on delete cascade,
  at      text not null,
  kind    text not null,
  ref_id  text,
  label   text not null,
  action  text not null,
  result  text not null check (result in ('ok', 'skipped', 'error')),
  detail  text,
  href    text
);
create index scheduled_run_item_run on scheduled_run_item (run_id);
