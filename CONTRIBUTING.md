# Contributing to Antigravity Telegram Remote

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- **Node.js** 18 or higher
- **npm** 8 or higher
- **Antigravity** installed on your machine (for end-to-end testing)

## Getting Started

```bash
git clone https://github.com/optimistengineer/remoat.git
cd antigravity-telegram-remote
npm install
cp .env.example .env
```

Fill in `.env` with your Telegram bot token and user ID (see [README](README.md#quick-start) for details).

```bash
npm run dev           # start with auto-reload
npm test              # run the test suite
npm run build         # type-check and compile
```

## Project Layout

```
src/
  bin/                CLI entry point and subcommands (setup, start, doctor, open)
  bot/index.ts        Main bot file — grammy event handling, command routing, callback queries
  commands/           Telegram slash command handlers and message parser
  services/           Core business logic (CDP, response monitoring, sessions, detectors)
  database/           SQLite repositories (better-sqlite3)
  middleware/         Auth (user ID whitelist) and input sanitization
  ui/                 Telegram InlineKeyboard builders
  utils/              Config, logging, formatting, i18n, path security
tests/                Mirrors src/ structure — one test file per module
docs/                 Architecture docs, DOM selector reference, diagrams
locales/              i18n translation files (en, ja)
```

### Key modules to know

| Module | What it does | Size |
|--------|-------------|------|
| `bot/index.ts` | All Telegram event handling and routing | ~1300 lines |
| `services/cdpService.ts` | WebSocket communication with Antigravity | ~1500 lines |
| `services/responseMonitor.ts` | DOM polling, phase detection, completion tracking | ~1000 lines |
| `services/chatSessionService.ts` | Session lifecycle and Antigravity UI operations | ~800 lines |
| `utils/telegramFormatter.ts` | HTML formatting for Telegram output | ~400 lines |

### Architecture overview

The codebase follows a three-layer design:

```
CLI (Commander)  ->  Bot (grammy)  ->  Services / Database
```

- **CLI layer** parses arguments, runs the setup wizard, launches Antigravity
- **Bot layer** handles Telegram events, routes commands, manages callback queries
- **Services layer** contains all business logic — CDP communication, response monitoring, session management, feature detectors
- **Database layer** provides SQLite persistence for sessions, workspace bindings, templates, and schedules

For the full architectural picture, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Code Style

- **TypeScript** with strict mode. Run `npm run build` to type-check.
- Prefer `interface` over `type` for object shapes.
- Prefer `const` over `let`. Avoid direct mutation — use spread operators.
- Write comments only where the logic isn't obvious. Comments should explain _why_, not _what_.
- No linter is configured. The TypeScript compiler (`tsc`) is the primary code quality gate.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:

```
feat: add support for custom message templates
fix: prevent duplicate CDP connections on rapid reconnect
refactor: extract color constants from doctor command
test: add coverage for approval detector edge cases
```

Keep commits focused on a single change. If a PR touches multiple areas, split it into multiple commits.

## Testing

```bash
npm test              # unit tests (jest, excludes e2e)
npm run test:watch    # watch mode
npm run test:integration  # e2e tests (requires running Antigravity)
```

Run a single test file:

```bash
npx jest tests/services/cdpService.test.ts
```

**Expectations:**
- New features should include tests. Aim for 80%+ coverage on new code.
- Bug fixes should include a regression test.
- Tests live in `tests/` and mirror the `src/` directory structure.

## Pull Request Process

1. **Fork** the repository and create a branch from `main`
2. Make your changes. Write tests. Run `npm test && npm run build`
3. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) when submitting
4. Keep PRs focused — one feature or fix per PR
5. A maintainer will review your PR. Address feedback, and it'll be merged once approved

## Finding Work

- Check [open issues](https://github.com/optimistengineer/remoat/issues) — look for `good first issue` labels
- Browse the [Discussions](https://github.com/optimistengineer/remoat/discussions) for ideas and questions

## Reporting Bugs

Use the [bug report template](https://github.com/optimistengineer/remoat/issues/new?template=bug_report.md). Include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, Antigravity version)
- Relevant logs (`antigravity-telegram-remote --verbose` output)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
