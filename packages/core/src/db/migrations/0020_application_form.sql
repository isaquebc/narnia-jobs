-- Formulário de candidatura (F12/M3, §5): os campos que a extensão leu da página e as perguntas organizadas a partir
-- deles, ligados à captura, à vaga (se houver) e ao perfil. As respostas entram no M4 (`application_answer`). Aditiva.
create table application_form (
  id text primary key,
  capture_id text not null,
  posting_id text,
  profile_id text,
  url text not null,
  title text,
  fields_json text not null,
  questions_json text not null default '[]',
  status text not null check (status in ('locating', 'ready', 'error')),
  error text,
  created_at text not null,
  updated_at text not null
);
create index application_form_capture on application_form (capture_id);
