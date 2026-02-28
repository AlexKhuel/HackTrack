from fastapi import FastAPI
from sqlalchemy import create_engine, text
import os
import pandas as pd

app = FastAPI()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

engine = create_engine(DATABASE_URL)

def load_events():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM events"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())

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
    df = load_events()
    return df.to_dict(orient="records")
