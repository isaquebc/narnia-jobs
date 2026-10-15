/**
 * Dicionário curado de termos de vaga (F06-1): termo canônico, sinônimos (pt-BR e en-US) e categoria. É a base da
 * heurística sem tokens e do casamento com as skills do usuário ("ReactJS" = "React"). Arquivo versionado e fácil de
 * ampliar: termo novo entra aqui; o que não está aqui aparece nos n-gramas da vaga para revisão.
 *
 * Sinônimos são comparados depois de `normalizeTerm` (minúsculas, sem acento). Sinônimo curto e ambíguo (ex.: "go",
 * "r", "c") só casa com a grafia exata da vaga em `caseSensitive`.
 */
export type TermCategory =
  | "language"
  | "framework"
  | "database"
  | "cloud"
  | "devops"
  | "data"
  | "practice"
  | "tool"
  | "spoken_language"
  | "soft_skill";

export interface DictionaryTerm {
  canonical: string;
  aliases: string[];
  category: TermCategory;
  /** Sinônimos que só valem com esta grafia exata (palavras comuns em outro sentido). */
  caseSensitive?: string[];
}

const t = (
  canonical: string,
  category: TermCategory,
  aliases: string[] = [],
  caseSensitive: string[] = [],
): DictionaryTerm => ({ canonical, category, aliases, caseSensitive });

export const DICTIONARY: DictionaryTerm[] = [
  // linguagens
  t("JavaScript", "language", ["javascript", "js", "ecmascript", "es6"]),
  t("TypeScript", "language", ["typescript", "ts"]),
  t("Python", "language", ["python", "python3"]),
  t("Java", "language", ["java", "java 8", "java 11", "java 17", "java 21"]),
  t("Kotlin", "language", ["kotlin"]),
  t("Go", "language", ["golang"], ["Go", "GO"]),
  t("Rust", "language", ["rust"]),
  t("C#", "language", ["c#", "csharp", "c sharp"]),
  t("C++", "language", ["c++", "cpp"]),
  t("C", "language", [], ["C"]),
  t("Ruby", "language", ["ruby"]),
  t("PHP", "language", ["php"]),
  t("Scala", "language", ["scala"]),
  t("Elixir", "language", ["elixir"]),
  t("Swift", "language", ["swift"]),
  t("Objective-C", "language", ["objective-c", "objective c", "objc"]),
  t("Dart", "language", ["dart"]),
  t("R", "language", [], ["R"]),
  t("SQL", "language", ["sql"]),
  t("Bash", "language", ["bash", "shell script", "shell"]),
  t("Clojure", "language", ["clojure"]),
  t("Haskell", "language", ["haskell"]),
  t("Lua", "language", ["lua"]),
  t("Solidity", "language", ["solidity"]),
  t("COBOL", "language", ["cobol"]),
  t("Delphi", "language", ["delphi"]),
  t("VB.NET", "language", ["vb.net", "visual basic"]),
  // frameworks e bibliotecas
  t("React", "framework", ["react", "reactjs", "react.js"]),
  t("React Native", "framework", ["react native", "react-native"]),
  t("Next.js", "framework", ["next.js", "nextjs", "next js"]),
  t("Vue.js", "framework", ["vue", "vuejs", "vue.js"]),
  t("Nuxt", "framework", ["nuxt", "nuxt.js", "nuxtjs"]),
  t("Angular", "framework", ["angular", "angularjs", "angular.js"]),
  t("Svelte", "framework", ["svelte", "sveltekit"]),
  t("Node.js", "framework", ["node", "nodejs", "node.js"]),
  t("Express", "framework", ["express.js", "expressjs"]),
  t("NestJS", "framework", ["nestjs", "nest.js", "nest js"]),
  t("Fastify", "framework", ["fastify"]),
  t("Hono", "framework", ["hono"]),
  t("Deno", "framework", ["deno"]),
  t("Bun", "framework", ["bun"], ["Bun"]),
  t("Django", "framework", ["django", "django rest framework", "drf"]),
  t("Flask", "framework", ["flask"]),
  t("FastAPI", "framework", ["fastapi", "fast api"]),
  t("Spring", "framework", ["spring", "spring boot", "springboot", "spring framework"]),
  t("Quarkus", "framework", ["quarkus"]),
  t("Micronaut", "framework", ["micronaut"]),
  t(".NET", "framework", [".net", "dotnet", ".net core", "asp.net", "asp.net core"]),
  t("Ruby on Rails", "framework", ["rails", "ruby on rails", "ror"]),
  t("Laravel", "framework", ["laravel"]),
  t("Symfony", "framework", ["symfony"]),
  t("Phoenix", "framework", ["phoenix framework"]),
  t("Flutter", "framework", ["flutter"]),
  t("SwiftUI", "framework", ["swiftui"]),
  t("Jetpack Compose", "framework", ["jetpack compose"]),
  t("Android", "framework", ["android", "android sdk"]),
  t("iOS", "framework", ["ios"]),
  t("Redux", "framework", ["redux", "redux toolkit"]),
  t("GraphQL", "framework", ["graphql", "apollo"]),
  t("gRPC", "framework", ["grpc", "protobuf", "protocol buffers"]),
  t("REST", "practice", ["restful", "api rest", "apis rest", "rest api", "rest apis", "rest/json"]),
  t("Tailwind CSS", "framework", ["tailwind", "tailwindcss", "tailwind css"]),
  t("HTML", "language", ["html", "html5"]),
  t("CSS", "language", ["css", "css3", "sass", "scss"]),
  t("jQuery", "framework", ["jquery"]),
  t("Pandas", "data", ["pandas"]),
  t("NumPy", "data", ["numpy"]),
  t("scikit-learn", "data", ["scikit-learn", "sklearn", "scikit learn"]),
  t("TensorFlow", "data", ["tensorflow"]),
  t("PyTorch", "data", ["pytorch", "torch"]),
  t("LangChain", "data", ["langchain"]),
  t("Hibernate", "framework", ["hibernate", "jpa"]),
  // bancos e armazenamento
  t("PostgreSQL", "database", ["postgresql", "postgres", "psql"]),
  t("MySQL", "database", ["mysql", "mariadb"]),
  t("SQL Server", "database", ["sql server", "mssql", "microsoft sql server"]),
  t("Oracle", "database", ["oracle", "oracle database", "pl/sql", "plsql"]),
  t("SQLite", "database", ["sqlite"]),
  t("MongoDB", "database", ["mongodb", "mongo"]),
  t("Redis", "database", ["redis"]),
  t("Cassandra", "database", ["cassandra"]),
  t("DynamoDB", "database", ["dynamodb", "dynamo db"]),
  t("Elasticsearch", "database", ["elasticsearch", "elastic search", "opensearch", "elk"]),
  t("Neo4j", "database", ["neo4j"]),
  t("Firebase", "database", ["firebase", "firestore"]),
  t("Supabase", "database", ["supabase"]),
  t("ClickHouse", "database", ["clickhouse"]),
  t("Snowflake", "data", ["snowflake"]),
  t("BigQuery", "data", ["bigquery", "big query"]),
  t("Redshift", "data", ["redshift"]),
  t("Databricks", "data", ["databricks"]),
  // mensageria e dados
  t("Kafka", "data", ["kafka", "apache kafka"]),
  t("RabbitMQ", "data", ["rabbitmq", "rabbit mq", "amqp"]),
  t("SQS", "cloud", ["sqs", "amazon sqs", "aws sqs"]),
  t("Spark", "data", ["spark", "apache spark", "pyspark"]),
  t("Airflow", "data", ["airflow", "apache airflow"]),
  t("dbt", "data", ["dbt"]),
  t("Hadoop", "data", ["hadoop", "hdfs", "hive"]),
  t("Flink", "data", ["flink", "apache flink"]),
  t("ETL", "data", ["etl", "elt", "pipelines de dados", "data pipelines", "data pipeline"]),
  t("Power BI", "data", ["power bi", "powerbi"]),
  t("Tableau", "data", ["tableau"]),
  t("Looker", "data", ["looker"]),
  t("Machine Learning", "data", ["machine learning", "aprendizado de máquina", "ml"]),
  t("Deep Learning", "data", ["deep learning"]),
  t("LLM", "data", [
    "llm",
    "llms",
    "large language models",
    "ia generativa",
    "generative ai",
    "genai",
  ]),
  t("NLP", "data", ["nlp", "processamento de linguagem natural", "natural language processing"]),
  t("Estatística", "data", ["estatística", "estatistica", "statistics"]),
  // nuvem
  t("AWS", "cloud", ["aws", "amazon web services"]),
  t("Azure", "cloud", ["azure", "microsoft azure"]),
  t("GCP", "cloud", ["gcp", "google cloud", "google cloud platform"]),
  t("Lambda", "cloud", ["lambda", "aws lambda", "serverless"]),
  t("EC2", "cloud", ["ec2"]),
  t("S3", "cloud", ["s3", "amazon s3"]),
  t("ECS", "cloud", ["ecs", "fargate"]),
  t("Cloudflare", "cloud", ["cloudflare", "cloudflare workers"]),
  t("Vercel", "cloud", ["vercel"]),
  t("Heroku", "cloud", ["heroku"]),
  // devops e infraestrutura
  t("Docker", "devops", ["docker", "containers", "contêineres", "conteineres"]),
  t("Kubernetes", "devops", ["kubernetes", "k8s", "eks", "gke", "aks"]),
  t("Helm", "devops", ["helm"]),
  t("Terraform", "devops", [
    "terraform",
    "iac",
    "infraestrutura como código",
    "infrastructure as code",
  ]),
  t("Ansible", "devops", ["ansible"]),
  t("Pulumi", "devops", ["pulumi"]),
  t("CI/CD", "devops", [
    "ci/cd",
    "ci cd",
    "cicd",
    "integração contínua",
    "continuous integration",
    "entrega contínua",
    "continuous delivery",
  ]),
  t("GitHub Actions", "devops", ["github actions"]),
  t("GitLab CI", "devops", ["gitlab ci", "gitlab"]),
  t("Jenkins", "devops", ["jenkins"]),
  t("ArgoCD", "devops", ["argocd", "argo cd"]),
  t("Linux", "devops", ["linux", "unix"]),
  t("Nginx", "devops", ["nginx"]),
  t("Prometheus", "devops", ["prometheus"]),
  t("Grafana", "devops", ["grafana"]),
  t("Datadog", "devops", ["datadog"]),
  t("New Relic", "devops", ["new relic", "newrelic"]),
  t("OpenTelemetry", "devops", ["opentelemetry", "otel"]),
  t("Observabilidade", "practice", [
    "observabilidade",
    "observability",
    "monitoramento",
    "monitoring",
  ]),
  t("SRE", "practice", ["sre", "site reliability"]),
  // práticas
  t("Microsserviços", "practice", [
    "microsserviços",
    "microsservicos",
    "microservices",
    "micro serviços",
    "microserviços",
  ]),
  t("Mensageria", "practice", [
    "mensageria",
    "messaging",
    "event-driven",
    "event driven",
    "orientada a eventos",
    "eventos assíncronos",
  ]),
  t("Arquitetura de software", "practice", [
    "arquitetura de software",
    "software architecture",
    "system design",
    "design de sistemas",
  ]),
  t("DDD", "practice", ["ddd", "domain-driven design", "domain driven design"]),
  t("Clean Architecture", "practice", [
    "clean architecture",
    "arquitetura limpa",
    "arquitetura hexagonal",
    "hexagonal architecture",
  ]),
  t("SOLID", "practice", ["solid"], ["SOLID"]),
  t("TDD", "practice", ["tdd", "test-driven development", "desenvolvimento orientado a testes"]),
  t("BDD", "practice", ["bdd"]),
  t("Testes automatizados", "practice", [
    "testes automatizados",
    "automated tests",
    "automated testing",
    "testes unitários",
    "unit tests",
    "unit testing",
    "testes de integração",
    "integration tests",
  ]),
  t("Jest", "tool", ["jest"]),
  t("Vitest", "tool", ["vitest"]),
  t("Cypress", "tool", ["cypress"]),
  t("Playwright", "tool", ["playwright"]),
  t("Selenium", "tool", ["selenium"]),
  t("JUnit", "tool", ["junit"]),
  t("Pytest", "tool", ["pytest"]),
  t("Code review", "practice", ["code review", "revisão de código"]),
  t("Scrum", "practice", ["scrum"]),
  t("Kanban", "practice", ["kanban"]),
  t("Agile", "practice", ["agile", "ágil", "metodologias ágeis", "agile methodologies"]),
  t("Git", "tool", ["git", "github", "bitbucket"]),
  t("Jira", "tool", ["jira"]),
  t("Figma", "tool", ["figma"]),
  t("Segurança da informação", "practice", [
    "segurança da informação",
    "information security",
    "appsec",
    "owasp",
    "lgpd",
    "gdpr",
  ]),
  t("OAuth", "practice", ["oauth", "oauth2", "openid connect", "oidc", "jwt"]),
  t("Performance", "practice", [
    "otimização de performance",
    "performance tuning",
    "escalabilidade",
    "scalability",
    "alta disponibilidade",
    "high availability",
  ]),
  t("Cache", "practice", ["cache", "caching"]),
  t("Pagamentos", "practice", ["pagamentos", "payments", "meios de pagamento", "pix"]),
  t("Liderança técnica", "soft_skill", [
    "liderança técnica",
    "technical leadership",
    "tech leadership",
    "mentoria",
    "mentoring",
    "mentorship",
  ]),
  t("Gestão de pessoas", "soft_skill", [
    "gestão de pessoas",
    "people management",
    "gestão de times",
    "team management",
    "liderança de equipe",
    "liderar times",
  ]),
  t("Comunicação", "soft_skill", ["comunicação", "communication skills", "boa comunicação"]),
  t("Product discovery", "practice", ["product discovery", "discovery", "descoberta de produto"]),
  t("OKR", "practice", ["okr", "okrs"]),
  // idiomas
  t("Inglês", "spoken_language", [
    "inglês",
    "ingles",
    "english",
    "fluent english",
    "inglês fluente",
    "inglês avançado",
    "advanced english",
  ]),
  t("Espanhol", "spoken_language", ["espanhol", "spanish", "español"]),
  t("Português", "spoken_language", ["português", "portugues", "portuguese"]),
  t("Alemão", "spoken_language", ["alemão", "alemao", "german"]),
  t("Francês", "spoken_language", ["francês", "frances", "french"]),
];

/** Minúsculas, sem acento e com espaços simples; mantém `+ # . /` (C++, C#, Node.js, CI/CD). */
export function normalizeTerm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./ -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let aliasIndex: Map<string, DictionaryTerm> | null = null;

/**
 * Sinônimo normalizado → termo (inclui o próprio canônico). O canônico de grafia exata (Go, C, R) fica fora do índice:
 * "go" e "r" são palavras comuns; esses termos casam pela grafia exata na vaga ou por um sinônimo inequívoco (golang).
 */
export function dictionaryIndex(): Map<string, DictionaryTerm> {
  if (aliasIndex) return aliasIndex;
  const m = new Map<string, DictionaryTerm>();
  for (const term of DICTIONARY) {
    const exactOnly = term.caseSensitive?.includes(term.canonical) ?? false;
    const keys = [...(exactOnly ? [] : [term.canonical]), ...term.aliases].map(normalizeTerm);
    for (const key of keys) if (key && !m.has(key)) m.set(key, term);
  }
  aliasIndex = m;
  return m;
}

/** Termo canônico de um nome qualquer (skill do usuário, tecnologia de experiência), ou null. */
export function canonicalTerm(name: string): DictionaryTerm | null {
  const key = normalizeTerm(name);
  const hit = dictionaryIndex().get(key);
  if (hit) return hit;
  for (const term of DICTIONARY)
    if (term.caseSensitive?.includes(name.trim()) || term.canonical === name.trim()) return term;
  return null;
}
