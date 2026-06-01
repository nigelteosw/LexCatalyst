.PHONY: dev install migration migrate

PYTHON := $(shell if [ -x .venv/bin/python ]; then echo .venv/bin/python; else echo python; fi)
PIP := $(shell if [ -x .venv/bin/pip ]; then echo .venv/bin/pip; else echo pip; fi)
UVICORN := $(shell if [ -x .venv/bin/uvicorn ]; then echo .venv/bin/uvicorn; else echo uvicorn; fi)
ALEMBIC := $(shell if [ -x .venv/bin/alembic ]; then echo .venv/bin/alembic; else echo alembic; fi)

dev:
	$(UVICORN) app.main:app --reload --host 127.0.0.1 --port 8000

install:
	$(PIP) install -r requirements.txt

migration:
	$(ALEMBIC) revision --autogenerate -m "Auto migration"

migrate:
	$(ALEMBIC) upgrade head
