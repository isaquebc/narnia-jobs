-- F02 · Troca de perfil (M1). Só para frente, como 0001. Ver plans/plan-v0/tasks/F02-troca-de-perfil.md §3.

-- profile: persona (F02-7), arquivamento (F02-6), clonagem (F02-8) e validade do cartão por facts_version (F02-1).
alter table profile add column persona_overrides_json text not null default '{}';
alter table profile add column archived_at text;
alter table profile add column cloned_from text references profile (id);
alter table profile add column card_facts_version integer;

-- Ênfases por perfil: a lente marca e ordena fatos, nunca os duplica (§2.1).
create table profile_emphasis (
  id          text primary key,
  profile_id  text not null references profile (id) on delete cascade,
  fact_kind   text not null check (fact_kind in ('experience', 'project', 'skill', 'education', 'language', 'achievement')),
  fact_id     text not null,
  mode        text not null check (mode in ('highlight', 'normal', 'hidden')),
  position    integer,
  updated_at  text not null,
  unique (profile_id, fact_kind, fact_id)
);
create index profile_emphasis_order on profile_emphasis (profile_id, fact_kind, position);

-- Relevância por fato e perfil, calculada junto com o cartão (§2.3); F04 lê para ordenar a busca.
create table profile_fact_relevance (
  profile_id   text not null references profile (id) on delete cascade,
  fact_kind    text not null,
  fact_id      text not null,
  score        real not null check (score >= 0 and score <= 1),
  reasons_json text not null default '[]',
  computed_at  text not null,
  primary key (profile_id, fact_kind, fact_id)
);

-- Sugestões de perfil: heurísticas (zero tokens) ou do modelo ("Analisar possíveis perfis", F02-5).
create table profile_suggestion (
  id               text primary key,
  user_id          text not null references user (id),
  source           text not null check (source in ('heuristic', 'model')),
  model            text,
  title_normalized text not null,
  payload_json     text not null,
  status           text not null default 'new' check (status in ('new', 'accepted', 'dismissed')),
  created_at       text not null,
  decided_at       text
);
create index profile_suggestion_user_status on profile_suggestion (user_id, status);
create unique index profile_suggestion_title on profile_suggestion (user_id, title_normalized);

-- Projetos (F02-9): nasce vazia; F03 preenche pelo GitHub. Mesmos metadados dos demais fatos.
create table project (
  id          text primary key,
  user_id     text not null references user (id),
  name        text not null,
  description text,
  url         text,
  role        text,
  start_date  text,
  end_date    text,
  tech_json   text not null default '[]',
  source_id   text references fact_source (id),
  confidence  real not null,
  verified    integer not null default 0,
  created_at  text not null,
  updated_at  text not null
);
