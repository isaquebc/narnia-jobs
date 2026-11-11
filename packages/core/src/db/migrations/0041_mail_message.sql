-- F14/M2 · e-mails lidos do Gmail (plans/plan-v0/tasks/F14-leitura-de-emails.md §2.2 e §3). Aditiva.
-- Um registro por mensagem (gmail_id único: nunca processa duas vezes); o e-mail bruto fica em <dados>/mail/<gmail_id>.eml
-- (plano e imutável, entra no backup). `status`: pending (baixado, falta processar), processing, done, review (caixa de
-- revisão), quarantine (risco alto, F14-14), ignored (fora do assunto), error. `gmail_synced`: etiqueta e lido aplicados.
create table mail_message (
  id           text primary key,
  gmail_id     text not null unique,
  thread_id    text,
  from_addr    text,
  from_name    text,
  reply_to     text,
  subject      text,
  received_at  text not null,
  size         integer not null default 0,
  labels_json  text not null default '[]',
  raw_path     text not null,
  status       text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'review', 'quarantine', 'ignored', 'error')),
  class        text,
  confidence   real,
  risk_level   text check (risk_level in ('trusted', 'neutral', 'high')),
  risk_reasons_json text not null default '[]',
  result_json  text,
  error        text,
  gmail_synced integer not null default 0 check (gmail_synced in (0, 1)),
  processed_at text,
  undone_at    text,
  created_at   text not null,
  updated_at   text not null
);
create index mail_message_status on mail_message (status, received_at);
create index mail_message_thread on mail_message (thread_id);
