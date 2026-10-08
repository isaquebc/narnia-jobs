# apps/e2e

Testes de ponta a ponta (Playwright) por fluxo do usuário. Chegam com o marco M7 do F01. Rodam em container
(`mcr.microsoft.com/playwright`) contra `docker compose -f docker-compose.yml -f docker-compose.e2e.yml`, com provider mock.
