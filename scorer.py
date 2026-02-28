import pandas as pd
from sqlalchemy import null
from db import load_events, load_routes, load_users, load_lodging
from datetime import datetime

def nights(start_ts, end_ts):
    start = pd.to_datetime(start_ts).date()
    end = pd.to_datetime(end_ts).date()
    return max((end - start).days, 0)

def compute_prize_score(df): #Prize score based on the prize pool, normalized by the maximum prize pool among feasible events
    #feasible = df[df["is_feasible"]]
    feasible = df
    max_prize = feasible["prize_pool"].max()

    if max_prize == 0:
        return pd.Series(0, index=feasible.index)

    return feasible["prize_pool"] / max_prize


def prize_to_travel_cost_score(feasible_events):
    max_cost_val = feasible_events["total_cost"].max()
    min_cost_val = feasible_events["total_cost"].min()

    if max_cost_val == min_cost_val:
        feasible_events["prize_to_travel_cost_score"] = 0
    else:
        feasible_events["prize_to_travel_cost_score"] = (
            (max_cost_val - feasible_events["total_cost"]) /
            (max_cost_val - min_cost_val)
        )
    return feasible_events["prize_to_travel_cost_score"]


def prize_to_hotel_cost_score(feasible_events):

    lodging = load_lodging()

    # Merge on city
    df = feasible_events.merge(
        lodging,
        on="city",
        how="left"
    )

    # Compute nights of event
    df["nights"] = (
        pd.to_datetime(df["end_datetime_utc"]) -
        pd.to_datetime(df["start_datetime_utc"])
    ).dt.days
    #Some cities have no lodging info, we can impute the hotel cost with the average cost per night across all cities
    df["avg_cost_per_night"] = df["avg_cost_per_night"].fillna(lodging["avg_cost_per_night"].mean())
    df["hotel_cost"] = df["avg_cost_per_night"] * df["nights"]

    max_cost = df["hotel_cost"].max()
    min_cost = df["hotel_cost"].min()

    if max_cost == min_cost:
        df["prize_to_hotel_cost_score"] = 0
    else:
        df["prize_to_hotel_cost_score"] = (
            (max_cost - df["hotel_cost"]) /
            (max_cost - min_cost)
        )

    return df["prize_to_hotel_cost_score"]

def travel_time_score(feasible_events):
    total_time = feasible_events["total_time"]

    max_time = total_time.max()

    if max_time == 0:
        return pd.Series(0, index=feasible_events.index)

    return (max_time - total_time) / max_time

# def filter_feasible(events, max_cost, max_time):#Change the logic to filter by user_city and destination city
#     routes = load_routes()
#     feasible = events.copy()
#     feasible = feasible.merge(routes, left_on="city", right_on = "destination_city")                        #Find all routes to the event city
#     feasible = feasible[(feasible["avg_outbound_cost"] + feasible["avg_return_cost"]) <= max_cost]          #Only routes that are under the max cost 
#     feasible = feasible[(feasible["avg_outbound_duration"] + feasible["avg_return_duration"]) <= max_time]  #Only routes that are under the max time
#     return feasible


def scored(max_cost, max_time):

    events = load_events()
    routes = load_routes()
    #lodging = load_lodging()

    # Merge events + routes (match by city)
    df = events.merge(
        routes,
        left_on="city",
        right_on="destination_city",
        how="inner"
    )

    # Create total metrics
    df["total_cost"] = (
        df["avg_outbound_price"] +
        df["avg_return_price"]
    )

    df["total_time"] = (
        df["avg_outbound_duration_minutes"] +
        df["avg_return_duration_minutes"]
    )

    # Feasibility filter
    feasible_events = df[
        (df["total_cost"] <= max_cost) &
        (df["total_time"] <= max_time)
    ].copy()

    if feasible_events.empty:
        return feasible_events

    # -------------------------
    # 1️⃣ Prize Score (0–1)
    # -------------------------
    max_prize = feasible_events["prize_pool"].max()

    if max_prize > 0:
        feasible_events["prize_score"] = (
            feasible_events["prize_pool"] / max_prize
        )
    else:
        feasible_events["prize_score"] = 0

    # -------------------------
    # 2️⃣ Prize-to-Travel-Cost Score (0–1)
    # -------------------------
    feasible_events["prize_to_travel_cost_score"] = prize_to_travel_cost_score(feasible_events)

    # -------------------------
    # 3️⃣ Prize-to-Hotel-Cost Score (0–1)
    # -------------------------
    # Example: compute nights if needed

    feasible_events["prize_to_hotel_cost_score"] = prize_to_hotel_cost_score(feasible_events)

    # -------------------------
    # 4️⃣ Travel Time Score (0–1)
    # -------------------------
    feasible_events["travel_time_score"] = travel_time_score(feasible_events)

    # -------------------------
    # Final Weighted Score
    # -------------------------
    feasible_events["final_score"] = (
        0.4 * feasible_events["prize_score"] +
        0.3 * feasible_events["prize_to_travel_cost_score"] +
        0.2 * feasible_events["prize_to_hotel_cost_score"] +
        0.1 * feasible_events["travel_time_score"]
    )

    return feasible_events.sort_values("final_score", ascending=False)