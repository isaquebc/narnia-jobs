## O que muda · What changes

<!-- Uma ou duas frases. Ligue a issue: Closes #123 -->

## Como foi testado · How it was tested

- [ ] Teste que falhava antes da mudança (TDD, ver `plans/plan-v0/09-metodologia-tdd.md`)
- [ ] `./start.sh lint`, `typecheck` e `test` verdes (ou `make check`)
- [ ] `./start.sh e2e` verde, se mudou a interface ou um fluxo
- [ ] `./start.sh test:sh`, se mudou `start.sh` ou `start.ps1`
- [ ] Prompt novo ou alterado: gate de avaliações (ver `CONTRIBUTING.md`)

## Checklist

- [ ] Nenhum dado pessoal real (nomes, empresas, vagas, e-mails) em código, testes, fixtures ou mensagens de commit
- [ ] Textos novos da interface em `apps/web/src/i18n/pt-BR.ts`
- [ ] Documentação atualizada (README, `docs/`), se o comportamento mudou
