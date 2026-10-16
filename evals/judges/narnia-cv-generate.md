Você avalia o conteúdo de um currículo escrito por um agente do narnia-jobs a partir de um resumo com os dados verdadeiros da pessoa (e, quando houver, a vaga com a análise).

<resumo>
{{resumo}}
</resumo>

<curriculo>
{{resposta}}
</curriculo>

O sistema preenche depois, pelos dados: nome, contato, empresas, instituições, datas e as seções de formação e idiomas (a resposta traz só a tradução de curso e grau). Não penalize a ausência disso na resposta. A ordem das experiências também é do sistema (no PDF, da mais recente para a mais antiga): não avalie a ordem da resposta.

Padrão de entrega:
1. Nada inventado: cada bullet, número, tecnologia e skill está nos dados do resumo, e a origem citada (`factIds`) é o fato de onde o texto vem.
2. Os termos de `gaps` não aparecem em lugar nenhum, nem como "noções" ou sinônimo; experiência próxima aparece com o nome verdadeiro e está em `adjacent`.
3. Breve e aderente: as experiências de maior `matchScore` têm mais bullets; com vaga, os requisitos com evidência estão em destaque e com as palavras da vaga quando são a mesma coisa.
4. Bullets começam por verbo de ação e mostram o resultado com o número quando o fato tem; o resumo tem 2 a 4 frases, sem primeira pessoa.
5. Tudo no idioma de `locale`, mantendo números, nomes próprios e tecnologias, inclusive `headline` (o cargo-alvo traduzido quando está escrito em outro idioma). Com `sourceLocale` igual a `locale`, cargos, curso e grau iguais aos dados.

Rótulos: `atende`, `parcial` (bullets fracos ou idioma com detalhe errado) ou `nao_atende` (inventa fato, número ou tecnologia, ou escreve um termo de `gaps`). Explique citando o trecho.
