# CLAUDE.md

`@vectorplease/sdk`: the public TypeScript client for the Vector, Please API. MIT.

## Rules

- The API contract is `openapi/openapi.json`. It arrives by automated PR; never edit it by hand.
  Regenerate types with `pnpm generate` after it changes.
- Only the public API may appear here. Never import, name, or describe any non-public package or
  service internals. CI fails on it (`pnpm leak-guard`).
- Every change ships tests: unit tests with a fake `fetch`, and contract tests against the mock
  server built from the spec (`pnpm test:contract`). Never weaken a test to make it pass.
- Conventional Commits. Feature work goes through a PR. Add a changeset for anything users see.
- Never publish to npm or change repo settings; a human does that.

## Commands

```
pnpm install
pnpm generate          # types from openapi/openapi.json
pnpm lint && pnpm typecheck && pnpm test && pnpm test:contract
pnpm build
```
