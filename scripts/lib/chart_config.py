"""Config (config/*.yaml) loading and chart resolution.

Ported from MAS_Dashboard_App/lib/chart_config.py (+ fallback_color_map /
FALLBACK_PALETTE from lib/charts.py / lib/constants.py), for use by
scripts/build_static_data.py -- a build-time-only tool, so every
@st.cache_data decorator and the streamlit import are dropped (no Streamlit
here; each function just runs once per invocation anyway). CONFIG_DIR is
repointed at this repo's own config/ (a verbatim copy of MAS_Dashboard_App's,
kept here so this repo has no runtime or build-time dependency on
MAS_Dashboard_App at all). Every other line of logic is unchanged.
"""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config"
DEFAULT_CHART_CONFIGS_PATH = CONFIG_DIR / "chart_configs.yaml"
DEFAULT_QUESTIONS_PATH = CONFIG_DIR / "questions.yaml"
DEFAULT_DEMOGRAPHICS_PATH = CONFIG_DIR / "demographics.yaml"

# Used only when a question/year has no custom_colors entry in
# chart_configs.yaml (rare -- almost every MAS question already has
# hand-picked colors).
FALLBACK_PALETTE = [
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
]


@dataclass
class ResolvedChartData:
    """Output of resolve_chart_config(): everything needed to write one
    (question, year[, demographic]) view into dashboard_data.json.

    data : filtered dataframe (excluded responses dropped), with percent,
        response_display, and order columns added, sorted.
    sort_order : display-value order.
    color_map : response_display -> hex color, already alias-normalized so
        callers never have to reason about original-vs-aliased labels.
        None means "no custom colors defined -- use FALLBACK_PALETTE".
    """

    data: pd.DataFrame
    sort_order: list
    color_map: dict | None


def fallback_color_map(categories: list[str]) -> dict[str, str]:
    """Cycles FALLBACK_PALETTE across whatever categories are present."""
    import itertools

    return dict(zip(categories, itertools.cycle(FALLBACK_PALETTE)))


def load_chart_configs(path: Path | str = DEFAULT_CHART_CONFIGS_PATH) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def load_questions_config(path: Path | str = DEFAULT_QUESTIONS_PATH) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def load_demographics_config(path: Path | str = DEFAULT_DEMOGRAPHICS_PATH) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def resolve_chart_config(
    grouped: pd.DataFrame,
    config: dict,
    value_col: str = "weight",
    group_cols: list[str] | None = None,
    default_sort: str = "percent_desc",
    round_before_percent: bool = False,
    response_col: str = "response",
) -> ResolvedChartData:
    """Turns an already weight-summed (grouped) DataFrame into everything a
    chart needs: percentages, response exclusion, aliasing, sort order, and
    colors -- driven by `config` (chart_configs[question].get(str(year), {})).

    Parameters
    ----------
    grouped : pd.DataFrame
        One row per (group, response), with the raw weighted-sum in
        value_col. The caller does the groupby/sum step -- this function
        only turns that into percentages and resolves config.
    value_col : str
        Column in `grouped` holding the raw weighted sum to convert to percent.
    group_cols : list[str] | None
        None for the topline distribution (percent over the whole table);
        ["year"] for both trend charts (percent within each year);
        [demo_column] for the demographic crosstab (percent within each
        demographic value).
    default_sort : "percent_desc" | "alpha"
        Sort to fall back to when `config` has no custom_order.
    round_before_percent : bool
        The ARC nearest-whole-person rounding convention (round each
        weighted cell before dividing). Off by default.
    response_col : str
        Column in `grouped` holding the raw (pre-alias) response value.
    """
    data = grouped.copy()

    value = data[value_col].round(0) if round_before_percent else data[value_col]
    if group_cols:
        data["percent"] = value.groupby([data[c] for c in group_cols]).transform(lambda s: s / s.sum())
    else:
        data["percent"] = value / value.sum()

    # exclude_responses is applied AFTER percent is computed, over the full
    # (unfiltered) total -- so a category dropped here doesn't shrink other
    # categories' denominators; it just doesn't get displayed. This is why
    # the dashboard's own caption reads "Remaining percentages are either
    # Don't Know or Not Available" instead of the shown percentages summing
    # to 100%.
    exclude = set(config.get("exclude_responses") or [])
    if exclude:
        data = data[~data[response_col].isin(exclude)]

    aliases = config.get("response_aliases") or {}
    if aliases:
        data["response_display"] = data[response_col].map(aliases).fillna(data[response_col])
    else:
        data["response_display"] = data[response_col]

    custom_order = config.get("custom_order")
    if custom_order:
        order_map = {resp: i for i, resp in enumerate(custom_order)}
        data["order"] = data["response_display"].map(order_map)
        data = data.sort_values("order")
        sort_order = list(custom_order)
    elif default_sort == "alpha":
        sort_order = sorted(data["response_display"].unique().tolist())
        data = data.sort_values("response_display")
    else:
        data = data.sort_values("percent", ascending=False)
        sort_order = data["response_display"].drop_duplicates().tolist()

    custom_colors = config.get("custom_colors")
    color_map = None
    if custom_colors:
        color_map = {aliases.get(raw, raw): color for raw, color in custom_colors.items()}

    return ResolvedChartData(data=data, sort_order=sort_order, color_map=color_map)


def resolve_demographic_grouping(
    data: pd.DataFrame,
    selected_demographic: str,
    demo_column: str,
    excluded_demographics: dict,
    demo_grp_order: dict,
    demo_grp_rename: dict,
) -> tuple[pd.DataFrame, str, list[str] | None]:
    """The demographic-axis counterpart to resolve_chart_config: filters out
    excluded demographic-group *values* (distinct from resolve_chart_config's
    exclude_responses, which drops response values), applies group display
    renaming, and resolves the demographic-group sort order.

    Call this on `resolve_chart_config(...).data` (i.e. after response-side
    filtering/aliasing/percent computation), not before.

    Parameters
    ----------
    data : pd.DataFrame
        Already response-resolved (output of resolve_chart_config).
    selected_demographic : str
        The demographic *type*, e.g. "Jurisdiction", "Gender" -- the key
        into all 3 of the dicts below.
    demo_column : str
        The raw column name holding the demographic *values* (e.g. "county"
        for "Jurisdiction").
    excluded_demographics, demo_grp_order, demo_grp_rename : dict
        From config/demographics.yaml.

    Returns
    -------
    (filtered_data, demo_display_column, demo_sort_order)
        demo_display_column is `demo_column` itself when no rename map
        applies, or f"{demo_column}_display" (new column) when one does.
        demo_sort_order is None when demo_grp_order has no entry for this
        demographic.
    """
    data = data.copy()

    excluded = excluded_demographics.get(selected_demographic)
    if excluded:
        data = data[~data[demo_column].isin(excluded)]

    rename_map = demo_grp_rename.get(selected_demographic)
    if rename_map:
        display_col = f"{demo_column}_display"
        data[display_col] = data[demo_column].map(rename_map).fillna(data[demo_column])
    else:
        display_col = demo_column

    order = demo_grp_order.get(selected_demographic)
    if order:
        order_map = {grp: i for i, grp in enumerate(order)}
        data["demo_order"] = data[demo_column].map(order_map)
        data = data.sort_values("demo_order")
        full_sort_order = [rename_map.get(grp, grp) if rename_map else grp for grp in order]
        # Filter the fixed cross-year order down to only the values
        # actually present in THIS (question, year) slice -- an absent
        # jurisdiction shouldn't reserve an empty labeled axis slot.
        present = set(data[display_col].unique())
        demo_sort_order = [label for label in full_sort_order if label in present]
    else:
        demo_sort_order = None

    return data, display_col, demo_sort_order
