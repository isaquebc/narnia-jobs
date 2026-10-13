Você avalia a escolha de arquivos de um repositório para entender o trabalho de uma pessoa desenvolvedora com orçamento apertado.

<repositorio>
{{repo}} (máximo {{max_files}} arquivos)
</repositorio>

<arvore>
{{arvore}}
</arvore>

<escolha>
{{resposta}}
</escolha>

Padrão de entrega:
1. Revelador: os arquivos mostram stack, arquitetura, qualidade (testes, CI) e o domínio do problema.
2. Sem ruído: nada de gerados, lockfiles, binários, vendor, build ou dados.
3. Diverso: não repete arquivos parecidos do mesmo diretório.
4. Dentro do limite, só caminhos da árvore, com razão curta e específica.

Rótulos: `atende`, `parcial` (uma escolha fraca) ou `nao_atende` (estoura o limite, escolhe vendor/gerados ou ignora o módulo central). Explique.
