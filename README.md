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
that is re-implemented in JavaScript here. Instead:

- **`scripts/build_static_data.py`** (a **build-time-only** Python script,
  run by a developer, never shipped to the browser) imports
  `lib.aggregation`, `lib.chart_config`, and `lib.data` **directly from
  the sibling `MAS_Dashboard_App/` project** (via `sys.path`) and calls
  the exact same `resolve_chart_config()` / `resolve_demographic_grouping()`
  / `get_*_grouped()` functions already used and verified in that project,
  once per real (question, year[, demographic[, value]]) combination. The
  fully-resolved output (sort orders, colors, percentages) is written to
  `data/dashboard_data.json`.
- Every `.js` file's job is purely **lookup + render + interact** --
  looking up an already-resolved view in that JSON and drawing it, never
  recomputing anything from raw survey records.
- This makes `scripts/build_static_data.py` -> `MAS_Dashboard_App/` the
  one deliberate exception to this workspace's usual "independent sibling
  projects, no shared imports" pattern, and only at build time, similar in
  spirit to how `scripts/reconcile_chart_configs.py` referenced the old
  `Streamlit_App` sibling during that project's original build-out.

## Project layout

```
index.html                    # Metro Summary page (shell + nav)
demographic_breakdown.html    # Demographic Breakdown page
faq.html                      # FAQ page (static content, no data)
css/style.css                 # all styles -- ported from lib/chrome.py's CSS + lib/mobile_views.py's inline styles
js/
  data.js                     # loads + queries data/dashboard_data.json
  state.js                    # cross-page shared state (sessionStorage-backed)
  charts.js                   # Plotly.js chart builders (desktop) -- mirrors lib/charts.py
  mobileViews.js               # label-above-bar / card-list HTML builders -- mirrors lib/mobile_views.py
  main.js                     # small shared bootstrap (mobile toggle wiring)
  metroSummary.js              # Metro Summary page orchestration -- mirrors metro_summary.py
  demographicBreakdown.js      # Demographic Breakdown page orchestration -- mirrors demographic_breakdown.py
data/dashboard_data.json      # precomputed data (see "Rebuilding the data" below)
assets/                       # logos, copied from MAS_Dashboard_App/Assets/
scripts/build_static_data.py  # the precompute script described above
```

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

`data/dashboard_data.json` is **not** kept in sync automatically -- like
`config/chart_configs.yaml` elsewhere in this workspace, it's a
"regenerate by hand when the source changes" artifact. Re-run the build
script whenever `MAS_Dashboard_App/Data/*.parquet`, `MAS_Dashboard_App/lib/`,
or `MAS_Dashboard_App/config/*.yaml` change:

```bash
cd MAS_Dashboard_App          # the sibling project -- has the pixi env with pandas/pyarrow/plotly/streamlit
pixi run -e dev python /path/to/MAS_Dashboard_App_Static_JS/scripts/build_static_data.py
```

(It imports `lib/`/`config/` from `MAS_Dashboard_App/`, so it needs to run
in an environment with that project's dependencies installed -- its own
`pixi` dev environment is the easiest way, even though the script itself
lives in this sibling project.)

After regenerating, spot-check the new file against golden survey values
the same way `MAS_Dashboard_App/scripts/validate_against_golden.py` does
(bigprob 2025, metro-wide / Cherokee county / Male gender) before trusting
it -- there is no runtime Python here to catch a bad regeneration, so this
JSON *is* this build's correctness backstop.

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
  (`window.matchMedia("(max-width: 768px)")`), seeded once per session and
  overridable via the same checkbox the server app has -- a strictly more
  direct signal, and free live updates on resize/rotation.
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
