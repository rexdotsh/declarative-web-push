# AGENTS.md

A TypeScript library for Web Push in PWAs that has to work on iOS: declarative messages, VAPID and RFC 8291 encryption, reading pushes in the service worker, and clearing notifications within the rules iOS enforces. It is published to npm and runs in Node, Bun, Deno, Cloudflare Workers, pages and service workers, so it has to be small, typed and dependable for code that reminds people of things.

## Commands

Bun is the only package manager and script runner. Never use npm, pnpm or yarn. Formatting is oxfmt and linting is oxlint; do not add Prettier, ESLint or editor config files.

| Task                     | Command         |
| ------------------------ | --------------- |
| Install                  | `bun install`   |
| Format                   | `bun run fmt`   |
| Lint (type-aware oxlint) | `bun run lint`  |
| Unused code and deps     | `bun run knip`  |
| Typecheck (tsgo)         | `bun run check` |
| Test                     | `bun run test`  |
| Build `dist/`            | `bun run build` |

`bun run fmt:check`, `bun run lint`, `bun run knip`, `bun run check`, `bun run test` and `bun run build` must all pass before every push. CI runs the same steps.

## Layout

```
src/index.ts   the message format, for every runtime: types, PushSubscriptionKeys, declarativeMessage
src/server     VAPID keys and JWTs, encryption, the push service allowlist, send
src/worker     the service worker: readPush, showUnlessOnScreen, waitUntilWithin
src/client     the page: subscribe, permission, clearNotifications
src/tray.ts    closing notifications by tag, shared by worker and client
src/*.ts       small helpers shared by the entries (base64url, guards)
scripts        the build
test           bun tests
docs/findings  device sessions (date, method, every observation)
```

Each folder under `src` is one subpath export, with its own tsconfig lib: `src/tsconfig.json` checks the root, `server` and `worker` against `WebWorker` alone, so nothing Node- or Bun-specific slips in, and `src/client/tsconfig.json` checks the page code against `DOM`. Code imported by tests is typed structurally (`Tray`, `PushEventLike`, `Subscriber`), so it also checks under Bun's types and accepts fakes.

## Architecture invariants

- Zero runtime dependencies. Only WebCrypto, `fetch`, `atob`/`btoa` and the Notifications and Push APIs. Nothing that Node 22.1, Workers or Safari 16.4 lacks (no `Uint8Array.fromBase64`, no `URL.parse` outside `src/server`).
- The library provides mechanisms; apps keep policy. What a tag means, when a notification is settled, how often to resend, where receipts go and how a subscription reaches the server all belong to the app.
- `send` only contacts the push services in `src/server/services.ts`, and that table also says whether a service replaces by tag. Subscriptions are client input; the allowlist is a security boundary.
- `send` throws only for mistakes in the call (unknown endpoint, bad option, oversized payload). Everything the push service or network does is a `SendResult`.
- Messages are validated once: `declarativeMessage` when building, `readPush` when receiving. Nothing downstream re-checks.
- `mutable` and `app_badge` sit beside `notification`, where WebKit reads them.
- iOS rules are encoded where they apply and documented in `docs/findings`: `close()` is ignored for 30 s (so `clearNotifications` tries again at 31 s), declarative notifications lose `data` in `getNotifications()` (so clearing goes by tag), and a declarative notification waits for its push event (so `waitUntilWithin` bounds the work).
- Every export is part of the published API. Adding one is a minor version, changing one a major.

## Device work

- Probe iOS and other browsers on real devices, record each session in `docs/findings/` (date, method, every observation, with WebKit or Chromium references where the source explains it), then fold confirmed facts into the README's iOS behaviour table.
- Never assume a platform rule from a spec alone; Safari diverges.

## Privacy

This repository is public. It must never contain anything that identifies a person, a device or a deployment: no names, lab or app URLs, hostnames, tokens, push endpoints, subscription keys or account ids.

## Code standards

The bar is the [thermo-nuclear code quality review](https://github.com/cursor/plugins/blob/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md). In short:

- **Comments are rare.** Write code that does not need them. Only comment a non-obvious _why_ (a platform quirk, a spec requirement). Public exports get one short doc comment saying what a caller must know. Never narrate what the next line does, never leave section banners, TODOs without an issue, or commented-out code.
- **No duplication.** Before writing a helper, search for an existing one. Two copies of the same logic is a bug.
- **Direct and boring.** No speculative abstraction, no pass-through wrappers, no clever indirection. Delete layers rather than polish them. Look for the restructure that makes branches disappear.
- **Types are the contract.** No `any`. Avoid `unknown` except at a validated boundary, avoid casts, avoid optionality that hides an invariant. Validate untrusted input once, at the edge, into a typed value.
- **No spaghetti.** Do not bolt special-case `if`s onto unrelated flows. Model the difference (a table, a union, a dedicated module) instead.
- **Small focused files.** Treat 300 lines as a prompt to split, and never let a file pass 1000 lines.
- **Parallel and atomic.** Run independent async work concurrently.
- **Fail loudly.** No silent catch-and-continue. Expected failures are typed results. Unexpected ones surface.
- **No dependencies.** Runtime dependencies are not allowed; a dev dependency needs a reason in the PR description.

## Testing

A test exists to catch a bug that would hurt someone: a notification that never arrives, arrives twice, or will not go away.

- **Write one for:** encryption interop against the reference `http_ece`, the VAPID JWT, the endpoint allowlist, message validation, reading pushes both ways, and the clearing retry.
- **Never write one that:** restates the code, covers what types or lint guarantee, depends on real timers or a network, or needs a device.
- **Prefer one table-driven test over many small ones.** A test file longer than the code it covers is a smell.

## Workflow

- Small changes go straight to `main`: docs, findings, config, and small fixes. Every check must still pass before pushing.
- Big changes (a new export, a behaviour change, anything touching encryption, VAPID or the allowlist) go on a branch as a PR, are reviewed by an independent agent against the code standards above, and are squash-merged once the reviewer has no remaining structural objections.
- Conventional Commits for every commit and PR title (`feat(server): …`, `fix(worker): …`, `docs: …`).
- Releases: bump `version`, tag `vX.Y.Z`, `bun publish` (which builds `dist/` first).
