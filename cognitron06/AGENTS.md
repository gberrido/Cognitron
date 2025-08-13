# Repository Guidelines

## Project Structure & Module Organization
- `server/`: FastAPI backend. Source in `server/src` (`api/`, `core/`, `services/`, `models/`). Tests in `server/tests`.
- `client/`: Node.js CLI SDK. Code in `client/src` (`core/`, `cli/`, `auth/`, `chat/`, `memory/`, `models/`, `config/`, `ui/`). Binaries defined in `client/package.json` (e.g., `cognitron06`).
- `docs/`: API and quick-start guides. `shared/`: future shared types/utils. `deploy/` and `docker-compose.yml`: deployment.

## Build, Test, and Development Commands
- Server setup: `cd server && python -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt`.
- Run server (dev): `uvicorn src.main:app --reload --port 8000` (OpenAPI at `/docs`).
- Server tests: `pytest -m "not slow"` (markers: `unit`, `integration`, `websocket`, `memory`, `api`).
- Lint/format (Python): `ruff check src && black src`.
- Client install: `cd client && npm install`.
- Run CLI: `node src/cli.js chat`, `npm run dev` (verbose), or `npx cognitron06` if linked.
- Client tests: `npm test`. Lint: `npm run lint`.

## Coding Style & Naming Conventions
- Python: 4-space indent, type hints where practical. Black + Ruff. Modules `snake_case`, classes `PascalCase`, functions/vars `snake_case`.
- JavaScript (ESM): 2-space indent. Files `kebab-case` or `camelCase.js` under `src`. Variables/functions `camelCase`, classes `PascalCase`. CLI flags are kebab-cased and descriptive.

## Testing Guidelines
- Python: `pytest` with markers; prefer `unit` for core, `integration` for API/WS. Optional coverage: `pytest --cov=src --cov-report=term-missing` (target ≥80%).
- Node: tests in `client/tests/*.test.js`; run with `npm test`.
- Name tests clearly; keep fixtures in `server/tests/conftest.py` where applicable.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat: add websocket streaming`, `fix(server): guard null memory`). Use imperative mood.
- PRs: describe scope, link issues, include a test plan (commands + expected output), and screenshots/logs for CLI changes. Update `docs/` if APIs or flags change.

## Security & Configuration Tips
- Never commit secrets. Copy `.env.example` to `.env` and set `GROQ_API_KEY`.
- Tighten CORS for production in `server/src/main.py`.
- Required runtime config lives in `server/src/core/config.py`. For containers: `docker-compose up -d`.

