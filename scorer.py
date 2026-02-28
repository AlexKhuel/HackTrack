import pandas as pd
from sqlalchemy import null
from main import load_events

def compute_prize_score(): #Prize score based on the prize pool, normalized by the maximum prize pool among feasible events
    #feasible = df[df["is_feasible"]]
    feasible = load_events()
    max_prize = feasible["prize_pool"].max()

    if max_prize == 0:
        return pd.Series(0, index=df.index)

    return df["prize_pool"] / max_prize


def prize_to_cost_score():
    df = load_events()
    #need trip cost data from person 2, then we can compute a score based on the ratio of prize to cost, normalized by the maximum ratio among feasible events
    #normalize at the end
def travel_time_score():
    #need trip data from person 2, "time" is the specific one per event
    
    travel_score = (max(time) - time)/(max_travel_time-min_travel_time)


def is_feasible(df):

    return 0