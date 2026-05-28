.PHONY: dev install

PYTHON := .venv/bin/python
PIP := .venv/bin/pip
UVICORN := .venv/bin/uvicorn

dev:
	$(UVICORN) app.main:app --reload --host 127.0.0.1 --port 8000

install:
	$(PIP) install -r requirements.txt

migrate:
	$(PYTHON) -m alembic revision --autogenerate -m "Auto migration"
	$(PYTHON) -m alembic upgrade head
