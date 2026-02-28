from fastapi import FastAPI
from sqlalchemy import create_engine, text
import os
import pandas as pd
app = FastAPI()
from dotenv import load_dotenv
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("DATABASE_URL is not set")

engine = create_engine(DATABASE_URL)

def health_db_check():
    try:
        with engine.connect():
            return {"db": "connected"}
    except Exception as e:
        return {"db": str(e)}

def filter_feasible(df, max_cost, max_distance):#Pass max_cost and max_distance from frontend
    return df[
        (df["estimated_cost"] <= max_cost) &
        (df["travel_time"] <= max_distance)
    ]


def load_events():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM events"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())

def load_routes():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM routes"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())
def load_lodging():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM lodging"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())
    
def load_users():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT * FROM users"))
        return pd.DataFrame(result.fetchall(), columns=result.keys())
    
def update_user(
    user_id,
    max_cost,
    max_distance,
    friend_cities,
    primary_airport,
    secondary_airport,
    tertiary_airport,
):
    with engine.connect() as conn:
        conn.execute(
            text("""
                UPDATE users
                SET max_cost = :max_cost,
                    max_distance = :max_distance,
                    friend_cities = :friend_cities,
                    primary_airport = :primary_airport,
                    secondary_airport = :secondary_airport,
                    tertiary_airport = :tertiary_airport
                WHERE id = :user_id
            """),
            {
                "user_id": user_id,
                "max_cost": max_cost,
                "max_distance": max_distance,
                "friend_cities": ",".join(friend_cities),
                "primary_airport": primary_airport,
                "secondary_airport": secondary_airport,
                "tertiary_airport": tertiary_airport,
            },
        )