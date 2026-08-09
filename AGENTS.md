# Repository Guidelines

## Project Structure & Module Organization

`src/server/` contains the Discord bot, Express API, SQLite access, plan logic, and moderation features; keep Discord helpers under `src/server/discord/`. The React dashboard lives in `src/client/`, with types in `types.ts`, API calls in `lib/api.ts`, and images in `assets/`. Generated output belongs under `dist/`; never edit it directly. Runtime SQLite data belongs in `data/`.

Read `PROJECT_CONTEXT.md` before changing the project. It is the canonical architecture and product-state record; update it alongside changes to routes, plans, storage, setup, or major features. Keep `memory-bank.md` as a short pointer, not a duplicate.

## Build, Test, and Development Commands

- `npm ci` installs versions from `package-lock.json`.
- `npm run dev` starts the server with `tsx` watch mode and the Vite client on port 5173. API requests proxy to port 3000.
- `npm run typecheck` checks both server and client TypeScript projects without emitting files.
- `npm run lint` runs ESLint across the repository.
- `npm test` runs Vitest; `npm run test:coverage` also enforces coverage thresholds.
- `npm run build` creates production output; `npm run verify:build` enforces dashboard size and source-map limits.
- `npm start` runs the compiled server from `dist/server/index.js`.
- `docker compose up --build` builds and runs the production container with persistent `./data` storage.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Follow two-space indentation, semicolons, double quotes, and trailing commas in multiline constructs. Use `camelCase` for variables and functions, `PascalCase` for React components and types, and descriptive kebab-case filenames such as `reaction-role-editor.tsx`. Keep browser code out of `src/server/` and secrets out of client bundles. Run lint and type checking before submitting changes.

## Testing Guidelines

Tests use Vitest, Testing Library, Supertest, and V8 coverage thresholds. Run coverage, lint, type checking, and a production build. Colocate `*.test.ts` or `*.test.tsx` near implementations and manually exercise affected Discord events.

## Commit & Pull Request Guidelines

Repository history is unavailable in this checkout, so use concise, imperative commit subjects (for example, `Fix reaction role cleanup`). Keep commits focused. Pull requests should explain behavior changes, list verification commands, link relevant issues, note configuration or database impacts, and include screenshots for dashboard UI changes.

## Security & Configuration

Copy `.env.example` to `.env` for local setup. Never commit Discord credentials, OAuth secrets, session secrets, API keys, or files from `data/`. Document new environment variables in `.env.example` and keep provider keys server-side.
