#!/usr/bin/env python3
"""Build the EconTwin data files from public county data.

Outputs (written to public/twin-data/):
  counties.json  one columnar record per county: demographics, jobs, wages,
                 health, politics, labor-market history
  grid.json      the isometric tile map: which county owns each tile
  releases.json  monthly national data releases that steer the twin

Inputs (downloaded once into pipeline/.cache/, pinned to commits):
  * evangambit/JsonOfCounties  counties.json, a merge of Census population
    estimates, BLS LAUS, BEA income, Census CBP, USDA ERS education,
    County Health Rankings, IHME life expectancy and county election returns.
  * tonmcg/US_County_Level_Election_Results_08-24  2024 presidential returns.
  * us-atlas (npm, devDependency)  Albers-projected county shapes.
  * pipeline/snapshots/fred_md_vintage_2023-10.csv  FRED-MD monthly macro
    data (McCracken & Ng), merged with any newer FRED pulls produced by
    refresh_releases.py.
  * pipeline/snapshots/fred_qd_vintage_2023-10.csv  FRED-QD quarterly
    service-supersector payrolls, used to split monthly service payrolls when
    no monthly supersector pull is available.

Standard library only, so it runs anywhere Python 3.9+ does:
    python3 pipeline/build_twin_data.py
"""

from __future__ import annotations

import csv
import json
import math
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "pipeline", ".cache")
OUT = os.path.join(ROOT, "public", "twin-data")

JOC_SHA = "6fde78759ee2f711315a5a10aee887e709d93a42"
ELEC_SHA = "8cccc82f9235dced94a76d143c59a43f4a6bf979"
SOURCES = {
    "counties.json": f"https://raw.githubusercontent.com/evangambit/JsonOfCounties/{JOC_SHA}/counties.json",
    "pres2024.csv": f"https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/{ELEC_SHA}/2024_US_County_Level_Presidential_Results.csv",
}
ATLAS = os.path.join(ROOT, "node_modules", "us-atlas", "counties-albers-10m.json")

# Twin sectors. Each maps Census CBP (NAICS) sectors to one of the CES
# supersector groups that monthly payroll releases report.
SECTORS = [
    # id, label, CBP sectors, release group
    ("agmin", "Farming & mining", ["Agriculture, forestry, fishing and hunting", "Mining, quarrying, and oil and gas extraction"], "mining"),
    ("constr", "Construction", ["Construction"], "construction"),
    ("manuf", "Manufacturing", ["Manufacturing"], "manufacturing"),
    ("trade", "Trade, transport & utilities", ["Wholesale trade", "Retail trade", "Transportation and warehousing", "Utilities"], "ttu"),
    ("info", "Information", ["Information"], "information"),
    ("fire", "Finance & real estate", ["Finance and insurance", "Real estate and rental and leasing"], "fire"),
    ("pbs", "Professional & business", ["Professional, scientific, and technical services", "Management of companies and enterprises", "Administrative and support and waste management and remediation services"], "pbs"),
    ("eduhealth", "Education & health", ["Educational services", "Health care and social assistance"], "eduhealth"),
    ("leisure", "Leisure & hospitality", ["Arts, entertainment, and recreation", "Accommodation and food services"], "leisure"),
    ("other", "Other services", ["Other services (except public administration)", "Industries not classified"], "otherserv"),
    ("gov", "Government", [], "government"),
]

# Government is not in CBP. The twin gives every county the national share
# of payroll jobs in government (CES, 2016) - a documented simplification.
GOV_SHARE_2016 = 22.2 / 144.3

# County renames between the map vintage and the data vintage.
FIPS_ALIASES = {"46102": "46113", "46113": "46102", "02158": "02270", "02270": "02158"}

AGE_BINS = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44",
            "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79", "80-84", "85+"]
RACES = [("white", "non_hispanic_white_alone"), ("black", "black_alone"),
         ("asian", "asian_alone"), ("hispanic", "hispanic")]

# Monthly release series. Snapshot columns come from FRED-MD; the refresh
# script can add the finer CES supersectors straight from FRED.
RELEASE_GROUPS = {
    "mining": ["CES1021000001"],
    "construction": ["USCONS"],
    "manufacturing": ["MANEMP"],
    "ttu": ["USTPU"],
    "fire": ["USFIRE"],
    "government": ["USGOVT"],
    # Monthly supersectors when a fresh FRED pull has them. Otherwise the
    # monthly residual "other private services" (SRVPRD - USTPU - USFIRE -
    # USGOVT, exact in FRED-MD) is split using each supersector's share from
    # quarterly FRED-QD, interpolated between quarter midpoints.
    "information": ["USINFO", "@qd:USINFO", "@otherpriv"],
    "pbs": ["USPBS", "@qd:USPBS", "@otherpriv"],
    "eduhealth": ["USEHS", "@qd:USEHS", "@otherpriv"],
    "leisure": ["USLAH", "@qd:USLAH", "@otherpriv"],
    "otherserv": ["USSERV", "@qd:USSERV", "@otherpriv"],
}
QD_SERIES = ["USLAH", "USEHS", "USPBS", "USINFO", "USSERV"]


def fetch(name: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print(f"downloading {SOURCES[name]}", file=sys.stderr)
        with urllib.request.urlopen(SOURCES[name], timeout=120) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    return path


def num(x, default=None):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- geometry

def decode_topology(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(idx_list):
        pts = []
        for i in idx_list:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    shapes = {}
    for g in topo["objects"]["counties"]["geometries"]:
        if g["type"] == "Polygon":
            polys = [g["arcs"]]
        elif g["type"] == "MultiPolygon":
            polys = g["arcs"]
        else:
            continue
        rings = [ring(r) for poly in polys for r in poly]
        shapes[g["id"]] = rings
    return shapes


def rasterize(shapes, cell):
    """Scanline-fill each county onto a grid of `cell`-unit tiles (even-odd)."""
    xs = [p[0] for rings in shapes.values() for r in rings for p in r]
    ys = [p[1] for rings in shapes.values() for r in rings for p in r]
    x0, y0 = math.floor(min(xs)), math.floor(min(ys))
    w = int(math.ceil((max(xs) - x0) / cell)) + 1
    h = int(math.ceil((max(ys) - y0) / cell)) + 1
    grid = [-1] * (w * h)
    for fips, rings in shapes.items():
        cy_min = min(p[1] for r in rings for p in r)
        cy_max = max(p[1] for r in rings for p in r)
        for gy in range(max(0, int((cy_min - y0) / cell) - 1), min(h, int((cy_max - y0) / cell) + 2)):
            yc = y0 + (gy + 0.5) * cell
            crossings = []
            for r in rings:
                for (ax, ay), (bx, by) in zip(r, r[1:] + r[:1]):
                    if (ay > yc) != (by > yc):
                        crossings.append(ax + (yc - ay) * (bx - ax) / (by - ay))
            crossings.sort()
            for a, b in zip(crossings[::2], crossings[1::2]):
                gx_a = int(math.ceil((a - x0) / cell - 0.5))
                gx_b = int(math.floor((b - x0) / cell - 0.5))
                for gx in range(max(0, gx_a), min(w - 1, gx_b) + 1):
                    grid[gy * w + gx] = fips
    # Counties too small to own a tile centre still get one tile, the
    # nearest to their centroid whose owner can spare it, so every county is
    # clickable.
    owners = {}
    for f in grid:
        if f != -1:
            owners[f] = owners.get(f, 0) + 1
    for fips, rings in sorted(shapes.items()):
        if owners.get(fips):
            continue
        pts = [p for r in rings for p in r]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        gx0, gy0 = int((cx - x0) / cell), int((cy - y0) / cell)
        best = None
        for radius in range(0, 6):
            for gy in range(gy0 - radius, gy0 + radius + 1):
                for gx in range(gx0 - radius, gx0 + radius + 1):
                    if not (0 <= gx < w and 0 <= gy < h) or max(abs(gx - gx0), abs(gy - gy0)) != radius:
                        continue
                    cur = grid[gy * w + gx]
                    if cur == -1 or owners.get(cur, 0) > 1:
                        d = (gx - gx0) ** 2 + (gy - gy0) ** 2
                        if best is None or d < best[0]:
                            best = (d, gx, gy)
            if best:
                break
        if best:
            _, gx, gy = best
            cur = grid[gy * w + gx]
            if cur != -1:
                owners[cur] -= 1
            grid[gy * w + gx] = fips
            owners[fips] = 1
    return grid, w, h, x0, y0


def centroid(rings):
    pts = [p for r in rings for p in r]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


# ------------------------------------------------------------------ counties

def build_counties(shapes):
    raw = json.load(open(fetch("counties.json")))
    by_fips = {e["fips"]: e for e in raw}

    pres24 = {}
    with open(fetch("pres2024.csv"), newline="") as f:
        for row in csv.DictReader(f):
            pres24[row["county_fips"].zfill(5)] = (num(row["votes_dem"], 0), num(row["votes_gop"], 0), num(row["total_votes"], 0))

    # national average wage per twin sector, used where CBP suppresses a county
    nat = {s[0]: [0.0, 0.0] for s in SECTORS}
    for e in raw:
        ind = e.get("industry") or {}
        for sid, _, cbp, _ in SECTORS:
            for k in cbp:
                v = ind.get(k)
                if v and v.get("employees"):
                    nat[sid][0] += v["payroll"]
                    nat[sid][1] += v["employees"]
    nat_wage = {k: (p / n if n else None) for k, (p, n) in nat.items()}
    priv = [v for k, v in nat_wage.items() if v]
    nat_wage["gov"] = 1.05 * sum(priv) / len(priv)

    cols = {k: [] for k in [
        "fips", "name", "state", "cx", "cy", "pop", "male", "age", "race", "edu",
        "lf", "unemp", "income", "poverty", "jobs", "wage", "health", "lifeExp",
        "vote2020", "vote2024", "altitude", "landArea"]}
    missing = []
    for fips in sorted(shapes):
        e = by_fips.get(fips) or by_fips.get(FIPS_ALIASES.get(fips, ""))
        if not e:
            missing.append(fips)
            continue
        pops = e.get("population") or {}
        pop = num(pops.get("2019")) or num(pops.get("2018")) or 0
        if pop <= 0:
            missing.append(fips)
            continue
        cx, cy = centroid(shapes[fips])
        age = e.get("age") or {}
        ages = [round(num(age.get(b), 0), 5) for b in AGE_BINS]
        race = e.get("race") or {}
        shares = [num(race.get(f"{k}_male"), 0) + num(race.get(f"{k}_female"), 0) for _, k in RACES]
        tot = sum(shares)
        if tot > 1:
            shares = [s / tot for s in shares]
        shares.append(max(0.0, 1 - sum(shares)))
        male = num(e.get("male"), 0)
        female = num(e.get("female"), 0)
        edu = e.get("edu") or {}
        edus = [num(edu.get(k)) for k in ["less-than-high-school", "high-school", "some-college", "bachelors+"]]
        if any(v is None for v in edus):
            edus = [12.0, 27.0, 29.0, 32.0]  # national fallback
        bls = e.get("bls") or {}
        lf = {y: num((bls.get(y) or {}).get("labor_force")) for y in ["2004", "2008", "2012", "2016", "2020"]}
        un = {y: num((bls.get(y) or {}).get("unemployed")) for y in ["2004", "2008", "2012", "2016", "2020"]}
        ind = e.get("industry") or {}
        jobs, wage = [], []
        for sid, _, cbp, _ in SECTORS:
            emp = sum((ind.get(k) or {}).get("employees") or 0 for k in cbp)
            pay = sum((ind.get(k) or {}).get("payroll") or 0 for k in cbp if (ind.get(k) or {}).get("employees"))
            jobs.append(emp)
            wage.append(round(pay / emp) if emp and pay else round(nat_wage[sid] or 0))
        priv_jobs = sum(jobs)
        jobs[-1] = round(priv_jobs * GOV_SHARE_2016 / (1 - GOV_SHARE_2016)) if priv_jobs else round(pop * 0.06)
        wage[-1] = round(nat_wage["gov"])
        h = e.get("health") or {}
        health = [num(h.get(k)) for k in ["% Adults with Obesity", "% Smokers", "% Fair or Poor Health", "% Uninsured"]]
        el = e.get("elections") or {}
        v20 = el.get("2020") or {}
        v24 = pres24.get(fips)

        cols["fips"].append(fips)
        cols["name"].append(e["name"].title().replace(" And ", " and ").replace(" Of ", " of "))
        cols["state"].append(e["state"])
        cols["cx"].append(round(cx, 2))
        cols["cy"].append(round(cy, 2))
        cols["pop"].append(int(pop))
        cols["male"].append(round(male / (male + female), 4) if male + female else 0.5)
        cols["age"].append(ages)
        cols["race"].append([round(s, 4) for s in shares])
        cols["edu"].append([round(v / 100, 4) for v in edus])
        cols["lf"].append([lf[y] for y in ["2004", "2008", "2012", "2016", "2020"]])
        cols["unemp"].append([un[y] for y in ["2004", "2008", "2012", "2016", "2020"]])
        cols["income"].append(num(e.get("avg_income")))
        cols["poverty"].append(num(e.get("poverty-rate")))
        cols["jobs"].append(jobs)
        cols["wage"].append(wage)
        cols["health"].append([None if v is None else round(v / 100, 4) for v in health])
        cols["lifeExp"].append(num(e.get("life-expectancy")))
        cols["vote2020"].append([num(v20.get("dem")), num(v20.get("gop")), num(v20.get("total"))] if v20 else None)
        cols["vote2024"].append(list(v24) if v24 else None)
        cols["altitude"].append(num((e.get("noaa") or {}).get("altitude")))
        cols["landArea"].append(num(e.get("land_area (km^2)")))
    if missing:
        print(f"note: {len(missing)} map counties have no data and are left blank: {missing[:12]}...", file=sys.stderr)
    return cols


# ------------------------------------------------------------------ releases

def load_series():
    """Merge the FRED-MD snapshot with any newer pulls from refresh_releases.py."""
    series: dict[str, dict[str, float]] = {}
    sources: dict[str, str] = {}

    def add_csv(path, label):
        with open(path, newline="") as f:
            r = csv.reader(f)
            header = next(r)
            for row in r:
                date = row[0][:7]
                for name, val in zip(header[1:], row[1:]):
                    v = num(val)
                    if v is not None:
                        series.setdefault(name, {})[date] = v
                        sources[name] = label

    add_csv(os.path.join(ROOT, "pipeline", "snapshots", "fred_md_vintage_2023-10.csv"), "FRED-MD vintage 2023-10")
    fresh = os.path.join(ROOT, "pipeline", "snapshots", "fred_latest.csv")
    if os.path.exists(fresh):
        add_csv(fresh, "FRED (latest pull)")
    return series, sources


def month_index(label: str) -> int:
    y, m = label.split("-")[:2]
    return int(y) * 12 + int(m) - 1


def quarterly_shares():
    """Share of each QD supersector in their sum, keyed by quarter-midpoint month index."""
    path = os.path.join(ROOT, "pipeline", "snapshots", "fred_qd_vintage_2023-10.csv")
    anchors = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            vals = [num(row[c]) for c in QD_SERIES]
            if any(v is None for v in vals):
                continue
            tot = sum(vals)
            anchors.append((month_index(row["quarter_end"]) - 1, {c: v / tot for c, v in zip(QD_SERIES, vals)}))
    return anchors


def interpolated_share(anchors, sid: str, mi: int) -> float:
    if mi <= anchors[0][0]:
        return anchors[0][1][sid]
    for (a, sa), (b, sb) in zip(anchors, anchors[1:]):
        if mi <= b:
            t = (mi - a) / (b - a)
            return sa[sid] + (sb[sid] - sa[sid]) * t
    return anchors[-1][1][sid]


def build_releases():
    series, sources = load_series()
    # a continuous calendar: a month with no release (e.g. the October 2025
    # shutdown gap) stays in the list with nulls, and the twin forecasts it
    last = month_index(max(series["UNRATE"]))
    months = [f"{i // 12}-{i % 12 + 1:02d}" for i in range(month_index("2004-01"), last + 1)]
    anchors = quarterly_shares()

    def otherpriv(m):
        try:
            return series["SRVPRD"][m] - series["USTPU"][m] - series["USFIRE"][m] - series["USGOVT"][m]
        except KeyError:
            return None

    groups = {}
    used = {}
    for g, ids in RELEASE_GROUPS.items():
        for sid in ids:
            if sid == "@otherpriv":
                vals = [otherpriv(m) for m in months]
                label = "SRVPRD - USTPU - USFIRE - USGOVT"
            elif sid.startswith("@qd:"):
                q = sid[4:]
                vals = [None if otherpriv(m) is None else otherpriv(m) * interpolated_share(anchors, q, month_index(m)) for m in months]
                label = f"{q} (monthly residual x FRED-QD quarterly share)"
            else:
                vals = [series.get(sid, {}).get(m) for m in months]
                label = sid
            # use a series only if it covers the whole window
            if all(v is not None for v in vals):
                groups[g] = vals
                used[g] = label
                break

    def col(name):
        return [series.get(name, {}).get(m) for m in months]

    out = {
        "months": months,
        "unrate": col("UNRATE"),
        "payems": col("PAYEMS"),
        "laborForce": col("CLF16OV"),
        "employed": col("CE16OV"),
        "meanDuration": col("UEMPMEAN"),
        "longTerm": col("UEMP27OV"),
        "cpi": col("CPIAUCSL"),
        "fedfunds": col("FEDFUNDS"),
        "sectorGroups": groups,
        "sectorSeries": used,
        "sources": sorted(set(sources.values())),
    }
    states = build_state_releases(months)
    if states:
        out["states"] = states
        out["sources"].append("BLS Local Area Unemployment Statistics, states, seasonally adjusted")
    return out


def build_state_releases(months):
    """Monthly state unemployment rate (%) and labor force, aligned with months."""
    path = os.path.join(ROOT, "pipeline", "snapshots", "state_laus.csv")
    if not os.path.exists(path):
        return None
    vals = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            vals.setdefault(row["state"], {})[row["month"]] = (float(row["ur"]), float(row["lf"]))
    codes = sorted(vals)
    return {
        "codes": codes,
        "unrate": [[vals[c][m][0] if m in vals[c] else None for m in months] for c in codes],
        "laborForce": [[vals[c][m][1] if m in vals[c] else None for m in months] for c in codes],
    }


def main():
    shapes = decode_topology(json.load(open(ATLAS)))
    counties = build_counties(shapes)
    index = {f: i for i, f in enumerate(counties["fips"])}

    cell = 4.0
    grid, w, h, x0, y0 = rasterize(shapes, cell)
    cells = [index.get(f, -1) if f != -1 else -1 for f in grid]

    releases = build_releases()
    meta = {
        "built": __import__("datetime").date.today().isoformat(),
        "sectors": [{"id": s[0], "label": s[1], "group": s[3]} for s in SECTORS],
        "ageBins": AGE_BINS,
        "races": ["White (non-Hispanic)", "Black", "Asian", "Hispanic", "Other / multiracial"],
        "eduLevels": ["Less than high school", "High school", "Some college", "Bachelor's+"],
        "laborYears": [2004, 2008, 2012, 2016, 2020],
        "health": ["Obesity", "Smoking", "Fair/poor health", "Uninsured"],
        "attribution": [
            "County data: evangambit/JsonOfCounties (Census population estimates 2019, BLS LAUS, BEA, Census CBP 2019, USDA ERS, County Health Rankings, IHME, county election returns)",
            "2024 presidential returns: tonmcg/US_County_Level_Election_Results_08-24",
            "Geography: us-atlas (US Census Bureau cartographic boundaries)",
            "Monthly releases: FRED-MD (McCracken & Ng) / FRED, Federal Reserve Bank of St. Louis",
        ],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "counties.json"), "w") as f:
        json.dump({"meta": meta, **counties}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "grid.json"), "w") as f:
        json.dump({"w": w, "h": h, "cell": cell, "x0": x0, "y0": y0, "cells": cells}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "releases.json"), "w") as f:
        json.dump(releases, f, separators=(",", ":"))
    land = sum(1 for c in cells if c >= 0)
    print(f"{len(counties['fips'])} counties, grid {w}x{h} ({land} land tiles), "
          f"{len(releases['months'])} release months ({releases['months'][0]} to {releases['months'][-1]})")
    print("sector series:", releases["sectorSeries"])


if __name__ == "__main__":
    main()
