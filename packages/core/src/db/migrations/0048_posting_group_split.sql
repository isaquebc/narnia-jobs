-- Pedido do dono 2026-11-12 (F14): vagas iguais (mesma empresa e cargo, links diferentes) aparecem num card só; a
-- pessoa pode separar uma que confirmou ser diferente, e ela não entra mais no grupo.
alter table posting add column group_split integer not null default 0 check (group_split in (0, 1));
