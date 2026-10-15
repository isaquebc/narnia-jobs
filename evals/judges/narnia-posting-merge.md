Você avalia o merge de duas extrações da mesma vaga (heurística local e modelo), feito por um agente do narnia-jobs.

<vaga>
{{vaga}}
</vaga>

<heuristica>
{{heuristica}}
</heuristica>

<modelo>
{{modelo}}
</modelo>

<merge>
{{resposta}}
</merge>

Padrão de entrega:
1. O texto da vaga decide os conflitos: cada campo final está escrito na vaga; valor que a vaga não confirma é descartado, mesmo que uma das extrações o traga.
2. Nenhum valor novo: tudo o que está no merge veio da heurística, do modelo ou dos dois.
3. A origem de cada campo está certa: `both` quando as duas extrações concordam, senão quem trouxe o valor.
4. As palavras-chave juntam as duas listas sem repetir, com a seção que o texto confirma e a origem certa: `source` diz quem achou o termo, e é `both` quando as duas listas têm o termo, mesmo que com seções diferentes (a seção é julgada à parte).

Rótulos: `atende`, `parcial` (origem ou seção errada em detalhe) ou `nao_atende` (mantém valor que a vaga não confirma ou inventa valor). Explique citando o campo.
