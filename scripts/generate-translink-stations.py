#!/usr/bin/env python3
"""Generate the frequent TransLink station seed from its current static GTFS feed."""

import argparse
import csv
import datetime as dt
import io
import json
import math
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path


FEED_URL = "https://gtfs-static.translink.ca/gtfs/google_transit.zip"
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday")


def read_csv(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    try:
        content = archive.read(name)
    except KeyError:
        return []
    return list(csv.DictReader(io.TextIOWrapper(io.BytesIO(content), encoding="utf-8-sig", newline="")))


def valid_service_calendar(row: dict[str, str], feed_start: dt.date, feed_end: dt.date) -> bool:
    start = dt.datetime.strptime(row["start_date"], "%Y%m%d").date()
    end = dt.datetime.strptime(row["end_date"], "%Y%m%d").date()
    return start <= feed_end and end >= feed_start


def generate(archive: zipfile.ZipFile, minimum_weekday_departures: int) -> dict[str, object]:
    feed_info = read_csv(archive, "feed_info.txt")
    calendars = read_csv(archive, "calendar.txt")
    if feed_info and feed_info[0].get("feed_start_date") and feed_info[0].get("feed_end_date"):
        feed_start = dt.datetime.strptime(feed_info[0]["feed_start_date"], "%Y%m%d").date()
        feed_end = dt.datetime.strptime(feed_info[0]["feed_end_date"], "%Y%m%d").date()
    elif calendars:
        feed_start = min(dt.datetime.strptime(row["start_date"], "%Y%m%d").date() for row in calendars)
        feed_end = max(dt.datetime.strptime(row["end_date"], "%Y%m%d").date() for row in calendars)
    else:
        raise ValueError("GTFS feed must contain feed_info.txt dates or calendar.txt")
    stations = {
        row["stop_id"]: row
        for row in read_csv(archive, "stops.txt")
        if row.get("location_type") == "1"
    }
    stops = {row["stop_id"]: row for row in read_csv(archive, "stops.txt")}
    service_weekdays = {
        row["service_id"]: {day for day in WEEKDAYS if row.get(day) == "1"}
        for row in calendars
        if valid_service_calendar(row, feed_start, feed_end)
    }
    trips = {
        row["trip_id"]: row["service_id"]
        for row in read_csv(archive, "trips.txt")
        if row["service_id"] in service_weekdays
    }
    frequencies = defaultdict(int)
    for row in read_csv(archive, "frequencies.txt"):
        try:
            start = int(row["start_time"].split(":")[0]) * 3600 + int(row["start_time"].split(":")[1]) * 60 + int(row["start_time"].split(":")[2])
            end = int(row["end_time"].split(":")[0]) * 3600 + int(row["end_time"].split(":")[1]) * 60 + int(row["end_time"].split(":")[2])
            headway = int(row["headway_secs"])
        except (KeyError, ValueError):
            continue
        if headway > 0 and end > start:
            frequencies[row["trip_id"]] = max(1, math.ceil((end - start) / headway))

    station_trips: dict[str, list[dict[str, str]]] = defaultdict(lambda: [dict() for _ in WEEKDAYS])
    for row in read_csv(archive, "stop_times.txt"):
        service_id = trips.get(row["trip_id"])
        stop = stops.get(row["stop_id"])
        if service_id is None or stop is None:
            continue
        station_id = stop["stop_id"] if stop.get("location_type") == "1" else stop.get("parent_station", "")
        if station_id not in stations:
            continue
        for index, day in enumerate(WEEKDAYS):
            if day in service_weekdays[service_id]:
                station_trips[station_id][index][row["trip_id"]] = service_id

    result = []
    for station_id, row in stations.items():
        weekday_counts = [
            sum(frequencies.get(trip_id, 1) for trip_id in trips_by_day)
            for trips_by_day in station_trips[station_id]
        ]
        departures = max(weekday_counts, default=0)
        if departures < minimum_weekday_departures:
            continue
        try:
            lat, lng = float(row["stop_lat"]), float(row["stop_lon"])
        except (KeyError, ValueError):
            continue
        if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
            continue
        result.append({
            "id": station_id,
            "name": row["stop_name"].strip(),
            "lat": lat,
            "lng": lng,
            "weekdayDepartures": departures,
        })

    result.sort(key=lambda station: (station["name"].casefold(), station["id"]))
    return {
        "source": FEED_URL,
        "minimumWeekdayDepartures": minimum_weekday_departures,
        "stations": result,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", help="Use a downloaded GTFS zip instead of fetching the latest feed.")
    parser.add_argument("--output", default="backend/src/data/translink-stations.json")
    parser.add_argument("--minimum-weekday-departures", type=int, default=24)
    args = parser.parse_args()
    if args.minimum_weekday_departures < 1:
        parser.error("--minimum-weekday-departures must be positive")

    if args.feed:
        archive = zipfile.ZipFile(args.feed)
    else:
        request = urllib.request.Request(FEED_URL, headers={"User-Agent": "Trailmix station seed generator"})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
    with archive:
        data = generate(archive, args.minimum_weekday_departures)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(data['stations'])} stations to {output}")


if __name__ == "__main__":
    main()
