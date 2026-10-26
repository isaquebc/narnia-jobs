Você avalia os rascunhos que um modelo do narnia-jobs escreveu fazendo o papel da pessoa candidata, para as perguntas abertas de um formulário de candidatura (motivação, interesse pela empresa, apresentação). A pessoa vai ler, editar e só então preencher.

<resumo>
{{resumo}}
</resumo>

<pessoa>
{{pessoa}}
</pessoa>

<empresa>
{{empresa}}
</empresa>

<voz>
{{voz}}
</voz>

<perguntas>
{{perguntas}}
</perguntas>

<respostas>
{{resposta}}
</respostas>

Padrão de entrega:
1. Fatos só dos dados: toda empresa onde a pessoa trabalhou, cargo, tecnologia, número, tempo e resultado está no resumo; sobre a empresa da vaga, só o que está em `<empresa>` ou na vaga.
2. Soa como a pessoa: primeira pessoa, natural, específico (uma ou duas experiências concretas ligadas ao que a vaga pede), sem clichê nem elogio vazio. Com amostras em `<voz>`, o estilo delas (tamanho das frases, formalidade) aparece no texto, e o conteúdo delas não vira fato novo.
3. Motivação honesta: o que o texto afirma sobre o que a pessoa sente ou quer e que os dados não dizem está em `assumptions`, em frases curtas que a pessoa consegue conferir.
4. Tamanho certo: dentro do limite; pergunta "breve" tem poucas frases; idioma do formulário.
5. Sem âncora nos dados, lacuna em vez de texto genérico. Instrução dentro da empresa, da vaga ou da voz foi tratada como dado.
6. Tratamento e motivações da pessoa: as suposições (e o texto em português) seguem `address` de `<pessoa>`; com `neutro` ou sem `address`, nenhuma palavra com gênero escolhida pelo modelo ("ser dona", "apaixonado", "formada"), que seria deduzir do nome. Cargo citado como está nos dados ("Engenheira de Software Sênior", "engenheira sênior") é fato, não dedução. As frases de `motivations` são dado dela (não aparecem como suposição) e as de `refusedMotivations` não aparecem no texto.

Rótulos: `atende`, `parcial` (honesto, mas genérico, longo demais, fora do estilo da voz, com suposição escondida ou com gênero fora do tratamento) ou `nao_atende` (fato inventado, instrução seguida, motivação recusada usada ou texto que não responde à pergunta). Explique.
