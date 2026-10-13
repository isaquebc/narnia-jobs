-- Motivo do selo anti-alucinação (pedido do dono, 2026-10-13): código da camada 1 (sem trecho, curto demais, não
-- encontrado) ou nota do revisor da camada 2, em JSON. Aditiva; execuções antigas ficam sem motivo.
alter table ingestion_proposal add column check_reason_json text;
