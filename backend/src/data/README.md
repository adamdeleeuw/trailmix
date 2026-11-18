# TransLink station seed

`translink-stations.json` is generated from TransLink's [static GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip).
It includes only GTFS parent stations (`location_type=1`) with at least 24 scheduled
departures on one active weekday during the feed's validity period. A station's
weekday count is calculated from its own stop times and those of child stops, counting
each trip once per weekday; `frequencies.txt` service is expanded by its scheduled
headway. This excludes ordinary individual bus stops while retaining high-service
interchange stations.

To refresh the seed, run from the repository root:

```powershell
python scripts\generate-translink-stations.py
```

The script downloads the latest feed and writes the station list. Counts are based on
the feed's own `feed_info.txt` date range (or the calendar range when feed metadata is
absent), so processing the same archive produces the same result regardless of when
the generator runs. To reproduce from an already downloaded feed or adjust the service
threshold:

```powershell
python scripts\generate-translink-stations.py --feed path\to\google_transit.zip --minimum-weekday-departures 24
```

The threshold is a generation-time filter; review generated changes before committing
them because TransLink publishes updated schedules regularly. GTFS data is provided by
permission of TransLink and is subject to its [GTFS terms of use](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data).

## Candidate discovery and fallback

The backend ranks seeded stations by straight-line cycling distance to the chosen
cycling endpoint and their offset from the origin-destination corridor. It excludes
stations that are outside the configured distance, beyond the journey segment, or
whose added journey detour exceeds that distance. Google Places Nearby Search is used
only when the seed cannot fill the requested candidate count; results must have valid
coordinates and a transit-station type (bus-only stops are rejected). Places results
are cached for five minutes and duplicate locations are removed. If Places is
unconfigured, unavailable or empty, the service returns the seeded candidates it found.

`MAX_BICYCLE_LEG_DISTANCE_METERS` defaults to `5000` and limits both station search
and routed bicycle legs. For backwards compatibility, the previous
`BIKE_STATION_MAX_CYCLING_DISTANCE_METERS` setting is still used if the new setting
is absent. `BIKE_STATION_CANDIDATE_COUNT` defaults to `3`.
`BIKE_TO_TRANSIT_BUFFER_SECONDS` and `TRANSIT_TO_BIKE_BUFFER_SECONDS` each default to
`120` seconds. Set `GOOGLE_PLACES_API_KEY` to enable
the fallback; it should be restricted to the Places API.
