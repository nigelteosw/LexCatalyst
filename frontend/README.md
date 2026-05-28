# LexCatalyst Frontend

React + Vite + TypeScript frontend for the LexCatalyst legal search UI.

Create a local env file if the backend is not running on the default URL:

```sh
cp .env.example .env
```

## Commands

```sh
bun install
bun run dev
bun run lint
bun run build
```

The current app connects to the FastAPI backend at `VITE_API_URL`, streams chat/search prompts through `/chat/stream`, and loads persisted threads from local Postgres through the backend.

Keep the UI focused on real backend data. Do not reintroduce mock documents, memory cards, or sidebar-only demo content.
