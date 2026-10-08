# 09 · Metodologia: TDD, testes por fluxo e registro para o harness

Decisão do dono do projeto (2026-10-07): **TDD em toda implementação e em toda correção, quando aplicável.** Os testes são a garantia da entrega; cada fluxo do usuário tem testes e2e próprios. Este documento define o rito e o registro que, mais adiante, um harness (hooks do Claude Code ou CI) poderá verificar automaticamente.

## 1 · Rito por unidade de trabalho
1. **Escrever o teste que falha** descrevendo o comportamento (unitário para regra/função; de rota para API; de componente para UI; e2e para fluxo). Rodar e confirmar que falha pelo motivo certo.
2. **Implementar o mínimo** para passar.
3. **Refatorar** com os testes verdes.
4. **Registrar** no §8 da task: id do teste, motivo da mudança, e se foi "teste antes" ou exceção justificada.

Exceções aceitas (registradas como tal): configuração de ferramentas sem lógica (tsconfig, Dockerfile), geração de código (schemas → JSON Schema), e spikes exploratórios descartados antes de virar código de produto.

## 2 · Correções (bugs)
Toda correção começa por um **teste de regressão que reproduz o defeito** e falha. Só então a correção. O teste fica com o id do defeito no nome (`regression: F03/E2E-07 conflito de datas`).

## 3 · Pirâmide por camada
| Camada | Ferramenta | O que cobre |
|--------|------------|-------------|
| `packages/shared`, `packages/core` | Vitest | regras puras, schemas, repositórios (SQLite em memória/arquivo temporário), extração, consolidação, fila (Redis de teste ou mock da BullMQ) |
| `apps/api`, `apps/worker` | Vitest + cliente HTTP em memória | rotas, validação, autorização por token, eventos WS, processadores de job com provider mock |
| `apps/web` | Vitest + Testing Library + jsdom | componentes, formulários, estados de erro, i18n (nenhuma string fora do dicionário) |
| **Fluxos do usuário** | Playwright contra `docker compose -f docker-compose.e2e.yml` | **um conjunto e2e por fluxo** (`tasks/Fxx §6.3`), sempre com provider mock, nunca com assinatura real |
| Manual com provider real | checklist em §6.4 de cada task | qualidade do modelo, tokens reais × estimativa |

## 4 · Regras
- Nenhum teste automatizado usa a assinatura do usuário nem chaves reais.
- Fixtures sem dados pessoais (currículos, textos e repositórios fictícios).
- Cobertura mínima 80% em `core` e `shared`; falha de limiar bloqueia a CI.
- Testes e2e nomeados por fluxo e cenário (`F01/E2E-03`), referenciados no §6.3 da task e no título do teste.
- Teste quebrado não é "pulado": ou se corrige, ou se remove com registro em §8.

## 5 · Registro para o harness futuro
Cada task mantém em §8 uma linha por unidade de trabalho com: data, marco, testes criados/alterados (ids), "teste antes: sim/não (motivo)". A CI publica o relatório do Vitest e do Playwright como artefato. Quando o harness existir (hook `PreToolUse`/`Stop` do Claude Code ou verificação na CI), ele usará estes dois sinais: (a) todo arquivo de produto alterado tem teste alterado no mesmo conjunto de mudanças; (b) o §8 da task referencia os ids. Até lá, a verificação é manual na revisão.
