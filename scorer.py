import pandas as pd, numpy as np
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
    print(df.columns)

    # Compute nights of event
    df["nights"] = (
        pd.to_datetime(df["end_datetime_utc"]) -
        pd.to_datetime(df["start_datetime_utc"])
    ).dt.days
    #Some cities have no lodging info, we can impute the hotel cost with the average cost per night across all cities
    df["avg_cost_per_night"] = df["nightly_rate_x"].fillna(
        lodging["nightly_rate"].mean())
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


def scored(max_cost, max_time, origin_airports = None, friend_cities=None):
    if origin_airports is None:
        origin_airports = []
    if friend_cities is None:
        friend_cities = []
    max_time = max_time * 60 #Convert hours to minutes
    events = load_events()
    routes = load_routes()

    if origin_airports:
        routes = routes[routes["origin_airport"].isin(origin_airports)]
    # routes = (#In case of duplicates routes per city
    #     routes
    #     .groupby("destination_city", as_index=False)
    #     .agg({
    #         "avg_outbound_price": "mean",
    #         "avg_return_price": "mean",
    #         "avg_outbound_duration_minutes": "mean",
    #         "avg_return_duration_minutes": "mean"
    #     })
    # )
    #lodging = load_lodging()

    routes["total_flight_cost"] = (
        routes["avg_outbound_price"] +
        routes["avg_return_price"]
    )

    routes["total_flight_time"] = (
        routes["avg_outbound_duration_minutes"] +
        routes["avg_return_duration_minutes"]
    )

    # Keep cheapest route per destination city
    routes = (
        routes
        .sort_values("total_flight_cost")
        .groupby("destination_city", as_index=False)
        .first()
    )
    #In case no routes are found for the selected airports, return empty dataframe
    if routes.empty:
        print("No routes found for selected airports.")
        return pd.DataFrame()
    # Merge events + routes (match by city)
    df = events.merge(
        routes,
        left_on="city",
        right_on="destination_city",
        how="inner"
    )

    # Create total metrics
    lodging = load_lodging()

    # Merge on city
    df = df.merge(
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
    df["avg_cost_per_night"] = df["nightly_rate"]
    df["avg_cost_per_night"] = df["avg_cost_per_night"].fillna(lodging["nightly_rate"].mean())
    df["hotel_cost"] = df["avg_cost_per_night"] * df["nights"]

    df["total_cost"] = (
        df["avg_outbound_price"] +
        df["avg_return_price"] +
        df["hotel_cost"]
    )
    max_hackathon_cost = df["total_cost"].max()
    min_hackathon_cost = df["total_cost"].min()

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
    # 1️⃣ Log Prize Score (0–1)
    # -------------------------
    feasible_events["prize_pool"] = feasible_events["prize_pool"].fillna(0)
    log_prizes = np.log(feasible_events["prize_pool"].clip(lower=1))

    feasible_events["prize_score"] = (
        (log_prizes - log_prizes.min()) /
        (log_prizes.max() - log_prizes.min())
    )


    # -------------------------
    # 2️⃣ Prize-to-Total-Cost Score (0–1)
    # -------------------------

    feasible_events["total_cost"] = feasible_events["total_cost"].replace(0, 1e-6)  # avoid divide-by-zero
    feasible_events["cost_ratio"] = (
        feasible_events["prize_pool"] /
        feasible_events["total_cost"].replace(0, 1e-6)
    )
    
    max_ratio = feasible_events["cost_ratio"].max()
    min_ratio = feasible_events["cost_ratio"].min()

    if max_ratio == min_ratio:
        feasible_events["prize_to_total_cost_score"] = 0
    else:
        feasible_events["prize_to_total_cost_score"] = (
            (feasible_events["cost_ratio"] - min_ratio) /
            (max_ratio - min_ratio)
        )

    # -------------------------
    # 3️⃣ Prize-to-Hotel-Cost Score (0–1)
    # -------------------------
    # Example: compute nights if needed

    #feasible_events["prize_to_hotel_cost_score"] = prize_to_hotel_cost_score(feasible_events)

    # -------------------------
    # 4️⃣ Travel Time Score (0–1)
    # -------------------------
    feasible_events["travel_time_score"] = travel_time_score(feasible_events)

    # -------------------------
    # 4️⃣ Friend Bonus Score (0 OR 1)
    # -------------------------
    feasible_events["friend_bonus"] = (
    feasible_events["city"].isin(friend_cities)
).astype(int)



    # -------------------------
    # Final Weighted Score
    # -------------------------
    feasible_events["final_score"] = (
        0.5 * feasible_events["prize_score"] +
        0.3 * feasible_events["prize_to_total_cost_score"] +
        0.1 * feasible_events["travel_time_score"] +
        0.1 * feasible_events["friend_bonus"]
    )
    print(feasible_events.sort_values("final_score", ascending=False)[["name", "city", "prize_pool", "prize_score", "total_cost", "total_time", "travel_time_score", "friend_bonus", "final_score"]].drop_duplicates(subset=["name", "city"]))
    return feasible_events.sort_values("final_score", ascending=False).drop_duplicates(subset=["name", "city"])