-- Motivações do perfil (F12-23, pedido do dono 2026-10-26): o que move a pessoa, em frases curtas por perfil, sugeridas
-- pelo histórico e decididas por ela (aceita, editada ou recusada; a recusada fica para não voltar a ser sugerida). O
-- roleplay do formulário usa as aceitas como dado, não como suposição.
create table profile_motivation (
  id text primary key,
  profile_id text not null references profile(id) on delete cascade,
  text text not null,
  status text not null check (status in ('suggested', 'accepted', 'refused')),
  source text not null check (source in ('model', 'user', 'assumption')),
  -- suposição do roleplay que a pessoa aceitou ou recusou na janela (o texto como o roleplay escreveu)
  assumption text,
  created_at text not null,
  updated_at text not null
);
create index profile_motivation_profile on profile_motivation (profile_id, created_at);

-- A pessoa revisou as sugestões (mesmo sem aceitar nenhuma): a janela do formulário não pergunta de novo.
alter table profile add column motivations_reviewed_at text;
