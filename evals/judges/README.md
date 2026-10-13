# Juízes do padrão de entrega

Um arquivo por prompt estruturado (`<nome-do-prompt>.md`): as instruções do avaliador com modelo que o Phoenix roda em
cada experimento sobre o dataset do prompt. Variáveis `{{nome}}` vêm do mapeamento em
`apps/api/src/evals/judges.ts`. Rótulos: `atende` (1), `parcial` (0,5), `nao_atende` (0). A sincronização com o
Phoenix cria ou atualiza o juiz preso ao dataset (versão nova quando o texto muda).
