-- Análise pedida pela janela da extensão (F12/M2, pedido do dono 2026-10-23): "Salvar vaga" também analisa. A captura
-- guarda o pedido, a conversa da análise e o erro ao abrir (teto de conversas). Aditiva.
alter table extension_capture add column analysis_requested_at text;
alter table extension_capture add column analysis_session_id text;
alter table extension_capture add column analysis_error text;
