-- Capturas da extensão do navegador (F12/M2): a página lida quando a pessoa clica no ícone (o que o extrator da F06
-- tirou dela; o HTML fica em <dados>/captures/<id>.html) e a vaga em que virou. Aditiva.
create table extension_capture (
  id text primary key,
  kind text not null,
  url text not null,
  title text,
  payload_json text not null,
  device_id text,
  posting_id text,
  created_at text not null
);
