# 04 · Escopo de dados do usuário

Princípios:
1. **Fato com fonte.** Todo dado extraído guarda de onde veio, com que confiança e se o usuário confirmou. Isso sustenta a honestidade do recrutador.
2. **Usuário base × Perfil.** Fatos pertencem ao usuário base. Perfis só guardam ênfase, narrativa e preferências de apresentação.
3. **Mínimo necessário.** Não coletamos documentos de identidade (CPF, RG, passaporte), endereço completo nem dados bancários. Não há caso de uso que justifique.
4. **Tudo fora do repositório.** Dados vivem na pasta de dados do SO (ver 03-arquitetura §Armazenamento).

---

## A. Usuário base (compartilhado por todos os perfis)

### A1 · Identidade e contato
| Campo | Obrigatório | Observação |
|-------|-------------|------------|
| nome completo / nome de exibição | sim | |
| pronomes | não | aparece em documentos se o usuário quiser |
| e-mail de contato | sim | o que vai no CV |
| telefone | **sim** | país (código, ex. +55), DDD e número, armazenado em E.164 e validado com `libphonenumber-js`; exibido no formato do mercado-alvo. No banco as colunas de contato são nullable (a identidade do CV chega antes do telefone); a obrigatoriedade vale na fronteira, pelo `UserSchema` (F01-33) |
| cidade, estado, país, fuso | sim (cidade/país) | |
| disponibilidade para remoto / híbrido / presencial | sim | |
| disponibilidade para relocação / países | **sim** | pode ser "não" |
| situação de trabalho (cidadania, vistos, autorização por país) | **sim** | relevante para mercado exterior; "só Brasil" é resposta válida |
| links: LinkedIn, GitHub, site, portfólio, outros | não | |

### A2 · Idiomas
`idioma`, `nível` (A1–C2 ou básico/intermediário/fluente/nativo), `certificação` (opcional).

### A3 · Formação e certificações
Formação: instituição, curso, grau, início/fim, status, destaques.
Certificação: nome, emissor, data, validade, credencial/URL.

### A4 · Experiências profissionais
| Campo | Observação |
|-------|------------|
| empresa, setor, porte | porte ajuda o recrutador a calibrar |
| cargo / título | |
| tipo de vínculo | CLT, PJ, freela, estágio, voluntário |
| início, fim (ou atual) | lacunas de datas são detectadas e perguntadas |
| local / remoto | |
| descrição curta | |
| **conquistas** (lista) | cada uma com métrica quando houver: "reduziu X em Y%" |
| tecnologias / ferramentas / metodologias | referenciam skills |
| equipe (tamanho, liderança?) | |

### A5 · Projetos
Pessoais, open source ou profissionais destacáveis: nome, URL/repositório, papel, período, descrição, impacto (estrelas, usuários, resultado), tecnologias, `origem` (GitHub ingestão, CV, manual).

### A6 · Skills
| Campo | Observação |
|-------|------------|
| nome (normalizado) | "ReactJS" → "React" |
| categoria | linguagem, framework, infra, gestão, soft skill, domínio |
| nível autoavaliado | 1–5 |
| anos de uso, último uso | calculados a partir das experiências quando possível |
| **evidências** | referências a experiências/projetos/repos que comprovam |

### A7 · Produção
Publicações, palestras, cursos ministrados, prêmios: título, veículo/evento, data, URL.

### A8 · Preferências e restrições de carreira (obrigatórias)
| Campo | Obrigatório | Observação |
|-------|-------------|------------|
| faixa salarial pretendida (mín–máx, moeda, periodicidade) | sim | por perfil; se o usuário não souber, grava provisório marcado `needs_research` e o recrutador pesquisa referências em fontes confiáveis. Para usuário no Brasil, o **salário mínimo necessário do DIEESE** é referência de piso: valor abaixo gera alerta informativo com mês e fonte; o usuário decide sozinho, o sistema só mostra dados |
| tipos de contrato aceitos (CLT, PJ, freela, estágio...) | sim | |
| localidades aceitas (cidades/países) + remoto/híbrido/presencial | sim | |
| data de disponibilidade | sim | "imediata" é válido |
| tamanho de empresa preferido, setores evitados | não | |
Decisão de 2026-10-06: sem esses dados o recrutador não consegue qualificar vagas nem negociar; por isso são obrigatórios. Toda sugestão vinda de pesquisa guarda a fonte (URL, data).

Desde a F03: projetos ganham `repo_id` quando vêm do GitHub; o repositório em si fica em `repo` (nome, URL, descrição, linguagens, tópicos, estrelas, fork/arquivado/privado, último push, commit atual, relevância, última análise), com `repo_analysis` (tipo full/incremental/aprofundar/cobrir, commit base e analisado, relatório, mapa de cobertura, uso), `repo_digest` (mesmo formato do digest de arquivo, tabela irmã, F03-11) e `github_metric` (global, por ano e por repositório: commits, PRs abertos/mergeados/fechados sem merge, revisões aprovadas, issues abertas/resolvidas, open source próprios, contribuições em terceiros).

### A9 · Evidências brutas e registro de contexto por arquivo
Arquivos enviados (CV original, exports), snapshots de ingestão (README, metadados de repos) e trechos citáveis. Guardados para rastreabilidade e re-ingestão sem baixar de novo.

Todo arquivo ingerido ganha um **registro de contexto** (`file_digest`), gerado na extração e editável pelo usuário:

| Campo | Conteúdo |
|-------|----------|
| resumo | 200–400 tokens em prosa: o que é o documento, de quem, de quando |
| pontos principais | lista: cargos e empresas com períodos, formação, tecnologias, idiomas, links, conquistas com métrica |
| índice de seções | nome da seção + posição no texto extraído |
| metadados | tipo, páginas, idioma detectado, data do documento, hash |
| texto extraído | arquivo ao lado, consultável por trecho |

Desde a F03: `ingestion_run` reconstruída (fonte cv/text/github, modo, profundidade, modelo, orçamento, relatório da execução, execução pai; estados `awaiting_confirmation`, `awaiting_decision`, `paused` e demais); `ingestion_proposal` com `match` (novo/existente/conflito), alvo, conflito campo a campo e resolução, trecho de evidência, selo de verificação e perfis sugeridos; `snapshot` (fonte, escopo, caminho, sha256, tamanho, uso) para reexecutar sem rede; `notification` (pendências do usuário). Execuções anteriores do mesmo arquivo ou texto são encontradas pelo hash ("já lido").

Finalidade: o agente e as features leem o registro em vez de abrir o arquivo; o PDF só é reaberto se o usuário pedir ou se a extração for refeita.

---

## B. Perfil (lente)

| Campo | Exemplo |
|-------|---------|
| nome do perfil | "Eng. de Software Sênior (backend)" |
| cargo-alvo, títulos alternativos | "Senior Backend Engineer", "Staff Engineer" |
| senioridade-alvo | júnior / pleno / sênior / staff / gerente / diretor |
| área / indústria | software, fintech, saúde... |
| objetivo | novo emprego, mudança de área, freela, promoção interna |
| mercado-alvo e idioma dos documentos | Brasil/pt-BR, EUA/en-US, Europa/en... |
| ênfases | experiências/projetos/skills/formação/idiomas a destacar, ocultar ou reordenar (`profile_emphasis`: `fact_kind`, `fact_id`, `mode` highlight/normal/hidden, `position`; por conquista em F05) |
| narrativa ("pitch") | 3–5 linhas que o recrutador refina com o usuário |
| configuração do recrutador | persona derivada (especialidade, nível-alvo, mercado, idioma) + enums com padrão: tom direto/cordial, honestidade máxima/diplomática, rigor alto/médio, senioridade do recrutador sênior/pleno; overrides em `profile.persona_overrides_json` (F02-7) |
| metas para este perfil | salário, empresas-alvo, prazo |
| **cartão do perfil** (derivado, cacheado) | resumo de ~300 tokens (teto 1.600 chars) com resumo objetivo heurístico; `profile.card_json = {text, tokensEst, hash, factsVersion, builtAt}`, `card_facts_version`, `card_updated_at`; inválido quando a versão dos fatos avança ou um hook anula a data; reconstruído na leitura ou pelo botão (F02-1/F02-2) |
| relevância por fato (derivada) | `profile_fact_relevance` (`profile_id`, `fact_kind`, `fact_id`, `score` 0–1, `reasons_json`, `computed_at`), gravada junto com o cartão; ordena o cartão e a busca de F04 |
| sugestões de perfil | `profile_suggestion` (`source` heuristic/model, `model`, `payload_json` com título, senioridade, área, mercado, justificativa e fatos de apoio, `status` new/accepted/dismissed) |
| arquivamento e clonagem | `profile.archived_at`, `profile.cloned_from`; perfil ativo em `profile.is_active` |
| projetos (F02-9) | tabela `project` criada vazia em `0002` (`name`, `description`, `url`, `role`, datas, `tech_json`, origem/confiança/verificação como os demais fatos); preenchida por F03 |

---

## C. Dados de features

| Entidade | Campos principais |
|----------|-------------------|
| Candidatura | perfil, empresa, cargo, URL/descrição da vaga, origem, status, datas de cada etapa (UTC), contatos, notas, documentos gerados |
| Evento de calendário | candidatura, etapa (entrevista, prova, retorno), data/hora, fuso, link da chamada, `google_event_id` quando sincronizado, ou `.ics` gerado |
| Documento gerado | tipo (CV, carta, mensagem), perfil, candidatura (opcional), versão, conteúdo Markdown, parâmetros usados, tokens gastos |
| Análise de vaga | candidatura, fit, lacunas, palavras-chave, perguntas prováveis |
| Sessão de entrevista | candidatura, tipo, modo (voz/texto), turnos (pergunta, resposta transcrita, feedback), duração, tokens, resumo final. **Áudio não é armazenado**, só a transcrição |
| Sessão de chat | perfil, mensagens, tools chamadas, uso de tokens |

---

## C2. Entidades de operação
| Entidade | Campos principais |
|----------|-------------------|
| Job | tipo (ingestão, clarificação, geração de CV...), perfil, estado (fila/rodando/concluído/erro/cancelado), progresso, payload, resultado, erro, timestamps; sobrevive a reinício |
| Sessão de chat | perfil, **categoria** (carreira, clarificação, feature X, entrevista), título, `provider_session_id`, estado (ativa/arquivada), tokens acumulados |
| Evento de uso | sessão, categoria, modelo, tokens in/out/cache, custo estimado, origem (log do Claude Code / log próprio), timestamp UTC |
| Template de CV | nome, origem (padrão/usuário), formato, arquivo, prévia, variáveis exigidas, validação |
| Fonte de pesquisa | URL, título, data de acesso, trecho, usado em (campo/fato) — rastreia o que o recrutador buscou na internet |
| Referência salarial | país, fonte (DIEESE), indicador (salário mínimo necessário), valor, moeda, período, mês de referência, URL, data de coleta, corrente? — semeada na instalação, atualizada pelo recrutador (F04) ou em Configurações (F10) |

## D. Modelo de fato (comum a A4–A7)

```
fato
├─ id, tipo, campos...
├─ fonte: { tipo: cv|texto|github|linkedin|chat|clarificacao|pesquisa|manual, ref: arquivo/repo/mensagem/URL, data }
├─ confiança: 0–1 (extraído pelo modelo) | 1 (manual)
├─ verificado_pelo_usuario: bool
└─ tags_de_perfil: [perfil_id...]  (sugeridas na ingestão, editáveis)
```

## D2. Tempo
Todo timestamp é gravado em **UTC** (ISO 8601 ou epoch). A UI converte para o fuso do usuário (`user.timezone`, IANA) com `moment-timezone`; datas sem hora (início/fim de experiência) são gravadas como `YYYY-MM` ou `YYYY-MM-DD` sem fuso.

## E. Dados explicitamente fora do escopo
CPF/RG/passaporte, endereço completo, dados bancários, dados de saúde, histórico salarial detalhado por empresa (apenas a faixa pretendida, se o usuário quiser), credenciais de sites de emprego, gravações de áudio das entrevistas.

## F. Credenciais de integrações
Client ID/secret do Google ficam na configuração do Claude Code dentro do volume `claude-auth` (é ele quem faz o OAuth); credencial do GitHub no volume `gh-auth` (arquivo do `gh` ou token do `gh` do computador em arquivo 0600, renovado pelo lançador), nunca em banco, log, `.env` ou resposta da API. Nenhum deles entra no repositório nem nas exportações.
