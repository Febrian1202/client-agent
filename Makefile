.PHONY: help up up-build down down-v restart ps logs logs-api logs-worker logs-web \
        db-up db-down db-migrate db-generate db-seed \
        dev dev-api dev-worker dev-web build test typecheck clean

COMPOSE = docker compose -f infrastructure/docker-compose.yml

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Available Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Start all services in background (Postgres, Redis, API, Worker, Web)
	$(COMPOSE) up -d

up-build: ## Build and start all services in background
	$(COMPOSE) up -d --build

down: ## Stop and remove all containers
	$(COMPOSE) down

down-v: ## Stop containers and remove volumes (resets database)
	$(COMPOSE) down -v

restart: ## Restart all containers
	$(COMPOSE) restart

ps: ## View running container status
	$(COMPOSE) ps

logs: ## Follow logs from all containers
	$(COMPOSE) logs -f

logs-api: ## Follow API logs
	$(COMPOSE) logs -f api

logs-worker: ## Follow Worker logs
	$(COMPOSE) logs -f worker

logs-web: ## Follow Web dashboard logs
	$(COMPOSE) logs -f web

db-up: ## Start only Postgres and Redis containers
	$(COMPOSE) up -d postgres redis

db-down: ## Stop Postgres and Redis containers
	$(COMPOSE) stop postgres redis

db-migrate: ## Run database migrations
	bun run --filter=@client-agent/db db:migrate

db-generate: ## Generate Drizzle migration files from schema
	bun run --filter=@client-agent/db db:generate

db-seed: ## Run database seed script
	bun run --filter=@client-agent/db seed

dev: ## Run all apps concurrently on host
	bun dev

dev-api: ## Run Elysia API on host
	bun run dev:api

dev-worker: ## Run Bun Worker on host
	bun run dev:worker

dev-web: ## Run SvelteKit Dashboard on host
	bun run dev:web

build: ## Build all workspaces
	bun run build

test: ## Run tests across all workspaces
	bun test

typecheck: ## Run type checking across all workspaces
	bun run typecheck

clean: ## Remove build artifacts and temporary files
	rm -rf apps/web/.svelte-kit apps/web/build
