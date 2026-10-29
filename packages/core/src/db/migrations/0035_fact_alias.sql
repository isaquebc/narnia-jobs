-- Apelidos aprendidos da busca de fatos (F04-fix-fundamentacao, FF-1, 2026-10-29): quando a busca por um termo falha e
-- o recrutador acha o fato por outro termo, grava "termo → fato". O apelido aponta para um fato que existe (nunca liga
-- palavra a palavra); apagar o fato deixa o apelido órfão, e a busca o ignora.
create table fact_alias (
  id          text primary key,
  term        text not null,
  term_norm   text not null,
  kind        text not null,
  fact_id     text not null,
  session_id  text,
  created_at  text not null,
  unique (term_norm, kind, fact_id)
);
create index fact_alias_term on fact_alias (term_norm);
