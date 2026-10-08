# apps/e2e

Testes de ponta a ponta (Playwright) por fluxo do usuário, em container (`mcr.microsoft.com/playwright`) contra
`docker compose -p narnia-e2e -f docker-compose.yml -f docker-compose.e2e.yml`, com provider mock. Rode com
`./start.sh e2e` (completo) ou `./start.sh e2e --ui-only --grep F02` (só a interface, filtrando).

- `tests/e2e-NN-*.spec.ts`: cenários do F01 (`F01/E2E-01` a `E2E-17`); os marcados `@ops` têm duas partes orquestradas
  pelo lançador (down/up, worker morto); o E2E-13 (porta ocupada) é uma fase bash do `start.sh`.
- `tests/f02-NN-*.spec.ts`: cenários do F02 (`F02/E2E-01` a `E2E-09`), semeados por `POST /api/_test/seed` (fixtures
  `engineer`, `leader`, `long`), sem passar pelo wizard.
- `helpers/api.ts` (API e reset), `helpers/flows.ts` (wizard do F01), `helpers/profiles.ts` (perfis do F02).
