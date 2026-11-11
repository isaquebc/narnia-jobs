-- F14/M4 · vaga vinda de e-mail e o feed (plans/plan-v0/tasks/F14-leitura-de-emails.md §3). Aditiva, sem reconstruir
-- a tabela: o arquivamento automático do feed (F14-9) vai em `archive_auto` e deixa `archive_reason` nulo, então
-- nunca entra na calibração do fit (`discardedPostings` só lê os motivos da pessoa).
alter table posting add column source text not null default 'manual'
  check (source in ('manual', 'extension', 'email'));
alter table posting add column source_ref_json text;
alter table posting add column link_status text check (link_status in ('ok', 'failed', 'none'));
alter table posting add column feed_state text check (feed_state in ('new', 'seen'));
alter table posting add column match_score integer;
alter table posting add column canonical_url text;
alter table posting add column archive_auto text check (archive_auto in ('stale'));
alter table posting add column last_interaction_at text;
alter table posting add column auto_analysis_at text;
create index posting_canonical_url on posting (canonical_url);
create index posting_feed on posting (source, archived_at, match_score);

-- origem das vagas que já existem: as salvas pela extensão (F12) ficam como `extension`
update posting set source = 'extension' where id in (select posting_id from extension_capture where posting_id is not null);
