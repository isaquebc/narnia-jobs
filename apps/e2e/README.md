# apps/e2e

Testes de ponta a ponta (Playwright) por fluxo do usuário, em container (`mcr.microsoft.com/playwright`) contra
`docker compose -p narnia-e2e -f docker-compose.yml -f docker-compose.e2e.yml`: a stack de produção com provider mock,
token fixo e dados descartáveis (`./.e2e-data`). Rode com `./start.sh e2e` (completo) ou
`./start.sh e2e --ui-only --grep F06` (só a interface, filtrando).

- Um arquivo por cenário, com o prefixo da task: `e2e-NN-*` (F01, primeiro uso), `f02-` (perfis), `f03-` (ingestão),
  `f04-` (chat e avaliações), `f05-` (currículo e carta), `f06-` (vagas), `f07-` (candidaturas) e `f12-` (extensão e
  formulários). O título de cada teste começa pelo id (`F06/E2E-03 …`), que é o que o `--grep` filtra.
- Os cenários marcados `@ops` têm duas partes orquestradas pelo lançador (down/up, worker morto); o E2E-13 (porta
  ocupada) é uma fase bash do `start.sh`. `--ui-only` pula essas fases.
- Os cenários semeiam os dados por `POST /api/_test/seed` (fixtures fictícias `engineer`, `leader`, `long`), sem passar
  pelo primeiro uso, exceto os do F01.
- `helpers/`: `api.ts` (API e reset), `flows.ts` (primeiro uso), `profiles.ts`, `ingest.ts`, `chat.ts`, `postings.ts` e
  `documents.ts`.
- Falhou no CI: o relatório (`apps/e2e/report`) e os resultados (`apps/e2e/test-results`, com o snapshot da página no
  `error-context.md`) vão como artefato `playwright-report` da execução.
