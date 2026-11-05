# Tutorial: your first contribution

This tutorial takes you from an idea to a merged pull request, step by step. The full reference for the environment,
conventions and prompt evaluations is in [CONTRIBUTING](../../CONTRIBUTING.md) (Portuguese, with an English summary);
this is the practical path. Versão em português: [docs/contribuir.md](../contribuir.md).

The code, comments, docs and UI are in Brazilian Portuguese. Issues and pull requests in English are welcome.

## How the repository works

- The `main` branch is protected: nobody pushes commits straight to it. Every change goes in through a **pull
  request**, with **green CI** and the **maintainer's approval**.
- You work in a **fork** (your copy of the repository on GitHub), on a branch of your own, and open the pull request
  from the fork to `main` here.
- You only need **Docker** with Compose v2 and **git**. Node, pnpm and every tool run in containers.

## 1. Pick or open an issue

Before writing code, check the [issues](https://github.com/isaquebc/narnia-jobs/issues):

- **Bug:** open one with the "Problema · Bug" template, with steps to reproduce and the output of
  `./start.sh doctor` when relevant.
- **Idea or behavior change:** open one with the "Ideia · Feature request" template and wait for an answer before
  starting, so you don't invest in a path that won't be merged.
- **Small fix** (typo, broken link): go straight to the pull request.
- **Security issue:** never in a public issue; use the [private report](../../SECURITY.md).

Comment on the issue that you're working on it, so nobody duplicates the effort.

## 2. Fork and clone

On GitHub, click **Fork**. Then:

```bash
git clone https://github.com/<your-user>/narnia-jobs.git
cd narnia-jobs
git remote add upstream https://github.com/isaquebc/narnia-jobs.git
```

`origin` is your fork; `upstream` is the original repository, where you pull updates from.

## 3. Start the development environment

```bash
NARNIA_PROVIDER=mock ./start.sh dev
```

Open `http://127.0.0.1:5173/?token=dev-token`. With `NARNIA_PROVIDER=mock`, the app answers with fictional data and
doesn't spend your Claude subscription; to test with the real model, run without the variable and log in once
(`./start.sh login`). The code hot reloads: save, and the screen updates.

Check that everything passes before changing anything:

```bash
./start.sh lint && ./start.sh typecheck && ./start.sh test   # on Linux and macOS: make check
```

On Windows, replace `./start.sh` with `.\start.ps1` (the app hasn't been tested end to end on Windows; reports are
welcome).

## 4. Create a branch

```bash
git switch main
git pull upstream main
git switch -c fix/short-description      # or feat/..., docs/..., chore/...
```

One branch per topic. Small pull requests get reviewed faster.

## 5. Write the test before the code

The project follows **TDD** ([methodology](../../plans/plan-v0/09-metodologia-tdd.md), Portuguese):

1. Write the test that shows the problem or the new behavior, next to the code that changes
   (`packages/core/test/`, `apps/api/test/`, `apps/web/src/**/*.test.tsx`…).
2. Run it and watch it **fail**. To run a single package: `./start.sh test --filter=@narnia-jobs/core`.
3. Write the least code that makes the test pass.
4. Improve the code with the tests green.

A bug fixed without a regression test comes back. If the change touches the UI or a whole flow, also look at the
end-to-end scenarios in `apps/e2e` (`./start.sh e2e`, or `./start.sh e2e --ui-only --grep "E2E-19"` for one).

Things CI and review will check:

- **No real personal data** in code, tests, fixtures or commits. Use fictional names: Acme, Globex, Initech,
  Ana Maria Exemplo.
- **UI strings** always go in `apps/web/src/i18n/pt-BR.ts`.
- **Behavior changed:** update the README, the [tutorial](tutorial.md) (both languages) and the
  [usage guide](../guia-de-uso.md).

## 6. Changed a prompt? Run the gate

The prompts (the recruiter persona, the subagent, the skills and the structured calls in `plugin/` and
`packages/providers`) are evaluated against the real model before they go in:

```bash
NARNIA_PROVIDER=claude-code ./start.sh evals prompts --gate    # or: evals chat --gate
```

The change must be **better** than the approved version, in a blind pairwise judgment. The run uses your
subscription; paste the final summary into the pull request. Details are in
[CONTRIBUTING](../../CONTRIBUTING.md#gate-de-prompts). If you can't run it, say so in the pull request: the maintainer
runs it before merging.

## 7. Commit

Format `type(scope): message`, with the why in the body. Portuguese is the convention, but English is fine: review
will adjust it.

```bash
git add -A
git commit -m "fix(vagas): link with tracking parameters doesn't duplicate the posting

The duplicate check compared the whole URL; now it ignores utm_* and ref."
```

Types: `feat`, `fix`, `docs`, `test`, `chore`. The scope is the area (`vagas` for postings, `chat`, `cv`, `web`,
`lançador` for the launchers…).

## 8. Run everything and push

```bash
./start.sh lint --write     # fixes formatting
./start.sh lint && ./start.sh typecheck && ./start.sh test
./start.sh test:sh          # if you changed start.sh or start.ps1
./start.sh e2e              # if you changed the UI or a flow
git push -u origin fix/short-description
```

## 9. Open the pull request

GitHub shows a **Compare & pull request** button after the push. The pull request template asks for:

- what changes, in one or two sentences, with `Closes #123` to close the issue;
- how it was tested, ticking what you ran;
- the checklist (fictional data, strings in the dictionary, docs).

On your first pull request, CI waits for the maintainer to approve the run (a GitHub rule for first-time
contributors). After that it runs on its own: lint, typecheck, tests, build, launcher tests, images, e2e and the
personal data check, plus the launcher smoke test on Linux, macOS and Windows.

## 10. Review and merge

- **Red CI:** open the failed job in the pull request, fix it and push to the same branch; the pull request updates
  by itself.
- **Change requested:** answer each comment, fix and push. Mark the conversation as resolved when done: merging
  requires all of them resolved.
- **`main` moved on:** bring in the updates with `git pull --rebase upstream main` and `git push --force-with-lease`.

Approved and green, the maintainer merges. Then clean up:

```bash
git switch main
git pull upstream main
git push origin main
git branch -d fix/short-description
```

## Using Claude Code?

`CLAUDE.md` and the `.claude/` folder configure the maintainer's agent, which tests on a separate instance
(`scripts/claude-env.sh`, data in `./.claude-data`, ports 5174 and 3200). If your agent follows those rules, its tests
never touch your own data in `./data`. Review what it wrote before opening the pull request: you are responsible for
the contribution.

Thank you for contributing.
