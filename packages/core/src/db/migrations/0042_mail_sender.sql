-- F14/M3 · confiabilidade dos remetentes e lista de confiáveis e bloqueados (F14-13, plano §2.7). Aditiva.
-- `value` é um endereço (`rh@acme.example`) ou um domínio com @ na frente (`@acme.example`); domínio de webmail só
-- entra por endereço. `override` vence a nota automática; os contadores alimentam a nota e as sugestões.
create table mail_sender (
  value          text primary key,
  override       text check (override in ('trusted', 'blocked')),
  override_origin text check (override_origin in ('manual', 'extension', 'review')),
  seen_count     integer not null default 0,
  ok_count       integer not null default 0,
  rejected_count integer not null default 0,
  last_seen_at   text,
  created_at     text not null,
  updated_at     text not null
);

-- quarentena (F14-14): a etiqueta `narnia-jobs/suspeito` está no Gmail? Separado de `gmail_synced` (etiqueta
-- narnia-jobs e lido, M4): reprocessar tira a de suspeito na próxima execução se o e-mail saiu da quarentena.
alter table mail_message add column suspect_label integer not null default 0 check (suspect_label in (0, 1));
