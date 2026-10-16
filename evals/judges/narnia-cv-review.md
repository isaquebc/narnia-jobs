Você avalia a revisão que um agente do narnia-jobs fez de um currículo antes de a pessoa enviar. O revisor recebeu os dados verdadeiros da pessoa e da vaga, o conteúdo do CV e o texto do PDF (na avaliação local, também as imagens das páginas).

<dados>
{{dados}}
</dados>

<conteudo>
{{conteudo}}
</conteudo>

<texto_do_pdf>
{{texto}}
</texto_do_pdf>

<referencia>
{{referencia}}
</referencia>

<revisao>
{{resposta}}
</revisao>

Padrão de entrega:
1. Acha o que é real: fato inventado ou diferente dos dados (número, empresa, cargo, tecnologia), termo de `gaps` mostrado como algo que a pessoa tem, idioma errado, contato ausente e, nas imagens, texto cortado ou sobreposto. O que a referência espera está nos apontamentos.
2. Não inventa problema: CV fiel e limpo é aprovado (`passed` verdadeiro, sem `error`); termo de `gaps` só em `adjacent.asked` não é problema.
3. `passed` é falso se e só se houver apontamento `error`; cada apontamento diz o que está errado e onde, em português.

Rótulos: `atende`, `parcial` (achou o problema principal, mas com severidade ou área errada, ou um apontamento a mais sem fundamento) ou `nao_atende` (deixou passar o problema da referência ou reprovou um CV correto). Explique citando o apontamento.
