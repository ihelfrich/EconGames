#!/usr/bin/env python3
"""Pull the latest monthly releases from FRED into pipeline/snapshots/fred_latest.csv.

Run by the deploy workflow before build_twin_data.py, so every deploy (and
the monthly scheduled one) re-anchors the twin to the newest BLS data. If
FRED is unreachable, the script leaves the committed FRED-MD snapshot in
charge and exits 0, so a FRED outage never breaks a deploy.

    python3 pipeline/refresh_releases.py
"""

from __future__ import annotations

import csv
import io
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "pipeline", "snapshots", "fred_latest.csv")

SERIES = [
    "UNRATE", "PAYEMS", "CLF16OV", "CE16OV", "UEMPMEAN", "UEMP27OV", "UEMP15OV",
    "CES1021000001", "USCONS", "MANEMP", "USTPU", "USFIRE", "SRVPRD", "USGOVT",
    "USINFO", "USPBS", "USEHS", "USLAH", "USSERV", "CPIAUCSL", "FEDFUNDS",
]
URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2000-01-01"


def pull(sid: str) -> dict[str, str]:
    for attempt in range(3):
        try:
            req = urllib.request.Request(URL.format(sid=sid), headers={"User-Agent": "EconTwin data refresh"})
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8")
            rows = list(csv.reader(io.StringIO(text)))
            # header is DATE,<id> or observation_date,<id>
            out = {}
            for row in rows[1:]:
                if len(row) >= 2 and row[1] not in ("", "."):
                    float(row[1])
                    out[row[0][:10]] = row[1]
            return out
        except Exception as exc:  # noqa: BLE001 - any failure falls back to the snapshot
            print(f"  {sid}: attempt {attempt + 1} failed ({exc})", file=sys.stderr)
            time.sleep(2 ** attempt)
    return {}


def main():
    data = {}
    for sid in SERIES:
        vals = pull(sid)
        if vals:
            data[sid] = vals
            print(f"{sid}: {len(vals)} obs, latest {max(vals)}")
    if "UNRATE" not in data:
        print("FRED unreachable; keeping the committed snapshot.", file=sys.stderr)
        return
    dates = sorted(set().union(*[v.keys() for v in data.values()]))
    cols = [s for s in SERIES if s in data]
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date"] + cols)
        for d in dates:
            w.writerow([d] + [data[c].get(d, "") for c in cols])
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
