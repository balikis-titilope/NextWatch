# NextWatch

## Stack

- **Two areas**: `mobile/` (Expo/React Native/TypeScript app, built through this workflow) and `backend/` (FastAPI/Python service, pre-workflow, existing).
- **Mobile**: Expo Router, TypeScript strict, NativeWind v4, Zustand, TanStack Query v5 — full stack decided in [docs/specs/0001-mobile-stack-architecture/index.md](docs/specs/0001-mobile-stack-architecture/index.md); conventions live in `mobile/AGENTS.md`.
- **Backend**: FastAPI, Pydantic, Supabase (Postgres + Auth via JWT), scikit-learn / sentence-transformers for the recommendation engine, pandas/numpy, TMDB fetching — see `backend/`. Predates this workflow; intentionally undocumented here (see `## Rules`).
- **Package managers**: npm (mobile), pip (backend).

## Build approach

Journey — each phase is one complete user journey, built fully (every step, edge case, and state) before the next one starts. (from `docs/scope/scope.md`)

## Commands

```bash
# Mobile: install
cd mobile && npm install

# Mobile: dev server
cd mobile && npm start

# Mobile: typecheck / test
cd mobile && npm run typecheck
cd mobile && npm test

# Backend: install
cd backend && pip install -r requirements.txt

# Backend: run
cd backend && python main.py
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`.

## Rules

- Mobile architecture, styling, state, and TypeScript conventions are fully defined in `mobile/AGENTS.md` — read it before touching `mobile/`.
- Mobile tooling (decided in this `/audit` pass, installed by `/develop tooling`): ESLint + Prettier (`eslint-config-expo` base) for lint/format; Husky + lint-staged running lint, format, and typecheck before every commit; Jest + jest-expo + `@testing-library/react-native` (already installed) as the testing convention; GitHub Actions CI running lint, typecheck, and test on push.
- Mobile code standards: a consistent error handling pattern for API/network errors (not ad hoc `try/catch` per screen); validate required env vars (e.g. `EXPO_PUBLIC_API_BASE_URL`) at startup; Conventional Commit messages (`feat:`, `fix:`, `chore:`, …).
- `backend/` predates this workflow, has no linting/formatting/CI configured, and is intentionally out of scope for `/develop` and `/sync` (tagged `existing` in `docs/scope/scope.md`, feature A).

## Agent skills

- [github-actions-templates](.agents/skills/github-actions-templates/): `wshobson/agents`, GitHub Actions CI workflow templates — matches the CI decision in `## Rules`.
- [fastapi-templates](backend/.agents/skills/fastapi-templates/): `wshobson/agents`, FastAPI architecture/template patterns for `backend/`.
- [supabase](backend/.agents/skills/supabase/): `supabase/agent-skills`, Supabase auth and client patterns for `backend/`.
- [supabase-postgres-best-practices](backend/.agents/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, Postgres schema/query best practices for `backend/`.

MCP servers: Expo MCP server (recommended — connect via https://docs.expo.dev/mcp/ or your MCP/connector settings; not connected yet)

## Context files

- [mobile/AGENTS.md](mobile/AGENTS.md): Expo/React Native mobile app — architecture, styling, state, TypeScript, and (pending) tooling conventions.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
