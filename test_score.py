from scorer import scored

if __name__ == "__main__":
    result = scored(max_cost=10000, max_time=60000)
    print(result.head())