from fastapi import FastAPI
from sqlalchemy import create_engine, text
import os

app = FastAPI()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

engine = create_engine(DATABASE_URL)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/health/db")
def health_db():
    try:
        with engine.connect():
            return {"db": "connected"}
    except Exception as e:
        return {"db": str(e)}
@app.get("/debug-env")
def debug_env():
    return {"database_url_set": bool(os.getenv("DATABASE_URL"))}
@app.get("/events")
def get_events():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM events"))
        rows = result.fetchall()

    return [dict(row._mapping) for row in rows]
