#!/usr/bin/env python3
"""Precomputes every real (question, year[, demographic]) view's fully-
resolved chart data into one static JSON file for the hand-written JS
static build to read at runtime -- no Python/pandas at runtime, just
lookup + render.

This is a build-time-only tool: it imports lib/ directly from the sibling
MAS_Dashboard_App/ project (the same aggregation/config-resolution code
already verified via that project's scripts/validate_against_golden.py
and scripts/smoke_test_charts.py), so none of the subtle data logic
(weight-column selection, the Atlanta oversample special case, response
aliasing/sorting/coloring) gets re-derived or re-debugged here -- it's
computed once, correctly, and dumped to data/dashboard_data.json. Rerun
this by hand whenever the source parquet or MAS_Dashboard_App/lib/
changes (this script's output is not kept in sync automatically, same
"regenerate by hand when it changes" pattern as config/chart_configs.yaml
elsewhere in this workspace).

Mirrors metro_summary.py's and demographic_breakdown.py's own control
flow closely (same guards, same edge cases) rather than re-deriving the
logic independently, to minimize the chance of silently diverging from
already-verified behavior.
"""

import json
import sys
from pathlib import Path

SERVER_APP_DIR = Path("/Users/billhuang/Projects/MAS_Dashboard_App")
sys.path.insert(0, str(SERVER_APP_DIR))

import pandas as pd  # noqa: E402

from lib.aggregation import (  # noqa: E402
    get_demographic_grouped,
    get_demographic_historical_grouped,
    get_metro_trend_grouped,
    get_topline_grouped,
)
from lib.chart_config import (  # noqa: E402
    load_chart_configs,
    load_demographics_config,
    load_questions_config,
    resolve_chart_config,
    resolve_demographic_grouping,
)
from lib.charts import fallback_color_map  # noqa: E402
from lib.constants import CURRENT_SURVEY_YEAR  # noqa: E402
from lib.data import load_survey_data  # noqa: E402

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "dashboard_data.json"


def resolved_to_dict(resolved, percent_col="percent", response_col="response_display"):
    """(sort_order, colors) from a ResolvedChartData -- colors always
    resolved (fallback_color_map applied when color_map is None), matching
    every renderer in the server app (`color_map or fallback_color_map(...)`)."""
    colors = resolved.color_map or fallback_color_map(resolved.sort_order)
    return resolved.sort_order, {k: colors.get(k, "#999999") for k in resolved.sort_order}


def percents_by_response(df, response_col="response_display", percent_col="percent"):
    return dict(zip(df[response_col], df[percent_col]))


def main():
    df = load_survey_data()
    chart_configs = load_chart_configs()
    questions_cfg = load_questions_config()
    question_map = questions_cfg["question_map"]
    question_hist = questions_cfg["question_hist"]
    demographics_cfg = load_demographics_config()
    demo_col_map = demographics_cfg["demo_col_map"]
    excluded_demographics = demographics_cfg["excluded_demographics"]
    demo_grp_order = demographics_cfg["demo_grp_order"]
    demo_grp_rename = demographics_cfg["demo_grp_rename"]

    # Question display order: BIGPROBLEM first, then alphabetical --
    # exactly matching both page scripts' own ordering.
    q_shorts = df["q_short"].unique().tolist()
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
        df_question = df[df["question"] == question]
        years = sorted(int(y) for y in df_question["survey year"].dropna().unique())
        end_date = f"{max(years)}-12-31" if years else None

        question_config = chart_configs.get(question, {})

        verb_by_year = {}
        for year in years:
            df_yf = df_question[df_question["survey year"] == year]
            if "q_verb" in df_yf.columns and len(df_yf):
                verb_by_year[str(year)] = df_yf["q_verb"].iloc[0]
            else:
                verb_by_year[str(year)] = q_short

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

        # --- Topline (Metro Summary Response Distribution) ---
        for year in years:
            grouped = get_topline_grouped(question, year)
            if len(grouped) == 0:
                continue
            config = question_config.get(str(year), {})
            resolved = resolve_chart_config(
                grouped, config, value_col="metrowt", group_cols=None, default_sort="percent_desc"
            )
            sort_order, colors = resolved_to_dict(resolved)
            topline_out[f"{question}|{year}"] = {
                "sort_order": sort_order,
                "colors": colors,
                "percents": percents_by_response(resolved.data),
            }
            total_topline += 1

        # --- Metro-wide Year-over-Year Trend (only if flagged) ---
        if has_trend:
            grouped_trend = get_metro_trend_grouped(question)
            if len(grouped_trend) > 0:
                trend_config = question_config.get(str(CURRENT_SURVEY_YEAR), {})
                resolved_trend = resolve_chart_config(
                    grouped_trend, trend_config, value_col="metrowt", group_cols=["survey year"], default_sort="alpha"
                )
                sort_order, colors = resolved_to_dict(resolved_trend)
                by_year = {}
                for year_str, sub in resolved_trend.data.groupby("survey year"):
                    by_year[year_str] = percents_by_response(sub)
                metro_trend_out[question] = {
                    "sort_order": sort_order,
                    "colors": colors,
                    "end_date": end_date,
                    "by_year": by_year,
                }
                total_trend += 1

        # --- Demographic crosstabs + historical trends ---
        # Every (demo_value) ever seen for this question, per demographic
        # type, across all its years -- historical trend is computed once
        # per (question, demo_type, demo_value), not per year.
        demo_values_seen: dict[str, set[str]] = {name: set() for name in demo_col_map}

        for year in years:
            df_yf = df_question[df_question["survey year"] == year]
            if len(df_yf) == 0:
                continue
            config = question_config.get(str(year), {})

            for selected_demographic, demo_column in demo_col_map.items():
                grouped = get_demographic_grouped(question, year, demo_column, selected_demographic)
                if len(grouped) == 0:
                    continue
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
                    grouped_hist, weight_column = get_demographic_historical_grouped(
                        question, selected_demographic, demo_column, demo_value
                    )
                    if grouped_hist is None or len(grouped_hist) == 0:
                        continue
                    hist_config = question_config.get(str(CURRENT_SURVEY_YEAR), {})
                    resolved_hist = resolve_chart_config(
                        grouped_hist,
                        hist_config,
                        value_col=weight_column,
                        group_cols=["survey year"],
                        default_sort="alpha",
                    )
                    sort_order, colors = resolved_to_dict(resolved_hist)
                    by_year = {}
                    for year_str, sub in resolved_hist.data.groupby("survey year"):
                        by_year[year_str] = percents_by_response(sub)
                    historical_out[f"{question}|{selected_demographic}|{demo_value}"] = {
                        "sort_order": sort_order,
                        "colors": colors,
                        "end_date": end_date,
                        "by_year": by_year,
                    }
                    total_hist += 1

    output = {
        "current_survey_year": CURRENT_SURVEY_YEAR,
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
