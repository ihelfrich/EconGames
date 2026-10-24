# EconTwin: a living synthetic America

EconTwin is the first working slice of the digital twin of the U.S. economy:
a synthetic population on real county geography, an agent-based labor market,
a data-assimilation loop that keeps it on the path of real BLS releases, and an
isometric game view to watch it, poke it, and fork history.

Open it at `/twin.html` (locally `npm run dev`, then
http://localhost:3000/EconGames/twin.html; on GitHub Pages
https://ihelfrich.github.io/EconGames/twin.html).

```
 public county data ──► pipeline/ (Python, stdlib only) ──► public/twin-data/*.json
                                                                 │
          ┌──────────────────────────────────────────────────────┘
          ▼
   population.ts  466k synthetic people, county totals hit exactly
          │
          ▼
   engine.ts      monthly mechanisms: demography → labor demand & separations
          │                            → search & matching → participation
          ▼
   assimilation.ts each month: solve hidden demand + labor-force dials, for the
          │        nation and for each state, so the twin reproduces the
          │        BLS releases (about 3 trial months)
          ▼
   simulation.ts  timelines: replay (data-steered), forecast, branch (what-if)
          │
          ├─► worker.ts  (browser)  ──►  ui/app.ts + ui/iso.ts (isometric map)
          └─► scripts/twin-backtest.ts, twin.test.ts (headless, Node)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server; the twin is at `/EconGames/twin.html` |
| `npm test` | Population, engine, assimilation and backtest tests (about 20 s) |
| `npm run twin:backtest` | Headless replay 2016 → latest release, prints tracking and the spatial backtest |
| `npm run twin:data` | Rebuild `public/twin-data/` from the pipeline |
| `npm run twin:refresh` | Pull the newest national and state releases, then rebuild |

The deploy workflow refreshes the releases on every push to `main` and every
Saturday, so the published twin re-anchors itself to each new jobs report
without anyone touching it. The "Refresh twin data snapshots" workflow pulls
the same data and commits it to `pipeline/snapshots/` (monthly on `main`, and
whenever a refresh script changes), so the fallback data never goes stale. If
a source is unreachable, the committed snapshot is used and nothing fails.
BLS refuses requests from GitHub's runners, so state data comes from FRED's
copies of the same LAUS series.

## 1. The synthetic population

`src/twin/population.ts` places one synthetic person per ~1,000 residents
(at least 80 per county, so small places keep a labor market; each person
carries a survey weight). For every county it reproduces:

- age (18 five-year bins), sex, race/ethnicity (Census estimates, 2019)
- education of adults 25+ (USDA ERS / ACS)
- labor force and unemployment, **exactly**, to BLS LAUS 2016, using
  raking on the log-odds scale plus exact-count sampling
- jobs by 11 sectors and pay by sector (Census County Business Patterns),
  with education-by-sector affinities fitted by iterative proportional fitting
- obesity, smoking, fair/poor health, uninsurance (County Health Rankings),
  life expectancy (IHME) driving mortality
- 2024 presidential vote and turnout (2020 where 2024 is not county-level)

Joint structure the county files do not carry (education vs. pay, age vs.
participation, education vs. industry) comes from national patterns. That
is the main simplification: the next step is fitting joint distributions
from ACS PUMS microdata.

## 2. The engine and its mechanisms

A month is an ordered list of `Mechanism`s (`src/twin/engine.ts`):

| Mechanism | Economics |
| --- | --- |
| `Demography` | Birthdays, Gompertz mortality shifted by county life expectancy, age-specific retirement. Deaths are replaced by newborns in the same county. |
| `LaborDemand` | Each county × sector wants `L0 × A × sector mix × regional`. Jobs end at sector-specific rates, plus layoffs that close part of any excess of workers over demand. |
| `Matching` | Each county is a local labor market with a Cobb-Douglas matching function `M = mu U^a V^(1-a)`. Search effort falls with duration and while on UI; education shifts employability; workers prefer their previous sector; long spells scar re-employment pay. |
| `Participation` | Job seekers drift out (faster after 12 months); each county closes part of the gap to its target labor force with re-entrants, mostly young. |

County matching efficiency `mu` is calibrated in a **spin-up**: the labor
market runs with the calendar frozen while `mu` is nudged until each county's
unemployment settles at its 2016 BLS rate (median error after spin-up: well
under a point; small counties are noisier).

Randomness is counter-based: the draw for person *i*, slot *k*, month *t*
depends only on `(seed, t, i, k)`. Two runs that differ only in a driver see
the same luck ("common random numbers"). This is what makes assimilation
smooth and what-if branches clean.

### Adding a mechanism (where your research plugs in)

A mechanism is a plain object. It reads and writes the `World` arrays
(`status`, `sector`, `wage`, `dur`, `age`, `edu`, `race`, `health`, `vote`,
`county`, ...) and shares scratch space through the context:

```ts
import { DEFAULT_MECHANISMS, type Mechanism, uniform } from './engine';
import { STATUS } from './world';

/** Example: occupational licensing slows hiring into health care. */
export const Licensing: Mechanism = {
  id: 'licensing',
  label: 'Licensing frictions',
  summary: 'New hires into education & health wait an extra month with probability p.',
  step(ctx) {
    const w = ctx.world;
    const eduHealth = 7; // index in meta.sectors
    for (let i = 0; i < w.n; i++) {
      if (w.status[i] === STATUS.EMPLOYED && w.sector[i] === eduHealth && w.tenure[i] === 0 && uniform(ctx.key, i, 12) < 0.2) {
        w.status[i] = STATUS.UNEMPLOYED; // not licensed yet
      }
    }
  },
};

// put it after Matching:
const mechanisms = [...DEFAULT_MECHANISMS.slice(0, 3), Licensing, DEFAULT_MECHANISMS[3]];
```

Pass the list to `new Engine(data, mechanisms)`. Use your own uniform slots
(9 to 15 are free). Then run `npm run twin:backtest`: if the mechanism
improves the spatial backtest or the untargeted series below, it is doing
real work.

## 3. Data assimilation

Each month with a release, `Assimilator.step` solves for two hidden dials:

- **A**, aggregate labor demand, and
- **P**, the labor-force dial (target labor force relative to the start, net
  of population growth),

so that the twin's national unemployment rate and labor force match the
release. It re-runs the month from the same state with the same random draws,
using Broyden quasi-Newton updates. Sector payroll releases set the demand
*mix* directly. When a month has no release (for example the October 2025
shutdown gap), the twin forecasts through it.

### State releases

BLS publishes unemployment and the labor force for every state each month
(LAUS, seasonally adjusted). With those in the data (`src/twin/states.ts`),
the assimilator also solves, in the same trial months:

- **R_s**, a demand dial per state, so the state's unemployment rate minus the
  all-state rate matches the release, and
- **Q_s**, a labor-force dial per state, so the state's labor force growth
  relative to the nation matches. With no migration in the twin, this dial is
  where people moving to Texas or Florida show up.

Each state dial gets its own secant step from the last two trials, and the
dials are re-centered every step so the national dials keep carrying the
aggregate. The dials multiply every county in the state, so **nothing about
counties is fed in after 2016**: the pattern inside a state is still the
model's answer. Across 2016–2026 the state gaps track within 0.10 points on
average (max 0.36). The dials are readable as data: in April 2020 the twin
had to cut demand a further 26% in Hawaii, 25% in Nevada and 24% in Michigan
beyond the national shock, and in May Michigan's dial jumped back as the auto
plants reopened. The map layer "Hidden state demand" shows them live.

### Who is unemployed: race and ethnicity

CPS publishes unemployment by race and ethnicity every month. The engine's
`raceRisk` driver multiplies each person's chance of losing a job and divides
their chance of finding one by a dial for their group, and the assimilator
solves the Black, Asian and Hispanic dials (relative to non-Hispanic white)
so each group's gap to the national rate matches CPS. The dials settle during
the spin-up, so January 2016 already carries the CPS gaps (Black unemployment
8.7% vs 4.9% overall). They are re-scaled to average 1 across the labor
force, so the national dials keep their meaning. CPS counts Hispanics of any
race while the twin's groups do not overlap, so the match is approximate.
Tracking: Black 16.9% vs CPS 16.9% and Hispanic 18.9% vs 18.9% in April
2020.

Real policy is on a calendar (`POLICY_CALENDAR`): the CARES Act UI extension
and $600 supplement, the December 2020 and March 2021 extensions, and the
September 2021 expiry. These change UI duration and search intensity.

## 4. How well does it hold up?

From `npm run twin:backtest` (bundled data, releases through Sep 2026):

| Check | Result |
| --- | --- |
| National unemployment, Feb 2016 to Sep 2026 (targeted) | mean error 0.02 pts, max 0.06 pts, including April 2020 (14.8%) |
| State unemployment gaps, 51 states (targeted) | mean error 0.10 pts, max 0.36 pts |
| Unemployment by race and ethnicity (targeted) | mean error: Black 0.10 pts, Asian 0.14 pts, Hispanic 0.09 pts |
| Inferred labor demand, April 2020 | 0.75 of January 2016 (a 25% hidden demand shock) |
| Long-term unemployment share, 27+ weeks (**never targeted**; duration behavior calibrated on 2016–2019 only) | mean error 2.4 pts |

County unemployment in 2020, 3,136 counties, labor-force weighted. "Twin" is
BLS 2016 plus the twin's own 2016→2020 change. No county data after 2016 goes
in; the state forecasts know each state's actual change, like the twin does.

| Forecast | RMSE, all counties | Δ corr. | RMSE inside states | Δ corr. inside states |
| --- | --- | --- | --- | --- |
| Twin, national releases only (previous version) | 2.33 | 0.21 | | |
| Twin, national + state releases | 1.78 | 0.57 | 1.77 | 0.15 |
| **Twin, national + state + race releases** | **1.75** | **0.58** | 1.73 | 0.19 |
| Uniform national shift | 1.88 | — | 1.31 | — |
| Proportional national scaling | 2.11 | -0.04 | 1.61 | -0.15 |
| Every county moves with its state | 1.31 | 0.72 | 1.31 | — |
| Every county scales with its state | 1.63 | 0.57 | 1.63 | -0.11 |

Steering by state releases cuts the twin's county error by a quarter and lifts
the change correlation from 0.21 to 0.57, so it now beats the national
baselines. Steering who is unemployed by race adds a little more inside
states (0.15 to 0.19). Inside states the twin points the right way, where
proportional scaling points the wrong way, but its error is still above
"every county moves with its state". A within-state regression on the BLS
data (state-steered twin, before the race dials) says what is missing:

| County trait (within-state) | Share of the actual 2016→2020 change it explains | Share of the twin's miss it explains |
| --- | --- | --- |
| Log population density | 37% | 11% |
| Not non-Hispanic white | 30% | 13% |
| Black share | 21% | 9% |
| 2020 Democratic margin | 29% | 9% |
| Leisure & hospitality share | 3% | 0.4% |
| College share | 2% | 0% |

The twin already captures industry exposure. What it lacked was the urban and
racial pattern: denser places and places with more Black and Hispanic workers
lost far more jobs than their industry mix predicts. Steering race incidence
to CPS closes a small part of that. The rest is density: in the twin a
restaurant job in Manhattan and one in rural Kansas face the same shock. The
twin's rise by county size (+1.9 points in counties under 50k vs BLS +1.4,
+4.1 in counties over 1M vs BLS +4.6) shows the gradient is too flat. That is
the next mechanism, and the natural place for research: commuting, task
exposure (O*NET), remote work, face-to-face contact and health shocks. The
scoreboard in the UI and `twin:backtest` show whether it helps.

## 5. Data sources

| Data | Source | Vintage |
| --- | --- | --- |
| County demographics, LAUS, BEA income, CBP jobs & pay, ERS education, County Health Rankings, IHME life expectancy, elections 2008–2020 | [evangambit/JsonOfCounties](https://github.com/evangambit/JsonOfCounties), pinned commit | population 2019, CBP 2019, LAUS 2004–2020 annual |
| 2024 presidential returns | [tonmcg/US_County_Level_Election_Results_08-24](https://github.com/tonmcg/US_County_Level_Election_Results_08-24), pinned commit | 2024 |
| County shapes | [us-atlas](https://github.com/topojson/us-atlas) 3.0.1 (Census cartographic boundaries), Albers USA | 2017 |
| Monthly releases | FRED, pulled by the snapshot workflow (`pipeline/snapshots/fred_latest.csv`); FRED-MD (McCracken & Ng) vintage 2023-10 as the fallback | Jan 2004 to Sep 2026 |
| Monthly state releases | BLS LAUS, seasonally adjusted, via FRED (`CAUR`, `CALF`, ...) (`pipeline/snapshots/state_laus.csv`) | Jan 2000 to Sep 2026 |
| Quarterly service supersectors | FRED-QD, same vintage. Splits the monthly service payroll residual until a monthly FRED pull replaces it | |

Known simplifications: government jobs are imputed at the national share
(CBP excludes government); CBP counts jobs where people work while LAUS counts
where they live; the population does not migrate; the U.S. civilian population
grows 0.75% a year outside the twin, and the labor-force target is netted for
that. Differences in growth between states are absorbed by the state
labor-force dials. LAUS state figures do not sum exactly to the national CPS
figures, so the states are matched relative to each other and the nation is
matched to CPS.
