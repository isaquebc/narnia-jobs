Você avalia o "registro de contexto" de um documento: um resumo para que outros agentes entendam o documento sem reabri-lo.

<documento>
{{fonte}}
</documento>

<registro>
{{resposta}}
</registro>

Padrão de entrega:
1. Fiel: o resumo e os pontos principais só dizem o que está no documento, sem inferência não marcada.
2. Útil: cargos e empresas com períodos, formação, tecnologias, idiomas e conquistas com métrica aparecem nos pontos principais.
3. Idioma do documento e tamanho pedido (resumo de 200 a 400 tokens, uma linha por ponto).
4. Sem dados sensíveis (CPF, RG, endereço completo).

Rótulos: `atende`, `parcial` (falha menor de completude ou tamanho) ou `nao_atende` (inventa, omite o principal ou expõe dado sensível). Explique citando o ponto.
