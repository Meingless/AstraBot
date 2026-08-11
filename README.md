# Astra Discord Suite

A multi-server Discord bot with a secure, animated management panel. Server owners and members with the `Manage Server` permission authenticate through Discord before managing settings.

## Setup

1. Create a Discord application and bot at the Discord Developer Portal.
2. Enable the **Server Members Intent** and **Message Content Intent** under Bot settings.
3. Add an OAuth2 redirect URL: `http://localhost:3000/api/auth/callback`.
4. Copy `.env.example` to `.env`, fill in the Discord/session values, and generate `DATA_ENCRYPTION_KEY` with `openssl rand -base64 32` before retaining ticket transcripts.
5. Run `npm ci` and then `npm run dev`.
6. Open `http://localhost:5173`, sign in with Discord, and use **Invite Astra** to add it to a server.

## Production Deployment

1. Set `APP_DOMAIN` to the public hostname and register `https://<APP_DOMAIN>/api/auth/callback` in Discord.
2. Generate separate values with `openssl rand -base64 32` for `DATA_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY`, plus long random `SESSION_SECRET` and `METRICS_TOKEN` values.
3. Set `BACKUP_ENABLED=true`; Compose creates/fixes owner-only `data/` and `backups/` bind-mount permissions through a one-shot init service.
4. Run `docker compose up --build -d`. Caddy obtains/renews TLS and proxies to the internal Astra service; port 3000 is not published.
5. Confirm `https://<APP_DOMAIN>/health/ready` and authenticated `/metrics`, then complete the dedicated Discord test-guild checklist.

The application container uses a read-only root filesystem, drops Linux capabilities, and shuts down gracefully on SIGTERM. Caddy also runs unprivileged from a reproducible, patched Go build. Both services have memory, CPU, PID, and log-rotation limits. Invalid production secrets or a non-HTTPS/mismatched OAuth redirect stop startup before the port is opened.

### Backup and Restore

`npm run ops:backup` creates a permission-restricted, streaming encrypted, integrity-checked SQLite backup. Scheduled backups retain seven days locally by default. Supplying the complete `BACKUP_S3_*` group, including its HTTPS endpoint, also streams each encrypted file to S3-compatible storage. When backups are enabled, readiness stays false until a complete local and configured off-site backup succeeds.

Stop Astra before restore, preserve the encrypted source file, and run:

```bash
npm run ops:restore -- --file backups/astra-<timestamp>.db.enc --confirm RESTORE
```

Restore validates the encryption tag and SQLite integrity before replacement and atomically keeps the former database as `astra.db.before-restore`. It refuses to replace the live file if rollback creation fails or SQLite WAL/SHM files show that Astra did not stop cleanly.

For key rotation, move the former active key to `DATA_ENCRYPTION_PREVIOUS_KEYS` or `BACKUP_ENCRYPTION_PREVIOUS_KEYS`, set a new active key, restart and verify, then remove the former key only after all retained transcripts or backups using it have expired or been re-created. Previous keys are decryption-only; new records always use the active key.

## Automation

- Rich welcome and goodbye messages with `{user}`, `{username}`, `{server}`, and `{count}` placeholders
- Automatic role assignment on join, restricted to non-managed roles below Astra with only member-safe permissions
- Configurable AutoMod for invite links, external links, banned words, and excessive caps
- Flood, duplicate-message, mention-spam, and bounded ReDoS-analyzed regex AutoMod rules
- Join Guard for newly created Discord accounts
- Reaction roles that add and remove roles when a member reacts
- Custom prefix commands with configurable responses
- Boost and role-assignment event messages
- Join, leave, and moderation audit logs
- Moderation case/audit history, configurable moderator roles, and optional direct-message notifications
- Slash commands: `/help`, `/ping`, `/server`, `/user`, `/warn`, `/kick`, `/ban`, `/timeout`, `/purge`, `/lock`, `/unlock`, `/ticket`, and AI-only `/ai ask`, `/ai summarize`, `/ai explain`
- Gaming, Creator, Product/Support, and empty setup templates with Turkish/English guild localization
- Ticket assignment, encrypted transcripts, configurable retention, search, export, deletion controls, and bounded per-guild storage/rate quotas
- Privacy self-service plus health, readiness, structured logs, and protected metrics
- Per-guild SQLite configuration and authenticated dashboard access

Run `npm run build` to create a production bundle, then use `npm start`.

## Developer Console

Set `DEVELOPER_DISCORD_IDS` in `.env` to a comma-separated list of Discord user IDs that can manage public plan content. Obtain your ID by enabling Discord Developer Mode, then right-clicking your Discord profile and selecting **Copy User ID**.

Visit `/developer` after signing in to edit plan names, prices, feature lists, the maintenance state, and the public announcement. This console changes display content only; payments remain disabled.

### Plan Enforcement

Plans are assigned per Discord server at `/developer/premium`. Developers can select Free, Standard, Premium, or Astra AI and optionally set an expiration date. Expired subscriptions automatically receive Free capabilities without deleting their saved configuration.

- Free: core welcome, role, logging, moderation, one reaction role, three custom commands, and ten visible cases.
- Standard: Join Guard, event messages, 15 reaction roles, 25 custom commands, and 100 visible cases.
- Premium: unlimited reaction roles and custom commands plus advanced AutoMod.
- Astra AI: all Premium capabilities and AI assistant commands, limited to 100 commands per server/day. AI does not moderate or delete messages.

### AI Plan Access and Provider

Use `/developer/premium` to assign the Astra AI plan while billing is disabled. AI-plan servers can use assistant commands; messages are not sent to an AI moderation classifier.

Developers select the provider and default model at `/developer/ai`. Add the corresponding server-side key to `.env`:

```env
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GEMINI_API_KEY=
MOONSHOT_API_KEY=
AI_CUSTOM_ALLOWED_HOSTS=
AI_API_KEY=
```

Only the key for the selected provider is required. Official provider keys are always sent to fixed official HTTPS endpoints and redirects are rejected. `AI_API_KEY` is used only with a custom OpenAI-compatible endpoint whose exact host (and port, when present) is listed in `AI_CUSTOM_ALLOWED_HOSTS`. Custom endpoints require HTTPS outside local development. Keys stay in the server environment and are never exposed to the dashboard. Provider failures return a temporary-unavailable response without affecting AutoMod.

## Operations and Verification

- `GET /health/live` reports liveness; `GET /health/ready` checks SQLite, Discord, production transcript encryption, and enabled backup success.
- `GET /metrics` requires `Authorization: Bearer <METRICS_TOKEN>` and returns Prometheus-format counters.
- `/privacy` provides the public TR/EN data-handling notice; guild export and owner-confirmed deletion live in the dashboard.
- Run `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build`, `npm run verify:build`, and `npm run test:e2e` before handoff. Browser tests cover public pages and authenticated dashboard behavior at desktop, tablet, and mobile sizes.
- The production Docker image runs as the unprivileged `node` user and excludes npm, npx, Yarn, and Corepack from the runtime filesystem.
- CI pins actions and base images, scans both Astra and Caddy for HIGH/CRITICAL vulnerabilities, and publishes an SBOM for each image. Dependabot monitors npm, Go, Docker, and GitHub Actions dependencies.
