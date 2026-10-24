#!/usr/bin/env python3
"""Pull monthly state unemployment (BLS LAUS, seasonally adjusted) into
pipeline/snapshots/state_laus.csv.

The twin assimilates one regional dial per state each month, so every state's
unemployment rate and labor force come from here. The BLS flat file is tried
first (one request for all states); FRED's copies of the same series are the
fallback. If both fail, the committed snapshot stays in charge and the script
exits 0, so an outage never breaks a deploy.

    python3 pipeline/refresh_states.py
"""

from __future__ import annotations

import csv
import io
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "pipeline", "snapshots", "state_laus.csv")
START_YEAR = 2000

STATES = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
    "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
    "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
    "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY",
}
UA = {"User-Agent": "EconTwin data refresh (https://github.com/ihelfrich/EconGames)"}
BLS_URL = "https://download.bls.gov/pub/time.series/la/la.data.3.AllStatesS"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2000-01-01"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def from_bls() -> dict[tuple[str, str], dict[str, float]]:
    """(month, fips) -> {"ur": rate in %, "lf": labor force in persons}."""
    text = fetch(BLS_URL)
    out: dict[tuple[str, str], dict[str, float]] = {}
    for line in text.splitlines()[1:]:
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) < 4:
            continue
        sid, year, period, value = parts[:4]
        # LASST + fips(2) + 11 zeros + measure(2); 03 = rate, 06 = labor force
        if not sid.startswith("LASST") or len(sid) != 20 or not period.startswith("M") or period == "M13":
            continue
        fips, measure = sid[5:7], sid[18:20]
        if fips not in STATES or measure not in ("03", "06") or int(year) < START_YEAR:
            continue
        try:
            v = float(value)
        except ValueError:
            continue
        key = (f"{year}-{period[1:]}", fips)
        out.setdefault(key, {})["ur" if measure == "03" else "lf"] = v
    return out


def from_fred() -> dict[tuple[str, str], dict[str, float]]:
    out: dict[tuple[str, str], dict[str, float]] = {}
    for fips, st in STATES.items():
        for field, sid in (("ur", f"{st}UR"), ("lf", f"{st}LF")):
            text = fetch(FRED_URL.format(sid=sid))
            for row in list(csv.reader(io.StringIO(text)))[1:]:
                if len(row) >= 2 and row[1] not in ("", "."):
                    # FRED labor force is in thousands of persons
                    v = float(row[1]) * (1000 if field == "lf" else 1)
                    out.setdefault((row[0][:7], fips), {})[field] = v
            time.sleep(0.2)
    return out


def main():
    data = {}
    for name, source in (("BLS", from_bls), ("FRED", from_fred)):
        try:
            data = source()
            months = {m for m, _ in data}
            print(f"{name}: {len(data)} state-months, {min(months)} to {max(months)}")
            if len({f for _, f in data}) == len(STATES):
                break
            print(f"{name}: missing states, trying the next source", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 - any failure falls through
            print(f"{name} failed ({exc})", file=sys.stderr)
        data = {}
    if not data:
        print("No state source reachable; keeping the committed snapshot.", file=sys.stderr)
        return
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["month", "state", "ur", "lf"])
        for (month, fips) in sorted(data):
            row = data[(month, fips)]
            if "ur" in row and "lf" in row:
                w.writerow([month, fips, f"{row['ur']:.1f}", f"{row['lf']:.0f}"])
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
