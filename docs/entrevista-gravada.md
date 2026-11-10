# Análise de entrevista gravada

> **Regra de uso.** A análise existe só para você se desenvolver durante o processo seletivo. Nenhum vídeo, dado ou
> leitura pode ser publicado ou compartilhado. Cabe a quem usa respeitar a lei e as regras sobre a gravação e o
> consentimento de quem aparece nela.

Você envia o vídeo de uma entrevista real (Teams, Meet, Zoom) e o recrutador do narnia devolve:

- a **transcrição** por pessoa, clicável (cada fala leva o vídeo ao ponto), no idioma de cada trecho: a parte da
  entrevista em inglês sai em inglês;
- a **nota da entrevista** (0 a 100), com os pontos de 0 a 10 de cada critério: respostas completas (peso 40),
  objetividade (20), clareza (20) e setup (20, a média de câmera, áudio e ruído do ambiente). O recrutador dá os pontos
  do conteúdo citando os turnos; o código mede o setup. Bom setup e boa luz são requisito: rosto não reconhecido na
  gravação (câmera fechada, longe, escura ou em miniatura) dá 0 na câmera, e voz não reconhecida dá 0 no áudio e no
  ruído, contando na média. Sem nenhuma fala sua identificada, o conteúdo não é avaliado e não há nota geral (corrija
  quem é quem e refaça o relatório);
- o **veredito** e o que você falou e não deveria, com o trecho e o minuto;
- as **respostas erradas ou incompletas**, com a correção técnica (e a certeza dela) e uma sugestão de resposta que
  usa os seus dados de carreira (experiências, conquistas, projetos, skills) e nunca inventa experiência: só o que não
  está nos dados vem como `[completar: …]`;
- o que funcionou, o **discurso** (ritmo, pausas, tempo de resposta, palavras de apoio) e a cordialidade;
- **sorriso e expressão**, sempre como fato observado + hipótese, com um alerta de confiabilidade e a porcentagem do
  tempo em que o seu rosto foi detectável;
- as **reações e anotações** de quem entrevistou (anotação confirmada pela fala ou provável pela imagem), com uma
  leitura que é indeterminada até haver mais de um sinal;
- **câmera, iluminação e áudio** de cada pessoa;
- a **ficha** de cada presente, três **treinos** e as limitações da análise.

Depois, "Conversar sobre a entrevista" abre o chat com o recrutador ("como eu deveria ter respondido aquela pergunta?").

## Ligar

A análise roda num serviço separado (`media`, em Python), desligado por padrão, porque a imagem e os modelos ocupam
cerca de 8 GB. No computador onde o narnia está instalado:

```sh
./start.sh media on          # Windows: .\start.ps1 media on
```

O serviço sobe junto com o app dali em diante. Para desligar: `./start.sh media off` (os modelos ficam guardados;
`--purge` apaga os modelos e o token). Cada vídeo precisa do próprio tamanho mais 2 GB livres na pasta de dados.

### Token do Hugging Face (separação de vozes)

A separação de quem fala quando usa o modelo [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1),
que pede uma conta gratuita no Hugging Face e o aceite dos termos dele:

1. crie uma conta em <https://huggingface.co> (se ainda não tiver);
2. abra a página do modelo e aceite os termos de uso, com a mesma conta;
3. em <https://huggingface.co/settings/tokens>, crie um token do tipo **Read** (só leitura);
4. cole em **Configurações › Análise de vídeo**.

O token fica só no serviço `media` deste computador (arquivo com permissão 0600 num volume do Docker), nunca no banco,
em log, em resposta da API ou no backup. Sem token, a análise separa as vozes de forma aproximada, pelo movimento da
boca, e você corrige quem falou cada turno na página da entrevista.

### GPU (opcional)

Na CPU, uma entrevista de 1 hora leva cerca de 45 minutos (transcrição ~20 min com 16 núcleos, separação de vozes
~16 min, rostos ~2 min). Com uma GPU NVIDIA:

```sh
./start.sh media on --gpu    # Windows: .\start.ps1 media on --gpu
```

Precisa do driver NVIDIA e do `nvidia-container-toolkit` (Linux) ou do suporte a GPU do Docker Desktop (Windows com
WSL2). Usa o override `docker-compose.media-gpu.yml` (torch com CUDA 12.8). **Ainda não testado numa máquina com GPU**;
se der erro, volte para a CPU com `./start.sh media on`.

## Enviar

- **Na candidatura:** página da candidatura › Entrevistas gravadas: escolha a etapa e o vídeo.
- **Avulsa:** Perfis › o perfil › Entrevistas, para uma entrevista sem candidatura (um treino, uma vaga que não está no
  narnia).

O envio vai em partes de 8 MB e continua se você navegar pelo app. Se a aba fechar, a entrevista fica "Envio parado em
X%": escolha o mesmo arquivo e ele continua de onde parou. Limites padrão: 4 GB e 3 horas por vídeo (Configurações ›
Análise de vídeo). Com o serviço ligado, a análise começa sozinha quando o envio termina; o andamento aparece na lista
e na página da entrevista, etapa por etapa, e você pode sair e voltar.

**Dica para as próximas gravações:** fixe a sua câmera ou deixe-a maior. Em miniatura (rosto com ~30 px), o detector
de rosto perde você boa parte do tempo, o sorriso não pode ser medido e a câmera fica com 0 na nota.

## A página da entrevista

- **Quem é quem:** o nome vem da etiqueta da chamada (OCR em faixas ampliadas do quadro, para ler a letra miúda do
  Teams), nunca do rosto. A etiqueta da sua miniatura vale mesmo com uma palavra só ("Ana"). Confirme quem é você (o
  narnia sugere pelo seu nome ou por quem mais fala) e corrija nomes.
- **Transcrição:** cada turno tem a pessoa; corrija quem falou quando a separação errar.
- **Refazer o relatório:** depois de corrigir, gera uma versão nova do relatório, sem rodar o vídeo de novo.
- **Analisar de novo:** roda a análise do vídeo outra vez, aproveitando as etapas que não mudaram. Use quando o vídeo
  foi analisado sem o token: com o token colado, a separação das vozes e o que depende dela são refeitos (a
  transcrição e os rostos, não). Quem é quem e as correções de quem falou voltam ao que a análise encontrar.
- **Apagar:** só o vídeo (a análise fica, sem reprodução nem refazer a parte visual) ou a entrevista inteira.

## O que sai do seu computador

Tudo roda localmente: transcrição, vozes, rostos e quadros. Vão ao modelo, na sua assinatura do Claude, só a
transcrição, as medições, até 40 quadros escolhidos (momentos de anotação, reações e uma referência por pessoa) e os
seus dados de carreira (sem o que você ocultou no perfil e sem remuneração).
Os modelos baixam do Hugging Face no primeiro uso.

## Backup

O vídeo fica em `<dados>/interviews/` e **não entra no backup** (é grande, e você escolhe apagar). Transcrição,
medições, pessoas, relatórios (no banco) e os quadros escolhidos (`<dados>/interview-frames/`) entram no backup e
voltam na restauração.

## Limitações

- O áudio da chamada já chega misturado e comprimido pela plataforma: o volume compara as pessoas, não mede o
  microfone de cada uma.
- Rosto pequeno ou de lado, pouca luz, barba e pele escura podem reduzir a detecção; por isso o alerta de
  confiabilidade e a porcentagem acompanham toda leitura de expressão.
- Expressão nunca é tratada como o que alguém sentiu, e uma reação sozinha não vira conclusão.
- Tela compartilhada e muitas pessoas na chamada atrapalham a ligação entre voz, rosto e nome: corrija na página.

## Créditos e licenças

| Componente | Licença |
|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) e CTranslate2, pesos do Whisper `large-v3` | MIT |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | MIT |
| [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1), de pyannote | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) |
| [librosa](https://librosa.org) | ISC |
| [MediaPipe](https://ai.google.dev/edge/mediapipe) e o modelo Face Landmarker | Apache-2.0 |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) | Apache-2.0 |
| FFmpeg (pacote do Debian, executado como programa) | GPL v2+ |

Nenhum peso de modelo vem no repositório ou na imagem: você constrói a imagem e os modelos baixam no primeiro uso.
