-- Página da vaga · contatos (pedido do dono, 2026-10-19): link do perfil no LinkedIn e um contato fixado por vaga
-- (fica no topo da página, fora do limite dos dois últimos). Aditiva; os contatos existentes ficam sem link e soltos.
alter table posting_contact add column linkedin_url text;
alter table posting_contact add column pinned integer not null default 0;
