from fastapi import FastAPI

app = FastAPI(title="LexCatalyst API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

