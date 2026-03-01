import os
import argparse
import requests
import json
import time
from collections import defaultdict
from datetime import datetime, timedelta
from dotenv import load_dotenv

def fetch_aerodatabox_departures(api_key, origin_iata, date_str):
    """
    Fetch scheduled departures for a given origin airport on a specific date using AeroDataBox via RapidAPI.
    The FIDS endpoint often restricts the time window to 12 hours per request.
    We make two requests: 00:00-11:59 and 12:00-23:59 for the given date.
    
    date_str format: 'YYYY-MM-DD'
    """
    base_url = f"https://aerodatabox.p.rapidapi.com/flights/airports/iata/{origin_iata}"
    
    headers = {
        "x-rapidapi-key": api_key,
        "x-rapidapi-host": "aerodatabox.p.rapidapi.com"
    }
    
    querystring = {
        "withLeg": "true",
        "direction": "Departure",
        "withCancelled": "false",
        "withCodeshared": "true",
        "withCargo": "false",
        "withPrivate": "false",
        "withLocation": "false"
    }
    
    # 12-hour windows
    windows = [
        (f"{date_str}T00:00", f"{date_str}T11:59"),
        (f"{date_str}T12:00", f"{date_str}T23:59")
    ]
    
    all_departures = []
    
    for idx, (start_time, end_time) in enumerate(windows):
        url = f"{base_url}/{start_time}/{end_time}"
        
        # Add a small delay between the two 12-hour window requests to avoid per-second rate limit
        if idx > 0:
            time.sleep(1.5)
            
        try:
            response = requests.get(url, headers=headers, params=querystring, timeout=15)
            
            # 429 is Rate Limit, 401/403 is Auth error
            if response.status_code in [429, 401, 403]:
                print(f"  [API Error {response.status_code}]: {response.text}")
                return None  # Signal to halt execution
                
            if response.status_code == 200:
                data = response.json()
                departures = data.get('departures', [])
                all_departures.extend(departures)
            elif response.status_code == 204:
                # 204 No Content means no flights found in this window
                pass
            else:
                print(f"  [Unexpected Status {response.status_code}] for {origin_iata}: {response.text}")
                
        except Exception as e:
            print(f"  [Request Failed {origin_iata}]: {e}")
            return None
            
    return all_departures

def main():
    parser = argparse.ArgumentParser(description="Fetch flights by origin using AeroDataBox and merge.")
    parser.add_argument("--input", required=True, help="Path to input routes JSON")
    parser.add_argument("--output", required=True, help="Path to output merged JSON")
    parser.add_argument("--limit", type=int, default=5, help="Max unique origins to query (default 5 for testing).")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds to delay between API requests.")
    parser.add_argument("--force", action="store_true", help="Force re-querying even if already marked as queried or has flights.")
    
    args = parser.parse_args()
    
    load_dotenv()
    
    api_key = os.environ.get("AERODATABOX_API_KEY")
    if not api_key:
        print("Error: AERODATABOX_API_KEY environment variable not set in .env")
        return
        
    # Read routes
    with open(args.input, 'r', encoding='utf-8') as f:
        routes = json.load(f)
        
    print(f"Loaded {len(routes)} routes.")
    
    # 1. Group routes by origin
    routes_by_origin = defaultdict(list)
    for route in routes:
        if 'scheduled_flights' not in route:
            route['scheduled_flights'] = []
            
        origin = route.get('origin_airport')
        if origin:
            routes_by_origin[origin].append(route)
            
    unique_origins = list(routes_by_origin.keys())
    queried_origins = set()
    
    for origin, route_list in routes_by_origin.items():
        # Skip an origin if we already queried it completely with AeroDataBox
        has_aerodatabox_tag = all(r.get('_aerodatabox_queried') for r in route_list)
        # Skip an origin if ALL of its routes already have scheduled flights
        has_flights = all(len(r.get('scheduled_flights', [])) > 0 for r in route_list)
        
        if not args.force:
            if has_aerodatabox_tag or has_flights:
                queried_origins.add(origin)
            
    print(f"Found {len(unique_origins)} unique origin airports.")
    if queried_origins:
        print(f"Skipping {len(queried_origins)} origins that were already successfully queried.")
        
    unqueried_origins = [o for o in unique_origins if o not in queried_origins]
    
    if args.limit > 0 and args.limit < len(unqueried_origins):
        print(f"Limiting execution to the next {args.limit} unqueried origin airports to save API credits.")
        origins_to_query = unqueried_origins[:args.limit]
    else:
        origins_to_query = unqueried_origins
        
    total_queries = len(origins_to_query)
    
    # Choose a Friday to fetch flights for (next Friday from today's date)
    today = datetime.now()
    days_ahead = 4 - today.weekday()
    if days_ahead <= 0:
        days_ahead += 7
    next_friday = (today + timedelta(days_ahead)).strftime("%Y-%m-%d")
    
    print(f"Fetching AeroDataBox FIDS schedules for Friday: {next_friday}")
        
    # 3. Query AeroDataBox by origin
    flights_added = 0
    flights = None
    
    for i, origin in enumerate(origins_to_query):
        print(f"[{i+1}/{total_queries}] Fetching all departures from {origin}...")
        
        flights = fetch_aerodatabox_departures(api_key, origin, next_friday)
        
        if flights is None:
            print("\nAPI Limit or Error encountered. Halting further queries to safely save progress.")
            break
            
        print(f"  -> Got {len(flights)} active flights.")
        
        matches_for_origin = 0
        for flight in flights:
            movement = flight.get('departure', {})
            arr = flight.get('arrival', {})
            
            arr_iata = arr.get('airport', {}).get('iata')
            dep_scheduled_utc = movement.get('scheduledTime', {}).get('utc')
            arr_scheduled_utc = arr.get('scheduledTime', {}).get('utc')
            
            if not dep_scheduled_utc or not arr_scheduled_utc or not arr_iata:
                continue
                
            # Ensure UTC format (Z)
            if not dep_scheduled_utc.endswith('Z'): dep_scheduled_utc += 'Z'
            if not arr_scheduled_utc.endswith('Z'): arr_scheduled_utc += 'Z'
                
            # Find the route this flight belongs to
            target_route = None
            for r in routes_by_origin[origin]:
                if r.get('destination_airport') == arr_iata:
                    target_route = r
                    break
                    
            if target_route:
                # Standardize format to match what our load_routes.js expects (ISO string with datetime)
                # Note: AeroDataBox 'local' is roughly 'YYYY-MM-DD HH:MMZ', we'll store as string
                simplified_flight = {
                    'airline': flight.get('airline', {}).get('name'),
                    'departure_scheduled': dep_scheduled_utc,
                    'arrival_scheduled': arr_scheduled_utc
                }
                target_route['scheduled_flights'].append(simplified_flight)
                matches_for_origin += 1
                flights_added += 1
                
        print(f"  -> Mapped {matches_for_origin} flights to known routes.")
        
        # Mark all routes from this origin as queried
        for r in routes_by_origin[origin]:
            r['_aerodatabox_queried'] = True
            
        # Delay to respect limits (AeroDataBox is usually strict on free tiers, eg. 2 requests/sec)
        if i < total_queries - 1:
            time.sleep(args.delay)
            
    # Save output
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(routes, f, indent=2)
        
    print(f"\nSuccessfully attached {flights_added} real flight schedules across {len(origins_to_query) if flights is not None else i} origins.")
    print(f"Saved merged dataset to {args.output}")

if __name__ == "__main__":
    main()
