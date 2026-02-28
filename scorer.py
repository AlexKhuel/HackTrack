import pandas as pd


def compute_prize_score(df):
    feasible = df[df["is_feasible"]]
    max_prize = feasible["prize_pool"].max()

    if max_prize == 0:
        return pd.Series(0, index=df.index)

    return df["prize_pool"] / max_prize

def is_feasible(df):

    return result