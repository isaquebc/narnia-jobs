import type { InterviewFramesInput, InterviewReportInput } from "@narnia-jobs/providers";

/**
 * F13/M5 · entrevistas fictícias para o gate dos prompts da entrevista gravada (§6.4: nunca uma gravação real). Mesmo
 * formato que o app monta (`formatTranscript`, `buildInterviewBrief`): `[n] mm:ss–mm:ss Pk (nome, papel): texto`.
 */
type Turn = [person: "P1" | "P2", start: string, end: string, text: string];
const NAMES = { P1: "Marina Duarte", P2: "Alex Souza" } as const;
const ROLE = { P1: "entrevista", P2: "candidato" } as const;
const transcript = (turns: Turn[]) =>
  turns
    .map(([p, a, b, text], i) => `[${i}] ${a}–${b} ${p} (${NAMES[p]}, ${ROLE[p]}): ${text}`)
    .join("\n");

const POSTING = {
  company: "Acme Pagamentos",
  title: "Pessoa Desenvolvedora Backend Sênior",
  description:
    "Backend em Node.js e PostgreSQL para pagamentos. Requisitos: modelagem e índices no PostgreSQL, testes automatizados, revisão de código, trabalho em time com plantão. Diferencial: mensageria.",
};

const voice = (wpm: number, fillers: Record<string, number>, longest: number) => ({
  wpm,
  fillers,
  fillers_per_min: Object.values(fillers).reduce((a, b) => a + b, 0) / 4,
  longest_turn_s: longest,
  long_pauses: 2,
  pitch_spread_semitones: 2.1,
  response_latency_median_s: 1.4,
});

const TECH: Turn[] = [
  [
    "P1",
    "00:40",
    "00:52",
    "Oi Alex, tudo bem? Obrigada por vir. Vamos começar pela sua experiência com bancos de dados.",
  ],
  [
    "P2",
    "00:53",
    "01:20",
    "Tudo ótimo, obrigado pelo convite. Trabalho com PostgreSQL há uns cinco anos, né, principalmente com APIs de pagamento.",
  ],
  [
    "P1",
    "01:22",
    "01:35",
    "Quando você usaria um índice B-tree e quando usaria um índice GIN no PostgreSQL?",
  ],
  [
    "P2",
    "01:37",
    "02:05",
    "Então, tipo assim, o B-tree é melhor para busca de texto livre e o GIN para igualdade simples, né.",
  ],
  ["P1", "02:06", "02:14", "Entendi. Deixa eu anotar isso aqui rapidinho."],
  [
    "P1",
    "02:20",
    "02:31",
    "Me conta de uma situação em que você discordou do time e como resolveu.",
  ],
  [
    "P2",
    "02:33",
    "05:40",
    "Hum, teve uma vez que o time queria microsserviços e eu preferia um monólito modular. Aliás, eu adoro arquitetura, comecei programando jogos no colégio, fiz vários projetos de jogos e aprendi muito com isso, inclusive a parte de física dos jogos e de animação, que é bem diferente de backend.",
  ],
  ["P1", "05:42", "05:47", "E como terminou a discussão sobre o monólito?"],
  [
    "P2",
    "05:48",
    "06:20",
    "A gente fez uma prova de conceito e mediu o tempo de entrega. O monólito ganhou e o time concordou.",
  ],
  ["P1", "06:22", "06:30", "Como você garante a qualidade do código que entrega?"],
  ["P2", "06:31", "06:35", "Basicamente eu testo bastante."],
  ["P1", "06:40", "06:46", "Você tem alguma pergunta para a gente?"],
  [
    "P2",
    "06:48",
    "07:10",
    "Tenho sim: como o time divide o plantão e como medem o sucesso de quem entra agora?",
  ],
  [
    "P1",
    "07:12",
    "07:40",
    "Boa pergunta. O plantão é semanal e o primeiro trimestre tem metas combinadas com a liderança.",
  ],
];

const TECH_BRIEF = {
  locale: "pt-BR",
  interview: {
    title: "Entrevista técnica",
    stage: "Técnica",
    duration: "07:55",
    meetingStart: "00:38",
    language: "pt",
    voicesApproximate: false,
  },
  posting: POSTING,
  cvSent:
    "Alex Souza · Desenvolvedor Backend · 6 anos com Node.js e PostgreSQL em pagamentos (Globex), APIs REST, testes de integração.",
  profile: { targetTitle: "Desenvolvedor Backend", seniority: "senior", area: "engenharia" },
  persons: [
    {
      key: "P1",
      name: NAMES.P1,
      role: "entrevista",
      talkShare: 0.32,
      voice: voice(158, {}, 28),
      face: {
        reliability: { detected_pct: 98.9, face_px: 393, level: "good" },
        smile_ratio: 0.22,
        gaze_down_ratio: 0.08,
        camera: { face_px: 393, flags: ["backlit"] },
      },
    },
    {
      key: "P2",
      name: NAMES.P2,
      role: "candidato",
      talkShare: 0.68,
      voice: voice(171, { né: 3, "tipo assim": 1, hum: 1, basicamente: 1 }, 187),
      face: {
        reliability: { detected_pct: 47.5, face_px: 32, level: "poor" },
        smile_ratio: 0.01,
        gaze_down_ratio: 0.1,
        camera: { face_px: 32, flags: ["small_face"] },
      },
    },
  ],
  events: [
    {
      key: "e1",
      type: "note",
      level: "probable",
      person: "P1",
      at: "01:40",
      durationS: 6,
      cue: "head_down",
      turn: 3,
    },
    {
      key: "e2",
      type: "note",
      level: "confirmed",
      person: "P1",
      at: "02:06",
      durationS: 8,
      cue: "speech",
      turn: 4,
    },
    {
      key: "e3",
      type: "frown",
      level: null,
      person: "P1",
      at: "06:36",
      durationS: 3,
      cue: null,
      turn: 10,
    },
  ],
  frames: [
    {
      file: "f01.jpg",
      at: "01:40",
      person: "P1",
      events: ["e1"],
      observed: "Cabeça baixa, olhar para a mesa, mão direita perto do teclado.",
      hypothesis: "Pode estar anotando.",
    },
    {
      file: "f02.jpg",
      at: "06:37",
      person: "P1",
      events: ["e3"],
      observed: "Sobrancelhas aproximadas, boca fechada, olhar na tela.",
      hypothesis: "Pode estar esperando mais detalhes.",
    },
  ],
  previousInterviews: [
    {
      title: "Conversa com RH",
      stage: "RH",
      date: "2026-10-28",
      verdict: { level: "strong", summary: "Boa conversa, respostas objetivas." },
      drills: ["Pergunta de volta no fim"],
    },
  ],
};

const GOOD: Turn[] = [
  [
    "P1",
    "00:30",
    "00:40",
    "Oi Alex, vamos falar de mensageria. Como você garante que uma mensagem de pagamento não é processada duas vezes?",
  ],
  [
    "P2",
    "00:42",
    "01:30",
    "Uso uma chave de idempotência por pagamento, gravada numa tabela com restrição de unicidade na mesma transação do efeito. Se a mensagem chegar de novo, a inserção falha e eu só confirmo o recebimento. Na Globex isso zerou cobranças duplicadas depois de um incidente com reentrega.",
  ],
  ["P1", "01:32", "01:40", "Ótimo. E se o consumidor cair no meio do processamento?"],
  [
    "P2",
    "01:41",
    "02:20",
    "A confirmação só sai depois do commit. Se cair antes, a mensagem volta e a idempotência segura; se cair depois do commit e antes de confirmar, a reentrega bate na chave e é descartada.",
  ],
  ["P1", "02:22", "02:30", "Perfeito, é exatamente o que procuramos."],
];
const GOOD_BRIEF = {
  ...TECH_BRIEF,
  interview: {
    ...TECH_BRIEF.interview,
    title: "Mensageria",
    duration: "02:40",
    meetingStart: "00:28",
  },
  events: [],
  frames: [],
  previousInterviews: [],
};

const NOFACE_BRIEF = {
  ...TECH_BRIEF,
  interview: { ...TECH_BRIEF.interview, voicesApproximate: true },
  persons: TECH_BRIEF.persons.map((p) =>
    p.key === "P2"
      ? {
          ...p,
          face: {
            reliability: null,
            note: "rosto não detectado (miniatura pequena ou câmera fechada)",
          },
        }
      : p,
  ),
  frames: [],
};

/** Dados de carreira fictícios (como `buildCandidateBackground` monta): fatos que respondem o que ficou vago. */
const CAREER_BRIEF = {
  ...TECH_BRIEF,
  candidate: {
    card: "Alex Souza · Desenvolvedor Backend sênior · 6 anos com Node.js e PostgreSQL em pagamentos.",
    experiences: [
      {
        company: "Globex",
        title: "Desenvolvedor Backend Sênior",
        period: "2021-03 – atual",
        summary: "APIs de pagamento e conciliação.",
        tech: ["Node.js", "PostgreSQL", "Kafka", "Testcontainers"],
        achievements: [
          "Criou a busca de lojistas por nome com índice GIN e pg_trgm (de 2 s para 80 ms)",
          "Montou os testes de integração com Testcontainers no CI (cobertura de 85% no serviço de cobrança)",
          "Implantou revisão de código obrigatória com checklist de segurança",
        ],
      },
      {
        company: "Initech",
        title: "Desenvolvedor Backend",
        period: "2019-01 – 2021-02",
        summary: "Integrações bancárias.",
        tech: ["Node.js", "MySQL"],
        achievements: ["Migrou 40 integrações para filas com reprocessamento"],
      },
    ],
    projects: [],
    education: [
      {
        institution: "Universidade Federal",
        course: "Ciência da Computação",
        degree: "bacharelado",
        period: "2014 – 2018",
        status: "completed",
      },
    ],
    skills: ["Node.js", "PostgreSQL", "Kafka", "Testcontainers", "Docker"],
    languages: [{ name: "Inglês", level: "advanced" }],
  },
};

export const INTERVIEW_REPORT_CASES: Array<{
  id: string;
  description: string;
  input: Omit<InterviewReportInput, "model">;
  reference: Record<string, unknown>;
}> = [
  {
    id: "tecnica-resposta-errada",
    description:
      "Índices invertidos (B-tree e GIN), tangente sobre jogos, resposta vaga sobre qualidade, anotação logo depois do erro e miniatura de 32 px: aponta a resposta errada com a correção, a tangente e a vaga; cita literal; uma leitura por anotação.",
    input: { brief: TECH_BRIEF, transcript: transcript(TECH) },
    reference: {
      expected: ['"problem":"wrong"', "GIN", '"event":"e1"', '"event":"e2"', "[completar"],
      scores: { completeness: [0, 6] },
    },
  },
  {
    id: "sem-token-sem-rosto",
    description:
      "Vozes separadas por aproximação e rosto da pessoa candidata não detectado: limitações explícitas e a dica de fixar a câmera.",
    input: { brief: NOFACE_BRIEF, transcript: transcript(TECH) },
    reference: { expected: ["aproximad", "câmera"] },
  },
  {
    id: "boa-entrevista",
    description:
      "Respostas corretas e concretas sobre idempotência: veredito forte, nada de resposta errada inventada.",
    input: { brief: GOOD_BRIEF, transcript: transcript(GOOD) },
    reference: {
      expected: ['"level":"strong"'],
      forbidden: ['"problem":"wrong"'],
      scores: { completeness: [8, 10], objectivity: [7, 10], clarity: [7, 10] },
    },
  },
  {
    id: "usa-dados-de-carreira",
    description:
      "Mesma entrevista técnica, agora com os dados de carreira: a sugestão da resposta vaga sobre qualidade usa os testes com Testcontainers e a cobertura que estão nos dados (sem [completar] para isso), e a correção dos índices lembra que a pessoa já usou GIN com pg_trgm; nota de completude baixa.",
    input: { brief: CAREER_BRIEF, transcript: transcript(TECH) },
    reference: {
      expected: ["Testcontainers", "pg_trgm"],
      scores: { completeness: [0, 6] },
    },
  },
];

export const INTERVIEW_FRAMES_CASES: Array<{
  id: string;
  description: string;
  /** Imagem em `evals/fixtures/interview-frames/` (desenho, nunca pessoa real). */
  image: string;
  input: Omit<InterviewFramesInput, "model" | "dir">;
  reference: Record<string, unknown>;
}> = [
  {
    id: "cabeca-baixa",
    description:
      "Pessoa desenhada de cabeça baixa sobre um bloco de notas com caneta: descreve o que se vê e deixa 'anotando' como hipótese.",
    image: "cabeca-baixa.jpg",
    input: {
      frames: [{ file: "cabeca-baixa.jpg", at: "42:10", person: "P1", reason: "note (probable)" }],
    },
    reference: { expected: ["baix", "anota"] },
  },
  {
    id: "so-miniatura",
    description:
      "Só a miniatura no canto: diz que o rosto da pessoa é pequeno demais para ler expressão.",
    image: "so-miniatura.jpg",
    input: {
      frames: [{ file: "so-miniatura.jpg", at: "42:10", person: "P2", reason: "referência" }],
    },
    reference: { expected: ["pequen"] },
  },
];
