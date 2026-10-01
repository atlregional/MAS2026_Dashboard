# MAS Dashboard

The Metro Atlanta Speaks (MAS) survey dashboard: a fully static website
built from plain HTML/CSS/JavaScript and [Plotly.js](https://plotly.com/javascript/).
There is no server, no framework and no bundler. The pages load a single
precomputed data file, `data/dashboard_data.json`, and draw charts from it.

**The core idea: all the math happens once, at build time, in Python. The
browser only looks up precomputed numbers and draws them.**

## How it fits together

```
MAS_Pipeline (separate folder)          This repo, build time                 This repo, in the browser
─────────────────────────────           ─────────────────────────             ─────────────────────────
raw survey CSVs                         scripts/build_static_data.py          *.html pages
  → main_cln.py                           reads the two parquets                load js/*.js
  → main_dshbrd.py                        + config/*.yaml                       fetch dashboard_data.json
  → main_crosstab.py                      computes every chart's data           look up the chart you picked
      ├ crosstab_long_<year>.parquet ─copy─►   writes data/dashboard_data.json ──►   draw it with Plotly
      └ questions_meta_<year>.parquet ─copy─►
```

1. **MAS_Pipeline** cleans the raw survey data and exports weighted sums
   and question metadata. It has no dashboard-specific opinions (no
   percentages, colors, or hidden responses).
2. **`scripts/build_static_data.py`** (this repo) turns those into every
   chart the dashboard can show, applying the presentation rules in
   `config/*.yaml`, and writes `data/dashboard_data.json`.
3. **The browser** fetches that JSON once. Every chart is a dictionary
   lookup followed by a Plotly call; nothing is recomputed.

## Dependency on MAS_Pipeline

This dashboard does not read raw survey data. It depends entirely on two
files produced by the `MAS_Pipeline` project, copied by hand into
`data/pipeline_input/`.

### What the pipeline does

| Step | Script | Output |
|---|---|---|
| 1. Clean | `main_cln.py` | Reads every year's raw survey CSVs (paths in `MAS_Pipeline/config.yaml`), recodes responses, reshapes to one row per respondent × question: `MAS_Complete_Records_<year>_Updated.csv` |
| 2. Dashboard records | `main_dshbrd.py` | Keeps only the questions asked in the current survey year (`update_yr` in `config.yaml`) and the demographics collected that year; adds each question's `category`, short text (`q_short`) and full wording (`q_verb`) from `ques_details.yaml`; renames columns to readable labels: `MAS_Dashboard_Records_<year>_Updated.parquet` |
| 3. Export | `main_crosstab.py` | Sums survey weights per question/year/demographic/response: `crosstab_long_<year>.parquet`; writes one metadata row per question × year: `questions_meta_<year>.parquet` (`<year>` is `update_yr`) |

### The two files this dashboard reads

**`crosstab_long_<year>.parquet`**: one row per (question, year, demographic
group, response) with the summed survey weight.

| Column | Example | Meaning |
|---|---|---|
| `question` | `bigprob` | Question code |
| `year` | `2025` | Survey year |
| `demo_type` | `county` | Demographic column, or `metroresp` for metro-wide totals |
| `demo_value` | `Cherokee` | Group within that demographic, or `MetroAtl` for metro-wide |
| `response` | `Traffic` | Raw response value, **including** Don't Know (`DK`) |
| `weight` | `2015.37` | Sum of the survey weight for that cell |

The pipeline picks the right weight for each breakdown: `countywt` for
county breakdowns, `atlwt` for the City of Atlanta oversample, `metrowt`
for everything else (see `resolve_weight_column` in
`MAS_Pipeline/assets/crosstab_export.py`). The dashboard never needs to
know which weight was used.

**`questions_meta_<year>.parquet`**: one row per question × year.

| Column | Example | Used for |
|---|---|---|
| `question` | `bigprob` | Question code |
| `year` | `2025` | Which years the question was asked (the year buttons) |
| `category` | `BIGPROBLEM` | Category badge in the question picker, and picker order |
| `q_short` | `What is the biggest problem in metro Atlanta today?` | Question text in the picker |
| `q_verb` | `Of the following, which issue is…` | Full question wording shown as the chart title |

### What has to stay in sync between the two projects

- **Question codes.** `config/chart_configs.yaml` and
  `config/questions.yaml` are keyed by the pipeline's question codes
  (`bigprob`, `fixtraf`, …). A renamed code in the pipeline needs the same
  rename here.
- **Question wording and categories** live only in
  `MAS_Pipeline/ques_details.yaml` (`questn_shrt`, `nav_tag`,
  `questn_orig`). Change them there, not here.
- **Demographic columns.** `demo_col_map` in `config/demographics.yaml`
  must use the same column names as `DEMOGRAPHIC_COLUMNS` in
  `MAS_Pipeline/assets/crosstab_export.py`.
- **Survey year.** `survey_year` in `config/dashboard.yaml` picks which
  year's files to read (e.g. `crosstab_long_2026.parquet`), and must match
  `update_yr` in `MAS_Pipeline/config.yaml`. The dashboard's "current year"
  is the latest year in `questions_meta_<year>.parquet`; the build warns if
  it isn't `survey_year`.

## Project layout

```
index.html                    # splash page -- intro blurb + "Enter the Dashboard" button, no charts
metro_summary.html            # Metro Summary page: metro-wide results
demographic_breakdown.html    # Demographic Breakdown page: results split by a demographic
faq.html                      # FAQ page (static content)
css/style.css                 # all styles
js/
  data.js                     # MASData -- loads dashboard_data.json, lookup helpers
  state.js                    # SharedState -- remembers selections across pages (sessionStorage)
  charts.js                   # MASCharts -- every Plotly chart, plus CSV/PNG download
  questionPicker.js           # MASQuestionPicker -- desktop question dropdown with category badges
  mobileViews.js              # MASMobileViews -- phone layouts (HTML bar lists, cards, question picker)
  metroSummary.js             # Metro Summary page controller
  demographicBreakdown.js     # Demographic Breakdown page controller
  scrollIndicator.js          # "scroll down" button, every page
  splash.js                   # splash page: adds a "best on desktop" note for mobile visitors
config/
  dashboard.yaml              # survey_year: which year's pipeline exports to read
  chart_configs.yaml          # per question + year: hidden responses, renamed labels, sort order, colors
  questions.yaml              # which questions get trend line charts (and from what year), and picker order
  demographics.yaml           # demographic dropdown, hidden groups, group order and names
data/
  dashboard_data.json         # everything the browser reads (generated -- don't edit by hand)
  pipeline_input/             # crosstab_long_<year>.parquet + questions_meta_<year>.parquet from MAS_Pipeline
scripts/
  build_static_data.py        # pipeline_input + config -> dashboard_data.json
  lib/chart_config.py         # percent / exclude / alias / sort / color logic
assets/                       # logos
```

There is no `package.json` or build tool. Each HTML page loads Plotly.js
from a pinned CDN URL and the `.js` files with plain `<script>` tags.

## The build step

`scripts/build_static_data.py` reads the two parquet files plus three
config files:

| Config | Controls |
|---|---|
| `config/chart_configs.yaml` | Per question and year: `exclude_responses` (e.g. `DK`), `response_aliases`, `custom_order`, `custom_colors`. Trend charts use the current year's settings for every year. |
| `config/questions.yaml` | `question_hist`: `1` to show trend line charts for a question, `0` not to. The mapping form `{trend: 1, start_year: 2025}` limits the line charts to `start_year` onward while the bar charts still offer every year. `question_order`: the order of questions in the question picker. |
| `config/dashboard.yaml` | `survey_year`: which year's pipeline exports (`crosstab_long_<year>.parquet`, `questions_meta_<year>.parquet`) to read. Must match `update_yr` in `MAS_Pipeline/config.yaml`. |
| `config/demographics.yaml` | `demo_col_map` (dropdown label → data column), `excluded_demographics`, `excluded_historical` (groups shown in bar charts but with no historic trend chart; they can't be selected), `demo_notes` (sentence added to the end of the note under a demographic's bar chart), `demo_grp_order`, `demo_grp_rename` |

The main logic is `resolve_chart_config` in `scripts/lib/chart_config.py`:
weighted sums → percentages → hide excluded responses → apply aliases →
sort → assign colors. Excluded responses are removed *after* percentages
are calculated, so the displayed bars don't sum to 100%. That's why charts
carry the "Remaining percentages are either Don't Know or Not Available"
note.

The script pre-builds every chart into five sections of
`dashboard_data.json`:

| Section | Lookup key | Feeds |
|---|---|---|
| `questions` | list | Question picker (key, category, text, years, has_trend) |
| `topline` | `question\|year` | Metro Summary bar chart |
| `metro_trend` | `question` | Metro Summary line chart |
| `crosstab` | `question\|year\|demographic` | Demographic Breakdown stacked bars / small multiples |
| `historical` | `question\|demographic\|group` | Line chart for one group, e.g. Cherokee County |

Question order in the picker comes from `question_order` in
`config/questions.yaml`. Questions not listed there follow, sorted
BIGPROBLEM first, then by category, then by question text.

## How the pages work

Both chart pages follow the same pattern in their controller
(`metroSummary.js` / `demographicBreakdown.js`):

1. **`init()`** waits for `MASData.load()`, then restores the last
   question, year and demographic from `SharedState`.
2. It draws the controls: question picker, year buttons, Topline/Detailed
   toggle, and (breakdown page) the demographic dropdown.
3. It draws the charts, e.g. `renderResponseDistribution()` calls
   `MASData.getTopline(key, year)` then `MASCharts.buildToplineBarChart(...)`,
   or the `MASMobileViews` equivalent on phones.
4. **Changing a control** runs a handler (`onQuestionChange`,
   `onYearChange`, …) that updates `state`, saves it to `SharedState`, and
   re-runs only the render functions that depend on it.

On the breakdown page, clicking a demographic group (e.g. a county's bar)
shows that group's historical line chart via `MASData.getHistorical(...)`,
for questions with trend charts enabled.

**Mobile vs desktop** is decided once per browser tab from the viewport
width (`window.matchMedia("(max-width: 768px)")`, in `state.js`). Phones
get HTML bar lists and cards instead of Plotly bar charts.

**Shared selections.** The selected question, year, demographic and
demographic group are stored in `sessionStorage`, so they carry over
between the Metro Summary and Demographic Breakdown pages and last until
the tab is closed.

## Where to make common changes

| Change | Edit | Rebuild? |
|---|---|---|
| Colors, hidden responses, or order for a question | `config/chart_configs.yaml` | Yes |
| Turn trend charts on/off, or set where they start | `config/questions.yaml` | Yes |
| Order of questions in the question picker | `config/questions.yaml` (`question_order`) | Yes |
| Demographic groups, their names or order | `config/demographics.yaml` | Yes |
| Question wording or category | `MAS_Pipeline/ques_details.yaml` | Re-run pipeline, copy, rebuild |
| New survey year's data | `MAS_Pipeline` (see below), then `survey_year` in `config/dashboard.yaml` | Re-run pipeline, copy, rebuild |
| Chart look or behavior | `js/charts.js` | No |
| Layout or styling | `*.html`, `css/style.css` | No |

## Updating the data

Requires Python 3.10+ with `pandas`, `pyarrow` and `pyyaml`.

```bash
# 1. In MAS_Pipeline: regenerate the exports
cd MAS_Pipeline
python3 main_cln.py && python3 main_dshbrd.py && python3 main_crosstab.py

# 2. Copy them into this repo
cp crosstab_long_2026.parquet questions_meta_2026.parquet \
  /path/to/MAS2026_Dashboard_JS/data/pipeline_input/

# 3. In this repo: rebuild the dashboard data
python3 scripts/build_static_data.py
```

`main_cln.py` only needs re-running when the raw survey data changes;
wording or category changes in `ques_details.yaml` only need
`main_dshbrd.py` and `main_crosstab.py`. Config-only changes in this repo
only need step 3.

Before publishing, check the new `dashboard_data.json`: spot-check a few
numbers against the published survey results (e.g. `bigprob` metro-wide,
Cherokee County, and Male for the current year, as
`MAS_Pipeline/validate_against_arc_report.py` does), and compare it
against the previous version -- every difference should be explained by a
real data or config change. There's no server-side check, so this file is
what users see.

## Running it locally

The pages `fetch()` `data/dashboard_data.json`, which browsers block on
`file://` URLs, so serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

## Deploying

Any static host (GitHub Pages, Netlify, S3 + CloudFront, etc.) works by
serving this directory as-is. `data/dashboard_data.json` is committed to
the repo because whatever is in the repo is the live site. It is not yet
deployed to a public host.
