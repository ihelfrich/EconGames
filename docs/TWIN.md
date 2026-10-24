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
   assimilation.ts each month: solve hidden demand + labor-force dials so the
          │        twin reproduces the BLS release (2–3 trial months)
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
| `npm run twin:refresh` | Pull the newest releases from FRED, then rebuild |

The deploy workflow runs `twin:refresh` on every push to `main` and every
Saturday, so the published twin re-anchors itself to each new jobs report
without anyone touching it. If FRED is unreachable, the committed snapshot is
used and the deploy still succeeds.

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
using Broyden quasi-Newton updates (2.2 trial months per month on average).
Sector payroll releases set the demand *mix* directly. When a month has no
release (for example the October 2025 shutdown gap), the twin forecasts
through it.

Real policy is on a calendar (`POLICY_CALENDAR`): the CARES Act UI extension
and $600 supplement, the December 2020 and March 2021 extensions, and the
September 2021 expiry. These change UI duration and search intensity.

## 4. How well does it hold up?

From `npm run twin:backtest` (bundled data, releases through Sep 2023):

| Check | Result |
| --- | --- |
| National unemployment, Feb 2016 to Sep 2023 (targeted) | mean error 0.01 pts, max 0.05 pts, including April 2020 (14.7%) |
| Inferred labor demand, April 2020 | 0.76 of January 2016 (a 24% hidden demand shock) |
| Long-term unemployment share, 27+ weeks (**never targeted**; duration behavior calibrated on 2016–2019 only) | mean error 2.5 pts. Jan 2021: BLS 39.9%, twin 36.5% |
| County unemployment in 2020 (3,136 counties, labor-force weighted RMSE) | twin 2.33 pts vs. uniform national shift 1.88 vs. proportional scaling 2.11 |
| Correlation of predicted vs. actual county change 2016→2020 | twin 0.13 (0.21 using BLS 2016 + twin change) vs. proportional -0.04 |

The national and duration results are strong. The spatial result is honest:
industry mix alone does not tell you where the 2020 shock landed. A quick
regression on the BLS county data shows why. The county's **state** explains
about 52% of the variation in the 2016→2020 change and **log population
density** about 34%, while the leisure and hospitality share explains about 3%.
The pandemic landed by place and policy more than by industry.

That points to the next two upgrades:

1. **Assimilate state releases.** BLS publishes monthly state unemployment
   (FRED `CAUR`, `NVUR`, ...). Solving one regional dial per state each month
   would let the twin carry state shocks, and the backtest would then measure
   the within-state county pattern, which is the model's real job.
2. **Research mechanisms.** Density, commuting, task exposure (O*NET), remote
   work, health shocks: whatever your and Liz's work says drives local labor
   markets. The scoreboard in the UI and `twin:backtest` show whether it helps.

## 5. Data sources

| Data | Source | Vintage |
| --- | --- | --- |
| County demographics, LAUS, BEA income, CBP jobs & pay, ERS education, County Health Rankings, IHME life expectancy, elections 2008–2020 | [evangambit/JsonOfCounties](https://github.com/evangambit/JsonOfCounties), pinned commit | population 2019, CBP 2019, LAUS 2004–2020 annual |
| 2024 presidential returns | [tonmcg/US_County_Level_Election_Results_08-24](https://github.com/tonmcg/US_County_Level_Election_Results_08-24), pinned commit | 2024 |
| County shapes | [us-atlas](https://github.com/topojson/us-atlas) 3.0.1 (Census cartographic boundaries), Albers USA | 2017 |
| Monthly releases | FRED-MD (McCracken & Ng), vintage 2023-10, via the CRAN `BVAR` package; refreshed from FRED in CI | Jan 2004 onward |
| Quarterly service supersectors | FRED-QD, same vintage. Splits the monthly service payroll residual until a monthly FRED pull replaces it | |

Known simplifications: government jobs are imputed at the national share
(CBP excludes government); CBP counts jobs where people work while LAUS counts
where they live; the population does not migrate; the U.S. civilian population
grows 0.75% a year outside the twin, and the labor-force target is netted for
that.
