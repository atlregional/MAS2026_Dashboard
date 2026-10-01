#!/usr/bin/env python3
"""Builds data/dashboard_data.json, the only data file the dashboard reads.

Inputs:
  - data/pipeline_input/crosstab_long_<survey_year>.parquet and
    questions_meta_<survey_year>.parquet (survey_year from config/dashboard.yaml),
    copied from MAS_Pipeline (see README). Weighted sums per question, year,
    demographic group and response, with every response included.
  - config/chart_configs.yaml, questions.yaml and demographics.yaml, which
    control percentages, hidden responses, labels, sort order and colors.

Every chart the pages can show is computed here, so the browser only looks
values up. The percent/exclude/alias/sort/color logic is in
scripts/lib/chart_config.py.
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.chart_config import (  # noqa: E402
    ResolvedChartData,
    fallback_color_map,
    load_chart_configs,
    load_dashboard_config,
    load_demographics_config,
    load_questions_config,
    resolve_chart_config,
    resolve_demographic_grouping,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_INPUT_DIR = REPO_ROOT / "data" / "pipeline_input"
OUT_PATH = REPO_ROOT / "data" / "dashboard_data.json"


def resolved_to_dict(resolved, percent_col="percent", response_col="response_display"):
    """(sort_order, colors) from a ResolvedChartData, using fallback colors
    when the config sets none."""
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


def trend_settings(hist_entry):
    """(has_trend, start_year, trend_responses) from one config/questions.yaml
    question_hist entry -- either a plain 0/1 flag, or a mapping like
    {trend: 1, start_year: 2025, trend_responses: [...]}. start_year limits the
    trend line charts to start_year onward (the bar charts still offer every
    year); trend_responses limits the trend lines to those responses."""
    if isinstance(hist_entry, dict):
        return hist_entry.get("trend", 0) == 1, hist_entry.get("start_year"), hist_entry.get("trend_responses")
    return hist_entry == 1, None, None


def limit_trend_responses(resolved, trend_responses):
    """Keeps only the trend_responses lines in a trend chart's resolved data.
    Each entry can be the raw response or its display alias. Percentages are
    unchanged (still out of all responses); the other lines just aren't drawn."""
    if not trend_responses:
        return resolved
    keep = set(trend_responses)
    data = resolved.data[resolved.data["response"].isin(keep) | resolved.data["response_display"].isin(keep)]
    shown = set(data["response_display"])
    return ResolvedChartData(
        data=data,
        sort_order=[r for r in resolved.sort_order if r in shown],
        color_map=resolved.color_map,
    )


def main():
    survey_year = int(load_dashboard_config()["survey_year"])
    crosstab = pd.read_parquet(PIPELINE_INPUT_DIR / f"crosstab_long_{survey_year}.parquet")
    meta = pd.read_parquet(PIPELINE_INPUT_DIR / f"questions_meta_{survey_year}.parquet")

    chart_configs = load_chart_configs()
    questions_cfg = load_questions_config()
    question_hist = questions_cfg["question_hist"]
    demographics_cfg = load_demographics_config()
    demo_col_map = demographics_cfg["demo_col_map"]
    excluded_demographics = demographics_cfg["excluded_demographics"]
    demo_grp_order = demographics_cfg["demo_grp_order"]
    demo_grp_rename = demographics_cfg["demo_grp_rename"]
    # groups shown in bar charts but given no historic trend chart (the page
    # makes a group without a trend unselectable)
    excluded_historical = demographics_cfg.get("excluded_historical") or {}

    # Trend charts apply the current survey year's chart config to every year.
    current_survey_year = max(int(y) for y in meta["year"].unique())
    if current_survey_year != survey_year:
        print(f"  warning: questions_meta_{survey_year}.parquet's latest year is {current_survey_year}, not {survey_year}")

    # Category and short text per question code.
    question_defs = (
        meta.drop_duplicates("question")
        .set_index("question")[["category", "q_short"]]
        .to_dict("index")
    )

    # Question display order: questions listed in questions.yaml's question_order
    # come first, in that order. Any others follow: BIGPROBLEM first, then by
    # category, then by text.
    questions_ordered = sorted(
        question_defs,
        key=lambda code: (
            question_defs[code]["category"] != "BIGPROBLEM",
            question_defs[code]["category"],
            question_defs[code]["q_short"],
        ),
    )
    question_order = questions_cfg.get("question_order") or []
    for code in question_order:
        if code not in question_defs:
            print(f"  warning: question_order lists {code}, which isn't in questions_meta_{survey_year}.parquet")
    listed = [code for code in question_order if code in question_defs]
    questions_ordered = listed + [code for code in questions_ordered if code not in listed]

    questions_out = []
    topline_out = {}
    metro_trend_out = {}
    crosstab_out = {}
    historical_out = {}

    # demo_notes: extra caption text shown under a demographic's bar chart
    demo_notes = demographics_cfg.get("demo_notes") or {}
    demographics_out = [{"name": name, "column": col, "note": demo_notes.get(name)} for name, col in demo_col_map.items()]

    total_topline = total_trend = total_crosstab = total_hist = 0

    for question in questions_ordered:
        question_def = question_defs[question]
        has_trend, trend_start_year, trend_responses = trend_settings(question_hist.get(question, 0))
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
                "category": question_def["category"],
                "text": question_def["q_short"],
                "has_trend": has_trend,
                "trend_start_year": trend_start_year,
                "years": years,
                "verb_by_year": verb_by_year,
            }
        )

        question_crosstab = crosstab[crosstab["question"] == question]
        # Only the trend line charts (metro trend + demographic historical)
        # are limited by start_year; topline/crosstab bars use every year.
        trend_crosstab = question_crosstab
        if trend_start_year is not None:
            trend_crosstab = question_crosstab[question_crosstab["year"] >= trend_start_year]
            if has_trend and trend_crosstab["year"].nunique() < 2:
                print(f"  warning: {question}'s trend starts at {trend_start_year}, leaving fewer than 2 years to plot")

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
            grouped_trend = trend_crosstab[trend_crosstab["demo_type"] == "metroresp"]
            if len(grouped_trend) > 0:
                trend_config = question_config.get(str(current_survey_year), {})
                resolved_trend = resolve_chart_config(
                    grouped_trend, trend_config, value_col="weight", group_cols=["year"], default_sort="alpha"
                )
                resolved_trend = limit_trend_responses(resolved_trend, trend_responses)
                if trend_responses and not resolved_trend.sort_order:
                    print(f"  warning: none of {question}'s trend_responses match its responses")
                sort_order, colors = resolved_to_dict(resolved_trend)
                metro_trend_out[question] = {
                    "sort_order": sort_order,
                    "colors": colors,
                    "end_date": end_date,
                    "by_year": by_year_dict(resolved_trend.data),
                }
                total_trend += 1

        # --- Demographic crosstabs + historical trends ---
        # Demographic groups seen in any year, collected for the historical
        # trends (one per question and group, not per year).
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
                # demo_sort_order is None only when demographics.yaml has no order for this demographic;
                # an empty list means none of the configured groups are present (ex. Homeownership in
                # 2016/2017, which wasn't asked, so every value is NA). Skip the chart in that case so
                # the page shows "data not available" instead of an NA-only chart.
                ordered_groups = [g for g in (demo_sort_order if demo_sort_order is not None else sorted(groups_present)) if g in groups_present]
                if not ordered_groups:
                    continue

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
                    if demo_value in (excluded_historical.get(selected_demographic) or []):
                        continue
                    grouped_hist = trend_crosstab[
                        (trend_crosstab["demo_type"] == demo_column) & (trend_crosstab["demo_value"] == demo_value)
                    ]
                    if len(grouped_hist) == 0:
                        continue
                    hist_config = question_config.get(str(current_survey_year), {})
                    resolved_hist = resolve_chart_config(
                        grouped_hist, hist_config, value_col="weight", group_cols=["year"], default_sort="alpha"
                    )
                    resolved_hist = limit_trend_responses(resolved_hist, trend_responses)
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
