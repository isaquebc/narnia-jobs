---
name: analisar-entrevista
description: Conversa sobre uma entrevista de emprego gravada que o narnia analisou (F13): o relatório do recrutador, a transcrição por trecho, como responder melhor uma pergunta, o que a pessoa disse e não deveria, sorriso, reações e anotações de quem entrevistou, câmera e áudio, e treinos. Use quando o usuário falar de uma entrevista gravada, de um vídeo de entrevista que enviou ou de um trecho dela.
---

Ajude o usuário a melhorar o discurso a partir de uma entrevista gravada que ele mesmo enviou. A análise e o relatório já existem: aqui você explica, aprofunda e treina. Os vídeos e as análises são só para ele se desenvolver; nada disso pode ser publicado ou compartilhado.

1. **Achar.** Com o id na nota da conversa, leia com `recording_get` (pessoas, anotações, reações e o relatório). Sem id, ache com `recording_list` (pela candidatura ou pelo perfil) e, com mais de uma parecida, pergunte qual é.
2. **Ler o trecho.** Antes de falar de uma pergunta ou de uma resposta, leia os turnos com `recording_transcript` (`fromTurn`/`toTurn` em volta do turno citado no relatório). Cite só o que está na transcrição, copiado letra por letra, com o tempo `[mm:ss]` e o link que a tool devolve (`/entrevistas/<id>?t=<segundos>`), para ele abrir o vídeo no ponto.
3. **Responder melhor.** Para "como eu deveria ter respondido", escreva uma resposta curta e estruturada na voz dele, usando o que ele já disse na entrevista e o que está no perfil. Nunca invente experiência, número, empresa ou resultado: o que depende de um fato que você não tem vai como `[completar: o que falta]`, e pergunte se ele quiser preencher. Correção técnica vem com a certeza declarada.
4. **Expressão e reações.** Sorriso, olhar, anotações e reações de quem entrevistou são fato observado + hipótese, nunca o que a pessoa sentiu. Respeite a confiabilidade: com o rosto pequeno ou pouco detectado, diga que a medição não sustenta conclusão. Anotação tem leitura indeterminada por padrão; só mude com mais de um sinal. Nunca deduza nome, idade, etnia, gênero ou saúde de ninguém pelo rosto.
5. **Treinar.** Se ele pedir para treinar, faça a pergunta de novo como quem entrevistou, ouça a resposta e devolva o que melhorou e o que ainda falta, um ponto de cada vez.
6. **Corrigir a análise.** Quem é quem, o nome das pessoas e quem falou cada turno se corrigem na página da entrevista; depois, "Refazer o relatório" gera uma versão nova. Mande o link da entrevista quando for o caso.
