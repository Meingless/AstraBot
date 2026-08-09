# Astra Project Context

This file is the repository's canonical context record. Read it before making changes. Treat source code and configuration as authoritative; update this document in the same change whenever architecture, routes, plans, storage, setup, or major features change.

## Product State

Astra Discord Suite is a multi-server Discord bot with a Discord OAuth dashboard. Configuration and subscriptions are scoped to Discord guilds, not users. The product provides bilingual onboarding, automation, moderation, role tools, encrypted support-ticket operations, AI assistant commands, and plan-based access control.

Free, Standard, Premium, and Astra AI access is enforced. Developers can assign plans and expiration dates manually. Payments, checkout, and billing webhooks are intentionally disabled; `/billing` is a read-only plan overview. iyzico is a possible future payment provider, not an implemented integration.

## Architecture and Data Flow

- `src/server/index.ts` loads environment variables, starts the Express service on port 3000 by default, and logs in the Discord bot.
- `src/server/bot.ts` registers global slash commands and handles Discord events, moderation, reaction roles, AI commands, and ticket interactions.
- `src/server/web.ts` owns Discord OAuth, signed session cookies, authorization, dashboard APIs, and production static-file serving.
- `src/server/database.ts` runs versioned SQLite migrations and repositories for guild data, audit events, tickets, subscriptions, and quotas.
- `src/server/config.ts` defines defaults and sanitizes per-guild settings; `plans.ts` computes capabilities and preserves locked settings on updates. `templates.ts` supplies Gaming, Creator, Product/Support, and empty setup presets.
- `src/server/moderation.ts` is the deterministic, stateful AutoMod decision engine; `bot.ts` supplies Discord messages and performs approved actions.
- `src/server/ai.ts` supports the `/ai` assistant commands through OpenAI-compatible and Gemini requests. AI message moderation is intentionally disabled.
- `src/server/crypto.ts` encrypts retained ticket transcripts with AES-256-GCM. `observability.ts` provides structured logs, request IDs, health checks, and Prometheus-format metrics.
- `src/server/runtime-config.ts` fails production startup before binding a port when secrets, encryption, metrics, domain, or HTTPS OAuth configuration is unsafe. `backup.ts` creates rotated AES-256-GCM SQLite backups and optionally exports them to S3-compatible storage.
- `src/client/main.tsx` mounts the route composition in `App.tsx`. Public, developer, and authenticated dashboard screens live under `pages/`; reusable UI primitives live under `components/`; `theme.css` provides the refined responsive theme. `types.ts` mirrors API contracts and `lib/api.ts` wraps fetch/error handling.

Dashboard requests flow through Vite's `/api` proxy in development. The API validates the OAuth session and current Discord guild permissions before reading bot state or SQLite data. In production, Express serves `dist/dashboard`; the compiled server runs from `dist/server`.

## Repository Layout

```text
src/client/          Active React/Vite dashboard, styles, types, and assets
src/server/          Express API, Discord bot, configuration, plans, and SQLite
src/server/discord/  Discord-specific helpers such as emoji normalization
data/                Runtime SQLite storage; ignored and Docker-mounted
dist/                Generated server and dashboard bundles; never edit directly
```

Legacy prototype and `.orig` files have been removed. The dashboard uses optimized 96 px and 512 px WebP logo assets; the original 1.7 MB PNG is not shipped.

## Runtime and Configuration

Node.js 22+ is required because the server uses `node:sqlite`. Copy `.env.example` to `.env`; never commit `.env` or expose provider keys to the client.

Required values are `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, and `SESSION_SECRET`. Production additionally requires `APP_DOMAIN`, a matching HTTPS redirect, a 32-byte Base64 `DATA_ENCRYPTION_KEY`, and a distinct 32-character-or-longer `METRICS_TOKEN`; invalid configuration fails before the HTTP port opens. Backup and transcript encryption keys must differ, and custom S3 endpoints require credential-free HTTPS URLs. `PORT` defaults to 3000 and `DEVELOPER_DISCORD_IDS` is a comma-separated developer allowlist. Optional provider keys are `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, and `AI_API_KEY`; custom AI endpoints additionally require an exact host entry in `AI_CUSTOM_ALLOWED_HOSTS`.

Encrypted SQLite backups are enabled with `BACKUP_ENABLED=true`. `BACKUP_ENCRYPTION_KEY` must be a separate Base64 32-byte key. Backups default to `/app/backups`, run every 24 hours, retain seven days locally, expose success/failure metrics, and can be exported to an S3-compatible endpoint by supplying the complete `BACKUP_S3_*` group. `npm run ops:backup` creates an on-demand copy; restore requires the Astra service to be stopped and an explicit `--confirm RESTORE` argument.

Discord setup requires Server Members and Message Content intents. The local OAuth redirect is `http://localhost:3000/api/auth/callback`.

```bash
npm ci
npm run dev       # API/bot :3000; Vite dashboard :5173
npm run typecheck
npm run lint
npm test
npm run build
npm start         # run compiled production server
docker compose up --build
```

Production Compose places Astra on an internal network behind Caddy, which terminates HTTPS for `APP_DOMAIN`. The Astra container is unprivileged, read-only, capability-free, and writes only to the mounted data/backup directories and a restricted temporary filesystem. SIGTERM/SIGINT drains HTTP, stops jobs, disconnects Discord, checkpoints WAL, and closes SQLite.

## Features and Plan Enforcement

| Plan | Effective access and limits |
|---|---|
| Free | Welcome/goodbye, auto-role, logs, basic AutoMod, moderation commands, 1 reaction role, 3 custom commands, 10 visible cases |
| Standard | Free plus Join Guard, boost/role messages, tickets, 15 reaction roles, 25 custom commands, 100 visible cases |
| Premium | Standard plus banned-word/caps AutoMod and unlimited reaction roles/custom commands |
| Astra AI | Premium plus `/ai ask`, `/ai summarize`, and `/ai explain`; 100 commands per guild/day |

Expired subscriptions retain their stored configuration but evaluate as Free. Locked configuration fields are preserved rather than erased when a lower plan submits settings.

Automation includes welcome/goodbye embeds, auto-role, Join Guard, boost and role-change messages, configurable prefix commands, reaction roles, audit logging, invite/link filtering, banned words, caps, flood, duplicate-message, mention, and regex rules. Custom regexes are length-limited, syntax checked, screened for unsupported constructs, and scored for ReDoS with hard analysis step/time bounds before storage. Moderation slash commands are `/warn`, `/kick`, `/ban`, `/timeout`, `/purge`, `/lock`, and `/unlock`; informational commands are `/help`, `/ping`, `/server`, `/user`, plus a user context command.

AI-plan commands are `/ai ask`, `/ai summarize`, and `/ai explain`. Provider failures return no AI result. Messages are not sent to AI for moderation and AI never deletes messages.

Standard+ guilds can configure category/staff roles, publish `/ticket panel`, claim tickets, close them from Discord or the dashboard, filter the inbox, and download/delete encrypted transcripts. Users may have one open ticket. Transcript retention is configurable as 0, 30, or 90 days and defaults to 30; failed encryption/storage prevents channel deletion.

Guild language defaults from Discord preferred locale (`tr` or `en`) and can be changed in the dashboard. Owners/Manage Server remain administrators; configured dashboard-admin roles receive configuration access and moderator roles receive only case/audit/ticket access.

## Web Surface and Access Control

Client routes are `/`, `/features`, `/subscriptions`, `/privacy`, `/billing`, `/developer`, `/developer/premium`, and `/developer/ai`. `/privacy` is a public TR/EN data-handling notice. The developer pages edit public site/plan content, guild subscriptions, expiration dates, and the shared AI provider/model configuration.

API groups are `/api/auth/*`, `/api/me`, `/api/public/site-settings`, `/api/billing/overview`, `/api/developer/*`, setup/moderation/ticket/privacy endpoints under `/api/guilds/:guildId/*`, and `/api/invite`. Role-aware authorization uses the current Discord member. Privacy deletion requires the guild owner and exact guild-name confirmation; subscription assignments are preserved.

OAuth state is timestamped, HMAC-signed, limited to ten minutes, and consumed before Discord network calls. Discord OAuth requests have strict timeouts and reject redirects. Sessions last seven days, are referenced by `HttpOnly`, `SameSite=Strict` cookies, and are stored in SQLite only as SHA-256 token digests; production cookies are secure. Helmet supplies production CSP/security headers, JSON bodies are limited to 100 KB, bounded API/auth rate limits are enforced, and production state-changing requests require the exact site Origin. Metrics tokens use constant-time comparison. Official AI keys are pinned to fixed provider endpoints; custom AI hosts require an environment allowlist. Discord outbound messages disable automatic mass/role/user mention parsing by default.

## Persistent Data

`data/astra.db` contains `guild_configs`, `sessions`, `reaction_roles`, `custom_commands`, `moderation_cases`, `audit_events`, `tickets`, `site_settings`, `guild_subscriptions`, and `ai_daily_usage`. `PRAGMA user_version` controls transactional migrations; schema v2 repairs legacy duplicate active tickets and enforces one active ticket per guild owner, while schema v3 migrates session primary keys from bearer tokens to SHA-256 digests without invalidating active cookies. Ticket ciphertext, nonce, authentication tag, and expiry are stored separately. SQLite files and encrypted backups use owner-only permissions; backup restore authenticates the encrypted envelope and runs `PRAGMA integrity_check` before atomic replacement. Docker mounts `./data` and `./backups`, and the production image runs as the unprivileged `node` user.

Vitest, Testing Library, Supertest, jest-axe, V8 coverage, Playwright, and browser Axe cover configuration, migrations, plan locks, AutoMod, Discord behavior, encrypted tickets/backups, OAuth/RBAC/API security, health/metrics, provider clients, scheduler failures, public routes, authenticated dashboard behavior, accessibility, responsive overflow, keyboard focus, reduced motion, and visual snapshots at desktop/tablet/mobile sizes. `npm run verify:build` enforces 350 KiB image and 800 KiB total dashboard budgets and rejects source maps. CI runs all gates plus container CVE scanning and SBOM generation. Before handoff run `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build`, `npm run verify:build`, and `npm run test:e2e`, then exercise Discord interactions in a dedicated test guild.

`TEST_REPORT.md` records the latest full verification matrix, measured coverage, corrected defects, and external checks still required for production sign-off.
