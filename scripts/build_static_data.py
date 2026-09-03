#!/usr/bin/env python3
"""Precomputes every real (question, year[, demographic]) view's fully-
resolved chart data into one static JSON file for the hand-written JS static
build to read at runtime -- no Python/pandas at runtime, just lookup + render.

This build-time-only tool has NO dependency on MAS_Dashboard_App. It reads
two build-time inputs instead:

  1. data/pipeline_input/{crosstab_long,questions_meta}.parquet -- produced by
     MAS_Pipeline/main_crosstab.py (copy them here by hand after running that
     script, same "regenerate by hand when it changes" pattern as everything
     else in this workspace). Pure weighted survey facts: every response
     category (DK included, nothing excluded), correctly weighted
     (metrowt/countywt/atlwt already resolved -- this script never needs to
     know which weight column was used). MAS_Pipeline deliberately has zero
     knowledge of chart_configs.yaml/questions.yaml/demographics.yaml -- all
     presentation decisions (sort order, colors, aliases, which responses to
     hide) are this repo's own, applied below.
  2. config/{chart_configs,questions,demographics}.yaml -- verbatim copies of
     MAS_Dashboard_App/config/*.yaml (that remains their source of truth;
     re-copy here if they change).

scripts/lib/chart_config.py (a port of MAS_Dashboard_App/lib/chart_config.py)
does the actual percent/exclude/alias/order/color resolution -- unchanged
logic, just fed from the crosstab file instead of live grouped DataFrames.

Mirrors metro_summary.py's and demographic_breakdown.py's own control flow
closely (same guards, same edge cases) rather than re-deriving the logic
independently, to minimize the chance of silently diverging from
already-verified behavior.
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.chart_config import (  # noqa: E402
    fallback_color_map,
    load_chart_configs,
    load_demographics_config,
    load_questions_config,
    resolve_chart_config,
    resolve_demographic_grouping,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_INPUT_DIR = REPO_ROOT / "data" / "pipeline_input"
OUT_PATH = REPO_ROOT / "data" / "dashboard_data.json"


def resolved_to_dict(resolved, percent_col="percent", response_col="response_display"):
    """(sort_order, colors) from a ResolvedChartData -- colors always
    resolved (fallback_color_map applied when color_map is None), matching
    every renderer in the server app (`color_map or fallback_color_map(...)`)."""
    colors = resolved.color_map or fallback_color_map(resolved.sort_order)
    return resolved.sort_order, {k: colors.get(k, "#999999") for k in resolved.sort_order}


def percents_by_response(df, response_col="response_display", percent_col="percent"):
    return dict(zip(df[response_col], df[percent_col]))


def by_year_dict(resolved_data, percent_col="percent"):
    """{year_str: {response_display: percent}} from a resolve_chart_config
    result whose group_cols included "year"."""
    out = {}
    for year_val, sub in resolved_data.groupby("year"):
        out[str(int(year_val))] = percents_by_response(sub, percent_col=percent_col)
    return out


def main():
    crosstab = pd.read_parquet(PIPELINE_INPUT_DIR / "crosstab_long.parquet")
    meta = pd.read_parquet(PIPELINE_INPUT_DIR / "questions_meta.parquet")

    chart_configs = load_chart_configs()
    questions_cfg = load_questions_config()
    question_map = questions_cfg["question_map"]
    question_hist = questions_cfg["question_hist"]
    demographics_cfg = load_demographics_config()
    demo_col_map = demographics_cfg["demo_col_map"]
    excluded_demographics = demographics_cfg["excluded_demographics"]
    demo_grp_order = demographics_cfg["demo_grp_order"]
    demo_grp_rename = demographics_cfg["demo_grp_rename"]

    # The trend/historical charts always use *this* year's config across
    # every year of data (see resolve_chart_config's docstring) -- a single
    # global year, matching MAS_Dashboard_App/lib/constants.CURRENT_SURVEY_YEAR,
    # not each question's own max year (which happens to be the same today,
    # since main_dshbrd.py's filter_to_target_year already keeps only
    # questions asked in the current year, but isn't guaranteed to stay that
    # way and shouldn't be relied on implicitly).
    current_survey_year = max(int(y) for y in meta["year"].unique())

    # Question display order: BIGPROBLEM first, then alphabetical -- exactly
    # matching both page scripts' own ordering.
    q_shorts = meta["q_short"].unique().tolist()
    bigprob_q = [q for q in q_shorts if "BIGPROBLEM" in q]
    other_q = [q for q in q_shorts if "BIGPROBLEM" not in q]
    q_shorts_ordered = bigprob_q + sorted(other_q)

    questions_out = []
    topline_out = {}
    metro_trend_out = {}
    crosstab_out = {}
    historical_out = {}

    demographics_out = [{"name": name, "column": col} for name, col in demo_col_map.items()]

    total_topline = total_trend = total_crosstab = total_hist = 0

    for q_short in q_shorts_ordered:
        question = question_map[q_short]
        has_trend = question_hist.get(question, 0) == 1
        meta_question = meta[meta["question"] == question]
        years = sorted(int(y) for y in meta_question["year"].unique())
        end_date = f"{max(years)}-12-31" if years else None

        question_config = chart_configs.get(question, {})

        verb_by_year = {}
        for row in meta_question.itertuples():
            verb_by_year[str(row.year)] = row.q_verb

        questions_out.append(
            {
                "key": question,
                "short": q_short,
                "display": f"{q_short} {'(Trend Available)' if has_trend else '(No Trend)'}",
                "has_trend": has_trend,
                "years": years,
                "verb_by_year": verb_by_year,
            }
        )

        question_crosstab = crosstab[crosstab["question"] == question]

        # --- Topline (Metro Summary Response Distribution) ---
        for year in years:
            grouped = question_crosstab[
                (question_crosstab["year"] == year) & (question_crosstab["demo_type"] == "metroresp")
            ]
            if len(grouped) == 0:
                continue
            config = question_config.get(str(year), {})
            resolved = resolve_chart_config(grouped, config, value_col="weight", group_cols=None, default_sort="percent_desc")
            sort_order, colors = resolved_to_dict(resolved)
            topline_out[f"{question}|{year}"] = {
                "sort_order": sort_order,
                "colors": colors,
                "percents": percents_by_response(resolved.data),
            }
            total_topline += 1

        # --- Metro-wide Year-over-Year Trend (only if flagged) ---
        if has_trend:
            grouped_trend = question_crosstab[question_crosstab["demo_type"] == "metroresp"]
            if len(grouped_trend) > 0:
                trend_config = question_config.get(str(current_survey_year), {})
                resolved_trend = resolve_chart_config(
                    grouped_trend, trend_config, value_col="weight", group_cols=["year"], default_sort="alpha"
                )
                sort_order, colors = resolved_to_dict(resolved_trend)
                metro_trend_out[question] = {
                    "sort_order": sort_order,
                    "colors": colors,
                    "end_date": end_date,
                    "by_year": by_year_dict(resolved_trend.data),
                }
                total_trend += 1

        # --- Demographic crosstabs + historical trends ---
        # Every (demo_value) ever seen for this question, per demographic
        # type, across all its years -- historical trend is computed once
        # per (question, demo_type, demo_value), not per year.
        demo_values_seen: dict[str, set[str]] = {name: set() for name in demo_col_map}

        for year in years:
            year_crosstab = question_crosstab[question_crosstab["year"] == year]
            if len(year_crosstab) == 0:
                continue
            config = question_config.get(str(year), {})

            for selected_demographic, demo_column in demo_col_map.items():
                grouped = year_crosstab[year_crosstab["demo_type"] == demo_column]
                if len(grouped) == 0:
                    continue
                grouped = grouped.rename(columns={"demo_value": demo_column})
                resolved = resolve_chart_config(
                    grouped, config, value_col="weight", group_cols=[demo_column], default_sort="percent_desc"
                )
                demo_data, demo_display_col, demo_sort_order = resolve_demographic_grouping(
                    resolved.data, selected_demographic, demo_column, excluded_demographics, demo_grp_order, demo_grp_rename
                )
                if len(demo_data) == 0:
                    continue

                response_sort_order, colors = resolved_to_dict(resolved)
                question_title = verb_by_year[str(year)]
                subtitle = f"Response by {selected_demographic} Demographic ({year})"

                groups_present = list(demo_data[demo_display_col].unique())
                ordered_groups = [g for g in (demo_sort_order or sorted(groups_present)) if g in groups_present]

                groups_json = []
                for group_display in ordered_groups:
                    group_rows = demo_data[demo_data[demo_display_col] == group_display]
                    group_raw = group_rows[demo_column].iloc[0]
                    groups_json.append(
                        {
                            "group_raw": str(group_raw),
                            "group_display": str(group_display),
                            "percents": percents_by_response(group_rows, percent_col="percent"),
                        }
                    )
                    demo_values_seen[selected_demographic].add(str(group_raw))

                crosstab_out[f"{question}|{year}|{selected_demographic}"] = {
                    "question_title": question_title,
                    "subtitle": subtitle,
                    "response_sort_order": response_sort_order,
                    "colors": colors,
                    "has_custom_order": bool(config.get("custom_order")),
                    "groups": groups_json,
                }
                total_crosstab += 1

        if has_trend:
            for selected_demographic, demo_column in demo_col_map.items():
                for demo_value in sorted(demo_values_seen[selected_demographic]):
                    grouped_hist = question_crosstab[
                        (question_crosstab["demo_type"] == demo_column) & (question_crosstab["demo_value"] == demo_value)
                    ]
                    if len(grouped_hist) == 0:
                        continue
                    hist_config = question_config.get(str(current_survey_year), {})
                    resolved_hist = resolve_chart_config(
                        grouped_hist, hist_config, value_col="weight", group_cols=["year"], default_sort="alpha"
                    )
                    sort_order, colors = resolved_to_dict(resolved_hist)
                    historical_out[f"{question}|{selected_demographic}|{demo_value}"] = {
                        "sort_order": sort_order,
                        "colors": colors,
                        "end_date": end_date,
                        "by_year": by_year_dict(resolved_hist.data),
                    }
                    total_hist += 1

    output = {
        "current_survey_year": current_survey_year,
        "questions": questions_out,
        "demographics": demographics_out,
        "topline": topline_out,
        "metro_trend": metro_trend_out,
        "crosstab": crosstab_out,
        "historical": historical_out,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT_PATH} ({size_mb:.2f} MB)")
    print(f"  {len(questions_out)} questions")
    print(f"  {total_topline} topline views")
    print(f"  {total_trend} metro-trend views")
    print(f"  {total_crosstab} crosstab views")
    print(f"  {total_hist} historical-trend views")


if __name__ == "__main__":
    main()
