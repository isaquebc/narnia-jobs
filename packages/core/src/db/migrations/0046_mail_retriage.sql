-- Correção 2026-11-11 (F14): o pré-filtro descartava confirmações do Indeed ("Inscrição via Indeed") e alertas de uma
-- vaga do Glassdoor em português. Os e-mails que ele pôs como fora do assunto voltam para a triagem; o que continuar
-- fora volta a ser ignorado (nada mudou no Gmail: fora do assunto nunca ganha etiqueta).
update mail_message
   set status = 'pending', class = null, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 where status = 'ignored' and class = 'ignored';

-- Score provisório (decisão do dono 2026-11-11, F14-16): vaga do e-mail sem descrição (o LinkedIn recusa robôs pelo
-- robots.txt) ganha um score só pelo cargo, a senioridade e o local do alerta, marcado como provisório; o score completo
-- (pela descrição) toma o lugar quando chega. Provisório nunca dispara a pré-análise automática.
alter table posting add column match_score_provisional integer not null default 0
  check (match_score_provisional in (0, 1));
