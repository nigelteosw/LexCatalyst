.PHONY: help setup db db-stop migrate dev backend frontend test

help: ## Show targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

setup: ## First-time install: env file, venv, backend + frontend deps
	@test -f backend/.env || cp backend/.env.example backend/.env
	@test -d backend/.venv || python3 -m venv backend/.venv
	$(MAKE) -C backend install
	cd frontend && bun install

db: ## Start Postgres (waits until healthy)
	docker compose up -d --wait postgres

db-stop: ## Stop Postgres (data is kept)
	docker compose down

migrate: db ## Apply Alembic migrations
	$(MAKE) -C backend migrate

backend: ## Run the API only (127.0.0.1:8000)
	$(MAKE) -C backend dev

frontend: ## Run the Vite dev server only
	cd frontend && bun run dev

dev: migrate ## Run everything: Postgres, migrations, API + frontend (Ctrl-C stops both)
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) -C backend dev & \
	(cd frontend && bun run dev) & \
	wait

test: ## Backend tests
	cd backend && .venv/bin/python -m pytest -q
