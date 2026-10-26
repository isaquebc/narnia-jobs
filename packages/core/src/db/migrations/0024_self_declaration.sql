-- Autodeclaração (F12-12, decisão F12-22): o que a pessoa declarou no chat (raça, gênero, deficiência e afins), guardado
-- só aqui e fora dos fatos, para nunca chegar ao CV, à carta nem às análises. Um valor por assunto; o mais novo vale.
create table self_declaration (
  topic text primary key,
  value text not null,
  updated_at text not null
);
