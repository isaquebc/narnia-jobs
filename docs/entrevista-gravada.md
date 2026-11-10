# Análise de entrevista gravada

> **Regra de uso.** A análise existe só para você se desenvolver durante o processo seletivo. Nenhum vídeo, dado ou
> leitura pode ser publicado ou compartilhado. Cabe a quem usa respeitar a lei e as regras sobre a gravação e o
> consentimento de quem aparece nela.

Você envia o vídeo de uma entrevista real (Teams, Meet, Zoom) e o recrutador do narnia devolve:

- a **transcrição** por pessoa, clicável (cada fala leva o vídeo ao ponto);
- o **veredito** e o que você falou e não deveria, com o trecho e o minuto;
- as **respostas erradas ou incompletas**, com a correção técnica (e a certeza dela) e uma sugestão de resposta que
  nunca inventa experiência: o que depende de um fato seu vem como `[completar: …]`;
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
de rosto perde você boa parte do tempo e o sorriso não pode ser medido.

## A página da entrevista

- **Quem é quem:** o nome vem da etiqueta da chamada (OCR), nunca do rosto. Confirme quem é você (o narnia sugere pelo
  seu nome ou por quem mais fala) e corrija nomes.
- **Transcrição:** cada turno tem a pessoa; corrija quem falou quando a separação errar.
- **Refazer o relatório:** depois de corrigir, gera uma versão nova do relatório, sem rodar o vídeo de novo.
- **Apagar:** só o vídeo (a análise fica, sem reprodução nem refazer a parte visual) ou a entrevista inteira.

## O que sai do seu computador

Tudo roda localmente: transcrição, vozes, rostos e quadros. Vão ao modelo, na sua assinatura do Claude, só a
transcrição, as medições e até 40 quadros escolhidos (momentos de anotação, reações e uma referência por pessoa).
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
