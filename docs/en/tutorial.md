# narnia-jobs tutorial

*[Versão em português](../tutorial.md)*

From zero to your first application, in ten steps. It takes about 30 minutes, plus the time to extract your résumé.

> **The interface is in Brazilian Portuguese.** Labels are quoted here exactly as they appear on screen, in **bold**, with an English translation in parentheses the first time. Your résumés and cover letters can be generated in English, and the recruiter can answer in English (set the language in the profile's persona, step 3).

1. [Install and open](#1-install-and-open)
2. [First run: your profile from your résumé](#2-first-run-your-profile-from-your-résumé)
3. [Complete your data](#3-complete-your-data)
4. [Talk to the recruiter](#4-talk-to-the-recruiter)
5. [Analyze a job posting](#5-analyze-a-job-posting)
6. [Generate the résumé and cover letter for a posting](#6-generate-the-résumé-and-cover-letter-for-a-posting)
7. [Track your applications](#7-track-your-applications)
8. [The recruiter in Claude Code (mode B)](#8-the-recruiter-in-claude-code-mode-b)
9. [The Chrome extension](#9-the-chrome-extension)
10. [Maintenance: backup, updates and shutting down](#10-maintenance-backup-updates-and-shutting-down)

---

## 1. Install and open

You need **Docker** (Docker Desktop on Windows and macOS; Docker Engine with Compose v2 on Linux) and a **Claude subscription with Claude Code access** (Pro or Max). Read the note on [using your subscription](../../README.en.md#about-using-your-claude-subscription) first.

> **On Windows:** the app has not been tested end to end on Windows yet (the author has no Windows machine). If something fails, please [open an issue](https://github.com/isaquebc/narnia-jobs/issues).

```bash
git clone https://github.com/isaquebc/narnia-jobs.git
cd narnia-jobs
./start.sh up        # Windows: .\start.ps1 up
```

The first `up` builds the images (a few minutes). At the end it prints the address with the access token:

```
  narnia-jobs está no ar:

    http://127.0.0.1:3100/?token=…
```

Now log in to your subscription inside the container, once:

```bash
./start.sh login
```

The Claude CLI prints a URL. Open it, authorize, and paste the code back into the terminal. The login is kept in a Docker volume, refreshes on its own and survives restarts.

Open the address printed by `up` in your browser and keep it: it stays the same after restarts (the token lives in `./data/.token`). To check everything at any time: `./start.sh doctor`.

## 2. First run: your profile from your résumé

The first time you open it, the **Primeiro uso** (first run) wizard appears, in six steps. You can leave halfway; it resumes where you stopped.

1. **Provider.** Shows whether Claude Code is logged in (**Logado pela assinatura (login no container)**, logged in through the subscription). If it says **Não logado** (not logged in), run `./start.sh login` and click **Verificar de novo** (check again).
2. **Currículo** (résumé). In the **Arquivo** (file) tab, drop a PDF, DOCX or Markdown file (up to 10 MB), or tell your story in the **Texto livre** (free text) tab. For PDFs, pick the **Leituras do PDF** (PDF readings): **OCR das páginas** (OCR, for scanned PDFs, free) and **Leitura do documento pelo modelo** (model reading, captures the layout, costs tokens). **Estimativa antes de rodar** (estimate before running) shows the tokens of each call. Click **Extrair** (extract). No résumé? **Não tenho, começar do zero** (start from scratch).
3. **Extração** (extraction). The stages appear one by one (reading, facts, summary). You can browse meanwhile: progress stays in the **Atividades** (activities) tray at the top.
4. **Revisão** (review). Every extracted fact is a proposal quoting the part of the résumé it came from. Accept, edit or reject each one (or **Aceitar todos**, accept all). You also confirm your identity here; the phone number is required.
5. **Perfil** (profile). Create the first profile, which is a target role: target title, level, field, market, salary range, accepted contracts and locations. When you do not know, mark "não sei" (I don't know) and the recruiter researches it later.
6. **Descoberta** (discovery, optional). With **Começar entrevista** (start interview), the recruiter asks only what the extraction could not fill in (dates, metrics, level), and the answers go back to the review. Or **Pular e ir ao dashboard** (skip to the dashboard).

> Nothing is saved to your data without going through the review. That holds for everything that comes later: another résumé, GitHub, what you tell the chat.

## 3. Complete your data

**More profiles.** In **Perfis** (profiles; side menu, or "Gerenciar perfis" in the top selector), create a profile from scratch or clone one. Each profile uses the same facts with a different emphasis:

- **Ênfases** (emphasis): highlight, hide and order experiences, projects, skills, education and languages.
- **Narrativa** (narrative): your pitch.
- **Recrutador** (recruiter): its persona (tone, honesty, rigor, seniority and the language of its answers, for example `en-US`).
- **Cartão** (card): the short summary the recruiter receives about the profile, with the **Atualizar cartão** (refresh card) button.

The top selector switches the active profile, and the dashboard suggests profiles; **Analisar possíveis perfis** (analyze possible profiles) uses the model over your whole history (it shows the estimate first).

**More data.** In **Ingestão** (ingestion):

- **GitHub:** if `gh` on your computer is logged in, narnia-jobs reuses that login; otherwise pick **Login próprio do app** (the app's own login), click **Abrir GitHub** (open GitHub) and paste the code shown. The **public** analysis reads only public repositories; the **private** one includes private ones (read-only). Before running, the screen shows your plan, your usage of the 5-hour and weekly windows, the estimate and a recommended budget; GitHub always asks for confirmation.
- **Currículo** (résumé): another CV (an older one, or in another language). Uploading the same file again tells you it was already read.
- **Texto livre** (free text): tell your story; whatever is new becomes a proposal.

Every ingestion ends in a review. The bell at the top and the **Pendências** (pending items) page gather everything waiting for you: reviews, conflicts, profile suggestions, finished analyses.

## 4. Talk to the recruiter

Menu › **Geral** › **Chat** › **Nova conversa** (new conversation).

The recruiter knows your whole career and every profile. It searches your data through its tools (the chips show which ones it used) and cites the source of what it says. Try:

- "Which of my profiles is strongest today? What is missing for the other one?"
- "How much does a remote senior backend role pay in Brazil?" (it researches and records the sources)
- "I forgot to mention: in 2022 I led the migration from the monolith to microservices." This becomes an ingestion in the right-hand panel, with the review right there.
- "My title at Acme was wrong, it was Staff." It proposes the change, and you confirm it on the card next to the conversation.

The footer shows the conversation's tokens and cost. **Configurações › Chat** (settings) holds the default model, the cost cap per conversation, how many conversations stay open and the list of trusted domains for research.

## 5. Analyze a job posting

Menu › **Geral** › **Vagas** (postings) › **Nova vaga** (new posting). Paste the **Texto da vaga** (posting text) or its link (**ou o link da vaga**) and click **Salvar vaga** (save posting). You can also paste the posting straight into the chat.

- **Right away, no tokens:** a local heuristic extracts title, seniority, location, contract, salary range and requirements, and looks for each keyword in your data.
- **In the background:** a model extracts the posting again and another one merges both versions. Each field shows where it came from, and what you edit is never overwritten.
- **The analysis** runs in its own conversation: fit per profile and the recommended profile, what you meet (each item linked to one of your facts), gaps, risks, missing ATS keywords, likely questions and what to study.

A repeated posting (same company, client, title and role) opens a notice with the differences. If your data or the posting change later, the page tells you and offers **Reanalisar** (reanalyze); nothing is redone on its own.

Sites that require a login or block bots (LinkedIn, for example) ask you to paste the text. For those, the [Chrome extension](#9-the-chrome-extension) solves it.

## 6. Generate the résumé and cover letter for a posting

On the posting page, click **Gerar** (generate) and pick the résumé, the cover letter or both. The profile recommended by the analysis is already selected. You can also ask in the chat: "generate my CV for this posting, with more weight on leadership".

What happens until the PDF arrives (progress shows in the **Atividades** tray and in **Processos**, processes):

1. The model writes only the texts and says which of your facts each line came from. Company, title, dates and links come from your data, and a term you do not have never appears.
2. The PDF is built (up to 2 pages, in the posting's language) and checked: links that respond, font, spacing, page breaks, ATS compatibility of at least 90%.
3. A second model reads the pages looking for invented content, mistakes and visual problems. If it fails, the document is generated once more; if it fails again, it arrives with the **Não passou na revisão** (did not pass review) notice and the reasons.

Each generation or edit is a new version you can download and compare. **Editar** (edit) changes text, order and sections without spending the generator's tokens. **Atualizar** (update) generates again, with optional instructions; **Regerar com mensagem** (regenerate with a message) opens a conversation with the recruiter, who redoes the document and sends the link. Templates (Clássico, Moderno, Compacto and your own) live in **Configurações › Modelos de currículo** (résumé templates); to build yours, see [docs/templates-de-cv.md](../templates-de-cv.md) (Portuguese).

Each profile's general résumé (no posting) lives in **Perfis** › the profile › **Currículo**.

## 7. Track your applications

On the posting page, click **Aplicar** (apply) when you apply. Saving a posting is not applying, so nothing becomes an application on its own.

In **Candidaturas** (applications), the board has the columns **Aplicado** (applied), **1ª Entrevista** (first interview), **Em processo** (in progress), **Oferta** (offer) and **Encerrado** (closed), plus **Vagas salvas** (saved postings). Drag the cards between columns, or open an application to:

- follow the process stages and the calendar: interviews, tests, deadlines and follow-ups, with date, link and notes; **Adicionar ao Google Calendar** (add to Google Calendar) or download the `.ics` file (Google is optional: [docs/google-calendar.md](../google-calendar.md), Portuguese);
- keep notes and attachments;
- record your contacts (recruiter, who referred you) and edit a contact later;
- open a conversation with the recruiter about that application.

Closed ones stay in the **Encerrado** column; archived ones (by you, or with no activity for 40 days) are under **Ver arquivadas** (see archived).

## 8. The recruiter in Claude Code (mode B)

The same recruiter, with the same data and tools, runs inside Claude Code on your computer. With narnia-jobs running (`./start.sh up`):

```bash
./start.sh install-plugin     # Windows, with the up stack running: .\start.ps1 install-plugin --prod
```

This registers the narnia-jobs MCP server in Claude Code and installs the plugin. The token lives in a file only you can read, in `.plugin-build/`, so keep that folder. Restart Claude Code and use:

| Command | Does |
|---------|------|
| `/narnia-jobs:recrutador` | talks to the recruiter |
| `/narnia-jobs:perfil <name>` | switches the active profile and reloads its card |
| `/narnia-jobs:descoberta` | asks only what is missing from the profile |
| `/narnia-jobs:clarificar <run>` | clarifies an ingestion with objective questions |
| `/narnia-jobs:github-publico` | reviews your public GitHub profile |
| `/narnia-jobs:analisar-vaga` | paste a posting: it is saved and analyzed |
| `/narnia-jobs:gerar-cv` | the profile's or the posting's résumé, and the cover letter |
| `/narnia-jobs:candidaturas` | lists, moves and updates applications (stages, notes, contacts) |
| `/narnia-jobs:responder-candidatura` | adjusts the answers of a form opened by the extension |

Large screens (review, full analysis, PDFs) stay in the web interface, and the recruiter hands you the links. **Configurações › Modo plugin (terminal)** shows the MCP address and the last use. Run `install-plugin` again if the port changes or you change the persona.

## 9. The Chrome extension

The extension brings postings from any site into narnia-jobs and helps with application forms, in a side window. It reads the page only after your click and sends the content to your own instance, on your computer.

**Install** (the walkthrough with your instance's addresses is also in **Configurações › Extensão do navegador**, browser extension):

1. Build the extension: `./start.sh extension` (Windows: `.\start.ps1 extension`).
2. At `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `apps/extension/dist` folder.
3. Pin the narnia-jobs icon to the toolbar.
4. **Pair:** in **Configurações › Extensão do navegador**, click **Gerar código de pareamento** (generate pairing code; valid for 10 minutes, once). In the extension options (right-click the icon › Options), enter the instance address and the code.

**Use:** on a posting page, click the icon:

- **Analisar a vaga** (analyze the posting) saves it, shows the fit per profile and generates the résumé and cover letter.
- **Ajudar no formulário** (help with the form) organizes the questions and suggests answers from your data and the posting. You can copy, edit and refine them in the chat, use **Preencher** (fill) to fill the fields on the page, and attach the posting's résumé.

For a multi-step form, move through it and click the icon at each step. The extension never submits the form, and self-identification questions (race, gender, disability) are answered only with what you yourself declared.

After each narnia-jobs update, click reload on the extension's card at `chrome://extensions`. It works only in Chrome and Chromium-based browsers.

## 10. Maintenance: backup, updates and shutting down

- **Automatic backups** in `./backups`: one database copy when the app starts (at most one a day) and another before each migration, plus the uploaded files. The 5 most recent are kept (change it in Configurações › Backups). To restore: `./start.sh restore backups/<file>.sqlite`, which keeps the current database before swapping.
- **Update:** `git pull && ./start.sh up`. Then reload the extension and, if you use the terminal, run `./start.sh install-plugin`.
- **Semantic search** (optional): when your facts no longer fit in the recruiter's context, a notice suggests turning on **Configurações › Busca por sentido** (semantic search). It downloads a 113 MB local model once, and the recruiter starts finding facts by topic, not only by words.
- **Shut down:** `./start.sh down` (data and login are kept). To remove everything, see [Uninstalling](../../README.en.md#uninstalling).
- **Something odd?** `./start.sh doctor` and `./start.sh logs api`.
