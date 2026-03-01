from fastapi import FastAPI
from .feasibility_scorer import scored
from .database_client import update_user, load_events, load_routes, load_users, health_db_check
import os

app = FastAPI()

@app.get("/")
def root():
    return {
        "message": "HackTrack API is running 🚀",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/score")
def score_endpoint(max_cost: float, max_distance: float):
    return scored(max_cost, max_distance)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/health/db")
def health_db():
    return health_db_check()

@app.get("/debug-env")

def debug_env():
    return {"supabase_db_url_set": bool(os.getenv("SUPABASE_DB_URL"))}

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
def score_events(user_id: int, max_cost: float, max_time: float, friend_cities: list[str]):
    return scored(max_cost, max_time, friend_cities=friend_cities)
#Update user info in the database

@app.post("/update")
def update_user_route(
    user_id: int,
    max_cost: float,
    max_distance: float,
    friend_cities: list[str],
    primary_airport: str,
    secondary_airport: str,
    tertiary_airport: str,
):
    update_user(
        user_id,
        max_cost,
        max_distance,
        friend_cities,
        primary_airport,
        secondary_airport,
        tertiary_airport,
    )

    return {"status": "updated"}
