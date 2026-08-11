# Astra Verification Report

Date: 2026-08-11 (Europe/Istanbul)

## Result

All local automated gates pass. The Vitest suite contains 127 tests across 21 files; Playwright adds 27 Chromium checks across desktop, tablet, and mobile projects. A full manual security audit of the web/API layer, Discord command handling, crypto, backups, AI provider calls, dependencies, and container/Caddy configuration accompanied this run; all actionable local findings were corrected and covered by regression tests. Enforced V8 coverage, accessibility, visual snapshots, responsive overflow, production bundle budgets, dependency audit, Compose validation, Caddy parsing, encrypted backup/restore, clean Node 22 and custom Caddy image builds, and HIGH/CRITICAL vulnerability scans pass.

Full production sign-off remains pending because no public domain, real S3-compatible destination, or dedicated Discord test guild was supplied. The current local `.env` is development-oriented and still lacks production-valid encryption/metrics/backup configuration; the application now fails safely before binding a production port in that state.

## Verification Matrix

| Area | Evidence | Result |
|---|---|---|
| Type safety | `npm run typecheck` | Pass |
| Style/static analysis | `npm run lint` | Pass |
| Unit/integration/UI | `npm run test:coverage` | 127/127 pass across 21 files |
| Coverage gate | `npm run test:coverage` | Pass |
| Browser E2E | `npm run test:e2e` | 27/27 pass; desktop/tablet/mobile |
| Accessibility | jest-axe and browser Axe on public/admin routes | Pass; no serious/critical violations |
| Browser layout | Playwright overflow, keyboard, reduced-motion, visual snapshots | Pass |
| Production bundle | `npm run build` | Pass |
| Bundle budgets | `npm run verify:build` | Pass; 336.2 KiB total, no source maps |
| Dependency graph | `npm ls --depth=0` | Pass |
| Dependency security | `npm audit --audit-level=moderate` | 0 vulnerabilities |
| Compose | `docker compose config --quiet` | Pass |
| Caddy | Pinned, custom non-root image; `caddy validate` | Pass |
| Node 22 image | Pinned multi-stage `docker build`; in-image bundle gate | Pass |
| Image vulnerability scan | Trivy on Astra and custom Caddy images | 0 HIGH/CRITICAL findings |
| Runtime attack surface | Final Astra image package-manager check | npm/npx/yarn/corepack absent |
| Backup/restore | Encrypted on-demand backup and isolated restore drill | Pass; SQLite integrity `ok` |
| Runtime smoke | `/health/live`, `/health/ready`, `/metrics`, `/privacy` | Expected statuses pass |
| Local HTTP load | 3,000 requests, concurrency 20 | 3,000 HTTP 200; p95 7.69 ms |
| Runtime file permissions | `.env`, SQLite, WAL/SHM, data directories | Owner-only (`0600`/`0700`) |
| Secret leakage | `.env` secret values scanned against dashboard bundle | No leaks |
| Discord configuration | Read-only `/users/@me`, application, and gateway REST checks | Pass |
| GitHub Actions | PR CI run: tests, E2E, builds, Trivy, SBOM | Pass in 5m12s; both SBOM artifacts published |

Coverage: 69.08% statements, 61.77% branches, 57.80% functions, and 72.43% lines overall. Server line coverage is 83.86%; SQLite is 89.38%, web API is 87.66%, backup format is 92.18%, backup restore is 93.93%, and crypto is 100% by lines. Browser tests additionally exercise responsive public routes, authenticated administrator behavior, background revalidation, keyboard focus, reduced motion, and visual output.

The previous local load run exercised `/health/live`, `/api/public/site-settings`, and `/privacy` with 20 concurrent clients and completed 3,000 requests without HTTP failure. The redesigned dashboard bundle is 336.2 KiB total: 257.2 KiB JavaScript, 57.6 KiB CSS, and 20.8 KiB images. The former 1.7 MB PNG logo was replaced with responsive WebP assets.

## Behaviors Exercised

- Configuration bounds, safe regex validation, templates, localization, and plan locks.
- Fresh SQLite creation, legacy v1→v3 migration, hashed session-token storage, subscriptions, quota, audit history, privacy deletion, ticket filtering, and one-active-ticket enforcement.
- AES-256-GCM round trips, AAD isolation, malformed keys, and ciphertext/tag tampering.
- All AutoMod rule families, custom commands, Unicode reaction roles, member lifecycle, Join Guard, boost/role events, AI command access, ticket creation/closure, and command registration schema.
- Timestamped OAuth state/callback, network timeouts and redirect rejection, session cookies, administrator/moderator RBAC, setup, reaction-role/custom-command APIs, encrypted transcripts, complete privacy export, developer endpoints, malformed/oversized JSON, exact-Origin enforcement, CSP, no-cache behavior, constant-time metrics authentication, and request IDs.
- AI provider endpoint pinning, custom-host allowlisting, Discord mention suppression, scheduler success/failure isolation, structured-log redaction, Prometheus output, and React public/admin/moderator routes.
- Production configuration rejection, encrypted backup authentication, consistent SQLite backup, local rotation, optional upload behavior, and restore integrity.
- Public routes at three viewport classes, authenticated unsaved-change preservation, keyboard focus, reduced motion, 404 handling, and screenshot baselines.

## Defects Found and Corrected

- Closed tickets could appear successfully reassigned.
- Concurrent ticket creation did not enforce one active ticket per owner.
- Unicode reaction roles could fail because stored and Discord emoji forms differed.
- Synchronously throwing scheduled jobs escaped the Promise error handler.
- Privacy exports truncated ticket, case, and audit histories.
- Malformed/oversized JSON was incorrectly returned as HTTP 500.
- Sensitive API responses lacked explicit `Cache-Control: no-store`.
- Configured moderator roles could not close tickets through the button flow.
- Concurrent ticket closure could record a duplicate successful action.
- The production container ran as root.
- The production image's data directory allowed non-owner traversal.
- The mobile orbit decoration could intercept/obscure CTA controls.
- Landing feature-card headings skipped from `h1` to `h3` and failed axe heading-order checks.
- Local secrets and SQLite data were readable by other machine users; runtime creation and current files now use owner-only permissions.
- Background dashboard revalidation could discard unsaved configuration edits.
- Entrance animations could leave primary content invisible during initial rendering and automated capture.
- Mobile navigation hid the dashboard label and decorative controls overlapped content.
- UI text, form controls, focus indicators, and contrast were too small or weak for comfortable operation.
- The dashboard shipped a 1.7 MB source image and loaded fonts from a third-party origin.
- Production startup accepted incomplete security configuration and lacked graceful shutdown.
- SQLite had no encrypted backup, rotation, off-site export, or verified restore workflow.
- Compose published the app directly and did not enforce a read-only, capability-free runtime behind TLS.
- Session bearer tokens were stored directly in SQLite instead of one-way digests.
- Official AI provider keys could be redirected to a developer-supplied base URL.
- Custom AI endpoints were not protected by an explicit host allowlist.
- OAuth provider calls lacked hard timeouts and redirect rejection.
- Production state-changing API requests accepted a missing Origin header.
- Rate-limit source tracking could grow beyond its intended memory bound.

- Custom AutoMod regex validation relied on an incomplete hand-written ReDoS heuristic; patterns are now also parser-scored with hard step and time limits.
- Destructive moderation commands (`/kick`, `/ban`, `/timeout`) accepted `ManageMessages` alone and never compared target and invoker role hierarchy, allowing a junior moderator to act on senior staff. Action-specific permissions (Kick/Ban/ModerateMembers), owner/`moderatable`/role-position checks, and matching `defaultMemberPermissions` now apply.
- Guild data export (including decrypted ticket transcripts) remained accessible for up to seven days after the bot left a guild, via the stale OAuth permission snapshot. Guild access now requires live bot presence.
- Reaction-role creation accepted roles above the invoker's highest role, enabling self-escalation; role position is now validated against both the bot and the invoker.
- Any AI provider error (including a single guild's 4xx) tripped the global circuit breaker, disabling `/ai` for all guilds. Only 429/5xx/network errors trip it now.
- Ticket-staff-only users could read the full moderation case and audit history; the `/moderation` endpoint now excludes ticket staff.
- Setup template application bypassed plan-locked field preservation.
- A failed `/ai summarize` history fetch still consumed the daily quota; quota is consumed only after the transcript is built.
- Raw `console.error` calls in the OAuth callback and error middleware bypassed the sanitizing structured logger.
- Ticket inbox search treated `%`/`_` as LIKE wildcards; input is now escaped with an explicit `ESCAPE` clause.
- Unknown `/api/*` requests fell through to the SPA fallback (HTML 200) instead of a JSON 404.
- A stale `@everyone` dashboard, moderator, or ticket-staff role ID could grant every guild member delegated access. Configured access roles now require a real, non-managed role and are checked against live guild membership.
- A delegated dashboard administrator could change privileged access-role configuration. Only the guild owner or a member with Discord's live `ManageGuild` permission can delegate dashboard, moderator, or ticket-staff access.
- Auto-role configuration accepted managed, privileged, or hierarchy-inaccessible roles. Save-time and Discord-event validation now enforce a member-safe permission allowlist and both bot/actor hierarchy.
- Rejected asynchronous Discord message handlers and client errors could become unhandled process failures. Event boundaries now contain, redact, and report failures without exposing credentials.
- Backup decryption required only the current key, preventing safe rotation, while restore rollback failures were swallowed. Active and previous decryption-only keys, streamed encryption/decryption, verified SQLite restore, and fail-closed atomic rollback now apply.
- S3 configuration accepted incomplete groups and unsafe endpoints. All five fields are required together and the endpoint must be credential-free HTTPS.
- Audit, moderation, ticket, transcript, AI-usage, and session data lacked exact lifecycle bounds. Per-guild quotas and scheduled retention now cap persistent growth and purge expired sessions.
- Clean Compose-mounted directories could be root-owned and unwritable by the runtime user. Dedicated one-shot init services establish owner-only permissions without making Astra or Caddy root.
- The runtime and proxy images exposed unnecessary package-manager tooling and mutable/unbounded defaults. Package managers are removed, filesystems are read-only, capabilities are minimized, and memory/CPU/PID/log limits are enforced.
- Mutable Actions and base-image references weakened build reproducibility. Workflow actions and container bases are digest/SHA pinned; Dependabot covers npm, Docker, Go, and Actions; CI scans both images and always publishes SBOMs after a successful build.
## Remaining Checks

1. Supply a public `APP_DOMAIN`, matching Discord HTTPS callback, long session/metrics secrets, and separate 32-byte Base64 transcript/backup keys; then start Compose and confirm Caddy ACME issuance plus `/health/ready`.
2. Supply S3-compatible credentials and confirm a real encrypted upload, retention policy, download, and restore drill. Local and mocked upload paths pass.
3. In a dedicated Discord guild, exercise command permissions, channel overwrites, hierarchy failures, reaction add/remove, ticket panels, transcript downloads, and Turkish/English replies using real events.
4. Repository vulnerability alerts, automated security fixes, SHA-pinning enforcement, and read-only workflow permissions are enabled. Ruleset/branch-protection enforcement still requires a GitHub plan that supports it for this private repository.
