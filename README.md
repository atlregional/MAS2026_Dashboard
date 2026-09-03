# MAS Dashboard -- Static JS Build

A fully static build of the Metro Atlanta Speaks dashboard: plain HTML/CSS/
vanilla JavaScript + [Plotly.js](https://plotly.com/javascript/), served as
files with no server-side process, **no Python/WebAssembly runtime in the
browser at all**, and no build step (no bundler, no framework).

This is the third build of this dashboard in this workspace:

1. **`MAS_Dashboard_App/`** -- the original server app: Python/Streamlit,
   runs as a live server process, tabulates from the raw record-level
   survey data on every request (with `@st.cache_data`/`@st.cache_resource`
   caching).
2. **`MAS_Dashboard_App_Static_Streamlit/`** -- a static/serverless build
   of the *same* Streamlit `.py` files, run entirely client-side via
   [stlite](https://github.com/whitphx/stlite) (Pyodide/WebAssembly). Zero
   code changes from the server app, but ships a whole Python runtime
   (Pyodide + pandas + pyarrow + plotly) to the browser -- correct and
   fully interactive, at the cost of a ~10-16s first-load.
3. **This build** -- static and serverless like #2, but with the
   interaction logic actually ported to hand-written JavaScript instead of
   running the original Python unmodified. No Python ships to the
   browser, so there's no WASM runtime download -- just HTML, CSS, a few
   small `.js` files, and one precomputed JSON data file.

## How this build works

The hardest, most subtlety-laden part of this dashboard was never the
UI -- it's the *data* logic: which weight column applies to which
demographic, the Atlanta oversample special case, response
aliasing/sorting/coloring, per-question custom orders and colors. None of
that is re-implemented in JavaScript here. Instead, it's split across two
build-time-only stages, in two different repos, neither of which ships
anything to the browser:

- **`MAS_Pipeline/main_crosstab.py`** owns the *data* half: which weight
  column applies to which demographic (metrowt/countywt/atlwt, including
  the Atlanta oversample special case). It reads `MAS_Pipeline`'s own
  cleaned survey parquet and writes `crosstab_long.parquet` -- raw weighted
  sums per (question, year, demographic type, demographic value, response),
  every response category included (DK and all; response exclusion doesn't
  change a percentage's denominator, so it's a presentation decision, not a
  data one -- see that script's docstring). Zero knowledge of this
  dashboard's presentation choices.
- **`scripts/build_static_data.py`** (this repo) owns the *presentation*
  half: percent computation, response exclusion/aliasing, sort order,
  colors, demographic exclusion/renaming/ordering -- via `scripts/lib/
  chart_config.py`, a port of `MAS_Dashboard_App/lib/chart_config.py`'s
  `resolve_chart_config()` / `resolve_demographic_grouping()`, driven by
  this repo's own `config/*.yaml` (verbatim copies of `MAS_Dashboard_App/
  config/*.yaml`). Reads `MAS_Pipeline`'s two output files (copied in by
  hand to `data/pipeline_input/`) and writes the fully-resolved
  `data/dashboard_data.json`.
- Every `.js` file's job is purely **lookup + render + interact** --
  looking up an already-resolved view in that JSON and drawing it, never
  recomputing anything from raw survey records.
- This build has **no dependency on `MAS_Dashboard_App`** at all (neither
  its code nor a live process) -- see "Rebuilding the data" below for the
  full pipeline and why the split sits where it does.

## Project layout

```
index.html                    # splash/landing page -- intro blurb + "Enter the Dashboard" CTA, no charts
metro_summary.html            # Metro Summary dashboard page (shell + nav)
demographic_breakdown.html    # Demographic Breakdown page
faq.html                      # FAQ page (static content, no data)
css/style.css                 # all styles -- ported from lib/chrome.py's CSS + lib/mobile_views.py's inline styles
js/
  data.js                     # loads + queries data/dashboard_data.json
  state.js                    # cross-page shared state (sessionStorage-backed)
  charts.js                   # Plotly.js chart builders (desktop) -- mirrors lib/charts.py
  mobileViews.js               # label-above-bar / card-list HTML builders -- mirrors lib/mobile_views.py
  questionPicker.js            # custom desktop question dropdown (colored category badge/trend label)
  scrollIndicator.js           # shared bottom-right "scroll down" button, every page
  splash.js                    # splash page controller -- appends the mobile "best on desktop" note to the blurb
  metroSummary.js              # Metro Summary page orchestration -- mirrors metro_summary.py
  demographicBreakdown.js      # Demographic Breakdown page orchestration -- mirrors demographic_breakdown.py
config/                       # chart_configs.yaml/questions.yaml/demographics.yaml -- verbatim copies of
                               #   MAS_Dashboard_App/config/*.yaml, this build's presentation rules
data/
  dashboard_data.json          # precomputed data (see "Rebuilding the data" below)
  pipeline_input/               # crosstab_long.parquet + questions_meta.parquet, copied by hand from MAS_Pipeline
assets/                       # logos, copied from MAS_Dashboard_App/Assets/
scripts/
  build_static_data.py         # reads data/pipeline_input/*.parquet + config/*.yaml, writes dashboard_data.json
  lib/chart_config.py          # ported from MAS_Dashboard_App/lib/chart_config.py (no Streamlit)
```

The site logo in the header links back to `index.html` (the splash page) on
every page; the nav bar's "Metro Summary" link goes to `metro_summary.html`.

There is intentionally no `package.json`, no bundler config, and no
framework. Every HTML page just loads Plotly.js from a pinned CDN URL and
these `.js` files via plain `<script>` tags.

## Running it locally

Any static file server works -- it just needs to be an actual HTTP server
(not a `file://` URL), since the pages `fetch()` `data/dashboard_data.json`
and browsers block `fetch()` against `file://` origins.

```bash
cd MAS_Dashboard_App_Static_JS
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

## Rebuilding the data

This build has **no dependency on `MAS_Dashboard_App`** -- data flows from
`MAS_Pipeline` (the ETL repo) directly into this one:

```
MAS_Pipeline/
  main_cln.py -> main_dshbrd.py -> MAS_Dashboard_Records_<year>_Updated.parquet
  main_crosstab.py                 (NEW -- reads that parquet)
       |
       +--> crosstab_long.parquet    -- raw weighted sums, every response
       |                                category incl. DK, weight column
       |                                (metrowt/countywt/atlwt) already
       |                                correctly resolved. Zero knowledge
       |                                of chart_configs/questions/
       |                                demographics.yaml -- MAS_Pipeline
       |                                has no dashboard-specific opinions.
       +--> questions_meta.parquet    -- question/year -> q_short/q_verb
                                          lookup, no aggregation.
```

Copy both files into this repo by hand (same "regenerate by hand when the
source changes" pattern as everything else in this workspace):

```bash
cd MAS_Pipeline
python3 main_cln.py && python3 main_dshbrd.py && python3 main_crosstab.py
cp crosstab_long.parquet questions_meta.parquet \
  /path/to/MAS_Dashboard_App_Static_JS/data/pipeline_input/
```

Then, in this repo, `scripts/build_static_data.py` reads those two files
plus this repo's own `config/{chart_configs,questions,demographics}.yaml`
(verbatim copies of `MAS_Dashboard_App/config/*.yaml` -- re-copy them here
by hand if they ever change there) and applies all the presentation
decisions -- percent computation, response exclusion/aliasing, sort order,
colors, demographic exclusion/renaming/ordering -- via `scripts/lib/
chart_config.py` (a port of `MAS_Dashboard_App/lib/chart_config.py`, same
logic, no Streamlit):

```bash
python3 scripts/build_static_data.py
```

`MAS_Dashboard_App` (the Streamlit app) is completely unaffected by any of
this -- it still works exactly as it did before, with its own independent
copy of everything it needs.

After regenerating, spot-check the new file against golden survey values
the same way `MAS_Pipeline/validate_against_arc_report.py` does (bigprob
2025, metro-wide / Cherokee county / Male gender) before trusting it, and
ideally deep-diff the new `dashboard_data.json` against the previous one --
every difference should be explainable (a real data change) rather than a
silent regression. There is no runtime Python here to catch a bad
regeneration, so this JSON *is* this build's correctness backstop.

## Deploying

Not yet deployed to a public host. Since there's no server-side process
and no build step, any static host (GitHub Pages, Netlify, S3 + CloudFront,
etc.) works by simply serving this directory's files as-is -- the same
"git is the deployment" relationship `MAS_Dashboard_App_Static_Streamlit/`
uses. `data/dashboard_data.json` is committed to this repo (unlike the
server app's `.gitignore`'d parquet file) for exactly that reason: for a
static site, whatever's in the repo becomes the live site.

## What's verified

- **Phase 0 (data):** `data/dashboard_data.json`'s numbers checked
  directly against the same golden values
  `MAS_Dashboard_App/scripts/validate_against_golden.py` uses (bigprob
  2025 metro-wide/Cherokee-county/Male-gender) -- all within tolerance.
- **Visual fidelity:** every chart type (topline bar, demographic stacked
  bar, trend line) screenshot-compared directly against the live server
  app rendering the same question/year/demographic, including a
  non-obvious behavior confirmed by inspecting the reference app rather
  than assumed: Plotly Express reverses a horizontal bar chart's category
  axis (first category renders at the *top*, not the bottom) -- reproduced
  here via `yaxis.autorange = "reversed"`.
- **Click-to-drill reliability:** the desktop stacked bar chart's
  click-to-drill was the exact feature that had a real, reproduced
  "needs two clicks" bug in the Streamlit build earlier in this project's
  history (root cause: a caching-induced frontend timing race in
  Streamlit's own `Plotly.react()` reconciliation). This build's own
  click handling was stress-tested rather than assumed reliable just
  because it's a from-scratch implementation: 10/10 trials clicking a bar
  immediately after switching demographic type (the exact scenario that
  broke the Streamlit build), plus an 8-rapid-clicks-at-150ms-intervals
  stress test. One real bug *was* found and fixed this way: the click
  listener was originally attached inside `Plotly.newPlot(...).then(...)`,
  leaving a window where a fast click landed after the chart was visually
  rendered but before its handler was reattached, silently dropping the
  click. Fixed by attaching the listener synchronously right after calling
  `Plotly.newPlot()` instead of inside its resolved promise.
- **Full interaction sweep:** both pages, all 11 demographic types, a
  sample of questions/years, mobile and desktop, the Topline/Detailed page
  switch (with state carrying over), a missing-demographic-data warning
  path, and an Income-demographic "$" label check -- zero console/page
  errors.

## Deliberate differences from the server app

Ported *design*, not re-decided it -- these are the only intentional
departures, each because the server app's behavior was an accidental
side-effect of its implementation rather than a real design choice:

- **Mobile detection: `window.matchMedia`, not User-Agent sniffing.**
  Neither the server app nor the stlite build could read a real
  `User-Agent` reliably (`st.context.headers` is empty/synthetic in
  stlite; a real server sees it but the header is a notoriously unreliable
  signal anyway). This build checks the real browser viewport directly
  (`window.matchMedia("(max-width: 768px)")`), seeded once per session --
  a strictly more direct signal than either prior build had. There's no
  manual override control on the page anymore (the old "Use Mobile View"
  checkbox was removed); mobile visitors instead see a sentence appended to
  the end of the splash page's intro blurb noting the dashboard is best
  viewed on desktop (see `splash.js`) -- read as part of the page's own
  copy rather than an interruption.
- **One shared "selected demographic value" key for both mobile and
  desktop**, instead of the server app's two independent ones (the
  desktop Plotly widget's own internal Streamlit state vs. mobile's
  separate `mobile_selected_demo_value__*` session-state key). In the
  server app, selecting a group on desktop then toggling to mobile view
  didn't carry the selection over, and vice versa -- an artifact of two
  different state-naming schemes, not something anyone decided should
  happen. This build's `state.js` uses one `sessionStorage` key per
  demographic column for both, so a selection survives toggling the
  view.
- **The Income "$" bracket labels never needed a workaround here.** The
  server app's mobile view had to manually escape literal `$` characters
  (`_escape_dollar()` in `lib/mobile_views.py`) because Streamlit's
  markdown renderer misparsed `"$25k-$60k"`-style text as LaTeX math. This
  build writes plain HTML text nodes directly (`element.textContent`),
  which never interprets `$` as anything special -- not a redesign, just
  a bug class that structurally cannot exist in this implementation.

Everything else -- colors, chart sizing formulas, hover tooltip text,
sort orders, mobile card design, the (currently non-functional in the
server app too) decorative scroll indicator -- is a direct, deliberate
port of the same choices already made and iterated on in
`MAS_Dashboard_App/`.

## Explicitly out of scope

Keeping `data/dashboard_data.json` in sync automatically when the source
data changes (manual re-run, documented above, not automated); actual
deployment to a public host; any build step, bundler, or frontend
framework.
