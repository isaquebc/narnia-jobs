-- F07/M3 · notas e anexos datados da candidatura (§0-5): texto e/ou arquivos, com a data que a pessoa escolhe (ex.: um
-- e-mail de ontem). Os arquivos ficam em `<dados>/job-applications/<id do anexo>`; o nome original fica aqui.
create table job_application_entry (
  id                  text primary key,
  job_application_id  text not null references job_application (id) on delete cascade,
  occurred_on         text not null,
  body                text,
  created_at          text not null,
  updated_at          text not null
);
create index job_application_entry_app on job_application_entry (job_application_id, occurred_on);

create table job_application_attachment (
  id          text primary key,
  entry_id    text not null references job_application_entry (id) on delete cascade,
  file_name   text not null,
  mime        text not null,
  size        integer not null,
  position    integer not null,
  created_at  text not null
);
create index job_application_attachment_entry on job_application_attachment (entry_id, position);
