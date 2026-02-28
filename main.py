from fastapi import FastAPI
from sqlalchemy import create_engine, text
import os
import pandas as pd
from scorer import scored

app = FastAPI()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

engine = create_engine(DATABASE_URL)

def load_events():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM events"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())

def load_routes():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM routes"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())
    
def load_users():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM users"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())
def filter_feasible(df, max_cost, max_distance):#Pass max_cost and max_distance from frontend
    return df[
        (df["estimated_cost"] <= max_cost) &
        (df["travel_time"] <= max_distance)
    ]


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
@app.get("/routes")
def get_routes():
    df = load_routes()
    return df.to_dict(orient="records")
@app.get("/users")
def get_users():
    df = load_users()  
    return df.to_dict(orient="records")

#Receiving user inputs
@app.get("/input")
def score_events(max_cost: float, max_distance: float):
    return scored(max_cost, max_distance)