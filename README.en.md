# narnia-jobs

[![CI](https://github.com/isaquebc/narnia-jobs/actions/workflows/ci.yml/badge.svg)](https://github.com/isaquebc/narnia-jobs/actions/workflows/ci.yml) · [Português](README.md)

**A job search assistant that runs on your own computer.** You upload your résumé, narnia-jobs organizes your career into facts with a source, and a senior AI recruiter (Claude, through your own subscription) talks with you, analyzes job postings, builds résumés and cover letters as PDFs without making anything up, and tracks your applications. Everything stays in a folder on your machine, in Docker.

- **Profiles from your résumé.** Reads PDF, DOCX or free text (with OCR for scanned PDFs) and your GitHub; every fact becomes a proposal quoting where it came from, and nothing is saved without your review. Several profiles over the same facts, one per target role.
- **Recruiter chat.** Knows your career and every profile, searches your data, cites the source of each claim and researches the market, recording its sources. It also runs inside Claude Code, as a plugin.
- **Job analysis.** Paste the text or the link: fit per profile, what you meet (linked to your facts), gaps, risks, ATS keywords and likely interview questions.
- **Résumé and cover letter.** A PDF of up to 2 pages in the posting's language, checked by automated rules and by a second model before it reaches you; three built-in templates plus your own.
- **Applications.** A board by stage, a calendar with `.ics` files and, optionally, Google Calendar.
- **Chrome extension.** Brings postings from any site and helps fill in application forms with answers drawn from your data.

> **Language.** The user interface is in **Brazilian Portuguese only** (all strings live in one dictionary, `apps/web/src/i18n/pt-BR.ts`; translations are welcome). Résumés and cover letters are generated in the posting's language (Portuguese or English), and the recruiter answers in the language set in each profile's persona (Perfis › Recrutador › Idioma, for example `en-US`).

## Not there yet

Voice interview practice, analysis of recorded interview videos, reading and sending e-mails automatically, recruiter messages and LinkedIn optimization, exporting and deleting your data from the UI, the full usage meter and a second AI provider (Codex) are planned ([plans/plan-v0/tasks/README.md](plans/plan-v0/tasks/README.md), in Portuguese). Importing the LinkedIn data export was postponed.

## Before you start

- **Docker** with Compose v2: Docker Desktop on Windows and macOS; Docker Engine on Linux. Nothing else is installed on your computer.
- **A Claude subscription with Claude Code access** (Pro or Max). Usage counts against your plan's limits, just like using Claude Code; the ingestion screen shows an estimate before running and the chat shows what each conversation spent.
- **Space:** about 2.5 GB of disk for the images and 1 GB of free RAM (the optional Phoenix adds 1 GB of disk and 500 MB of RAM; the optional semantic search, 113 MB and 400 MB).
- Optional: the **GitHub CLI** (`gh`) logged in on your computer, to import private repositories without a new login; **Chrome**, for the extension; **Claude Code** installed, to use the recruiter in your terminal.

Tested on Linux; on Windows and macOS it runs through Docker Desktop (the launcher functions are tested in CI on all three systems).

> **Warning:** the app has never been tested end to end on Windows, because the author has no Windows machine. `start.ps1` and its functions pass in CI, but real use may hit problems. If something fails, please [open an issue](https://github.com/isaquebc/narnia-jobs/issues).

### About using your Claude subscription

narnia-jobs runs the **official Claude Code CLI** inside a container, logged in with **your** account, on **your** machine. It never receives, stores outside your computer or forwards your credential.

Anthropic's Agent SDK documentation states that, unless previously approved, third-party developers may not offer claude.ai login or subscription rate limits in their products. narnia-jobs is not a service: each person runs their own copy with their own login, like other open source projects that wrap Claude Code. The rule still exists and the choice is yours, so there are two modes over the same core:

- **Mode A, web interface:** the chat and the background tasks use the CLI logged in inside the container (the default).
- **Mode B, Claude Code plugin:** you talk in your own Claude Code and narnia-jobs plugs in as a plugin and MCP server. This is the path that is unambiguously within the rules ([tutorial, step 8](docs/en/tutorial.md#8-the-recruiter-in-claude-code-mode-b)).

The full analysis (in Portuguese) is in [plans/plan-v0/01-viabilidade.md](plans/plan-v0/01-viabilidade.md).

## Quick start

```bash
git clone https://github.com/isaquebc/narnia-jobs.git
cd narnia-jobs
./start.sh up        # Windows: .\start.ps1 up
./start.sh login     # once: log in to your Claude subscription inside the container
```

`up` builds the images (the first time takes a few minutes), picks a free port between 3100 and 3199 and prints the address with the access token:

```
  narnia-jobs está no ar:

    http://127.0.0.1:3100/?token=…
```

Open that address in your browser and follow the first-run wizard. The full walkthrough, from the résumé to your first application, is in the **[tutorial](docs/en/tutorial.md)**.

## Privacy: what stays and what leaves your computer

**Stays on your computer:** everything that is yours, in the `./data` folder (SQLite database, uploaded résumés, generated documents) and the backups in `./backups`. Your subscription login lives in a Docker volume. narnia-jobs has no telemetry of its own and no cloud server; Phoenix, when enabled, is local too.

**Leaves, and where to:**

| To | What | When |
|----|------|------|
| Anthropic (through the Claude Code CLI, on your account) | what the model needs: résumé, facts, chat messages, postings, document texts | every AI task; Anthropic's data policy applies, including the CLI's own telemetry |
| Anthropic (web search) | the searches the recruiter runs (salaries, companies): the search tool runs on Anthropic's side | when it researches |
| The sites it reads | the request for the pages the recruiter reads | when it reads a page; in the web chat, only from the trusted domains (Configurações › Chat) |
| The posting's site | the page request and, if it needs JavaScript, the resources it loads (in an isolated browser, without images or fonts) | when you save a posting by its link |
| The links in your résumé | one visit to each link (identified as a regular Chrome) | when the PDF is built, so no broken link is published |
| GitHub API | queries about your repositories | when you import GitHub |
| Hugging Face | a one-time 113 MB model download | when you turn on semantic search |
| Google | calendar events | only if you connect Google Calendar |

## Updating

```bash
git pull
./start.sh up
```

Database migrations run on their own, with a backup before each one. After updating, reload the extension at `chrome://extensions` and, if you use the recruiter in the terminal, run `./start.sh install-plugin` again.

## Uninstalling

```bash
./start.sh down --purge                           # stops everything and removes the volumes (Claude and GitHub logins, queue, Phoenix)
docker image rm narnia-jobs/app narnia-jobs/web narnia-jobs/browser
# if you installed the recruiter in Claude Code:
claude mcp remove -s user narnia-jobs
claude plugin uninstall narnia-jobs@narnia-jobs-local
claude plugin marketplace remove narnia-jobs-local
```

Remove the extension at `chrome://extensions`. Finally, delete the project folder: it holds `./data` and `./backups`, that is, **all your data**. Keep a copy first if you want one.

## Troubleshooting

- **`./start.sh doctor`** checks the login, Redis, data folder, worker, last backup and the Claude Code plugin. Start there.
- **"Não logado" (not logged in) or expired login:** run `./start.sh login` again. Alternative: `claude setup-token` on your computer and `CLAUDE_CODE_OAUTH_TOKEN=…` in `.env`.
- **Port in use:** `up` picks another one between 3100 and 3199 and tells you. Port `8089` (the Google Calendar login callback) must be free too. If it is not, set `NARNIA_OAUTH_PORT=<other>` in `.env` and use `http://localhost:<other>/callback` as the redirect URI in your Google OAuth client.
- **"a pasta ./data não é gravável" (data folder not writable):** the folder was created as root (by calling `docker compose` directly); the error prints the exact `sudo chown` to fix it.
- **Windows:** use PowerShell (`.\start.ps1 up`). If the script is blocked, run `powershell -ExecutionPolicy Bypass -File .\start.ps1 up`. Cloning inside WSL2 makes Docker much faster.
- **Docker not running:** the launcher tells you; start Docker Desktop (or `sudo systemctl start docker`).

## Documentation

| | |
|---|---|
| [Tutorial](docs/en/tutorial.md) | from first run to your first application, step by step |
| [Usage guide](docs/guia-de-uso.md) (Portuguese) | reference for every feature, settings, commands, data and backup |
| [Résumé templates](docs/templates-de-cv.md) (Portuguese) | how to build your own template (`.zip`) |
| [Google Calendar](docs/google-calendar.md) (Portuguese) | optional calendar connection for applications |
| [First contribution](docs/en/contributing.md) | from fork to merged pull request, step by step |
| [Contributing](CONTRIBUTING.md) | development setup, tests, prompt evaluations (Portuguese, with an English summary) |
| [Security](SECURITY.md) | how to report a vulnerability and the threat model |

## License

[MIT](LICENSE). Contributions are welcome: start with the [contribution tutorial](docs/en/contributing.md), see [CONTRIBUTING](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
