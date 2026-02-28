import pandas as pd
from sqlalchemy import null
from db import load_events, load_routes, load_users, load_lodging
from datetime import datetime

def nights(start_ts, end_ts):
    start = pd.to_datetime(start_ts).date()
    end = pd.to_datetime(end_ts).date()
    return max((end - start).days, 0)

def compute_prize_score(): #Prize score based on the prize pool, normalized by the maximum prize pool among feasible events
    #feasible = df[df["is_feasible"]]
    feasible = load_events()
    max_prize = feasible["prize_pool"].max()

    if max_prize == 0:
        return pd.Series(0, index=feasible.index)

    return feasible["prize_pool"] / max_prize


def prize_to_travel_cost_score():
    df = load_routes()
    cost = df["avg_outbound_cost"] + df["avg_return_cost"]
    max_cost = cost.max()
    min_cost = cost.min()
    if max_cost == min_cost:
        return pd.Series(0, index=df.index)
    return (max_cost - cost) / (max_cost - min_cost)

def prize_to_hotel_cost_score():
    df_lodging = load_lodging()
    df = load_users()
    df["nights"] = df.apply(lambda row: nights(row["start_ts"], row["end_ts"]), axis=1)
    cost = df_lodging["avg_cost_per_night"] * df["nights"]
    max_cost = cost.max()
    min_cost = cost.min()
    if max_cost == min_cost:
        return pd.Series(0, index=df.index)
    return (max_cost - cost) / (max_cost - min_cost)

def travel_time_score():
    df = load_routes()
    total_time = df["avg_outbound_duration"] + df["avg_return_duration"]
    max_travel_time = total_time.max()
    min_travel_time = total_time.min()
    if max_travel_time == min_travel_time:
        travel_score = pd.Series(0, index=df.index)
    else:
        travel_score = (max_travel_time - total_time) / (max_travel_time - min_travel_time)
    return travel_score

def filter_feasible(events, max_cost, max_distance):
    routes = load_routes()
    feasible = events.copy()
    feasible = feasible[(routes["avg_outbound_cost"] + routes["avg_return_cost"]) <= max_cost]
    feasible = feasible[(routes["avg_outbound_duration"] + routes["avg_return_duration"]) <= max_distance]
    return feasible

def scored(max_cost, max_distance):
    events = load_events()
    routes = load_routes()
    users = load_users()

    # Filter feasible events based on cost and distance
    feasible_events = filter_feasible(events, max_cost, max_distance)

    # Compute scores for each criterion
    feasible_events["prize_score"] = compute_prize_score()
    feasible_events["prize_to_travel_cost_score"] = prize_to_travel_cost_score()
    feasible_events["prize_to_hotel_cost_score"] = prize_to_hotel_cost_score()
    feasible_events["travel_time_score"] = travel_time_score()

    # Combine scores into a final score (you can adjust weights as needed)
    feasible_events["final_score"] = (
        0.4 * feasible_events["prize_score"] +
        0.3 * feasible_events["prize_to_travel_cost_score"] +
        0.2 * feasible_events["prize_to_hotel_cost_score"] +
        0.1 * feasible_events["travel_time_score"]
    )

    return feasible_events.sort_values(by="final_score", ascending=False)