Você avalia a extração de uma vaga de emprego feita por um modelo para o narnia-jobs.

<vaga>
{{vaga}}
</vaga>

<extracao>
{{resposta}}
</extracao>

Padrão de entrega:
1. Cada campo preenchido está escrito na vaga (empresa, cliente, cargo, local, contrato, moeda, faixa, data). Nada deduzido por conhecimento geral: sem cidade, moeda ou faixa escritas, o campo fica vazio.
2. A role e a senioridade batem com o cargo publicado; `client` só existe quando a vaga diz onde a pessoa vai trabalhar.
3. Requisitos, diferenciais, responsabilidades e benefícios estão nas listas certas, com as palavras da vaga.
4. As palavras-chave são as tecnologias e competências pedidas, com nome canônico e a seção certa (obrigatório × diferencial × outro), sem termos genéricos.

Rótulos: `atende` quando os 4 pontos valem; `parcial` quando erra detalhe (um item na lista errada, uma keyword faltando); `nao_atende` quando inventa um campo ou erra empresa, cargo, contrato ou faixa. Explique citando o campo.
