/**
 * charts.js -- Plotly.js chart builders for desktop. Mirrors
 * MAS_Dashboard_App/lib/charts.py's three builders as closely as
 * possible, including the exact sizing/margin formulas and hover
 * templates -- ported values, not redesigned ones.
 *
 * One quirk confirmed by rendering the real server app and inspecting it
 * live (not assumed from the Plotly Express docs): for a horizontal bar
 * chart, Plotly Express's category_orders puts the FIRST category at the
 * TOP of the y-axis, not the bottom (Plotly's own graph_objects default,
 * with no such reversal, would put it at the bottom). Reproduced here via
 * `yaxis.autorange = "reversed"` on every horizontal bar chart -- verified
 * against a live screenshot of the server app (bigprob 2025: "Housing
 * Affordability", sort_order[0], renders at the top).
 */

const MASCharts = (() => {
    const TITLE_FONT_COLOR = "#59595b";
    const GRID_COLOR = "#e5e5e5";
    const FONT_FAMILY_CSS = "'Barlow', sans-serif";
    const FALLBACK_BAR_COLOR = "#999999";
    // Every chart renders with a transparent background rather than an
    // opaque color -- the off-white ".chart-card" panel each chart sits
    // inside (see style.css) provides the backdrop instead, so heading +
    // chart + caption read as one card rather than the chart alone having
    // one.
    const CHART_BG_COLOR = "transparent";

    const PX_PER_BAR_HEIGHT = 32;
    const HEIGHT_MARGIN = 150;
    const MIN_HEIGHT = 350;
    const TICK_LABEL_STANDOFF = 8;
    const BARGAP = 0.3;

    const MOBILE_LEGEND = { orientation: "h", yanchor: "top", y: -0.3, xanchor: "center", x: 0.5 };
    const DESKTOP_LEGEND = { orientation: "v", yanchor: "top", y: 1, xanchor: "left", x: 1.02 };

    function scaledDimension(nCategories, pxPerCategory, margin, minDim, maxDim) {
        let dim = nCategories * pxPerCategory + margin;
        dim = Math.max(dim, minDim);
        if (maxDim != null) dim = Math.min(dim, maxDim);
        return dim;
    }

    function titleMarginTop(nLines, base, lineHeight = 24) {
        return base + Math.max(0, nLines - 1) * lineHeight;
    }

    /** Greedy word-wrap by character width -- JS equivalent of
     * textwrap.wrap(text, width=N)'s default behavior for ordinary
     * English sentences (no single word here ever approaches `width`
     * characters, so word-breaking isn't needed). */
    function wrapText(text, width) {
        const words = String(text).split(/\s+/).filter(Boolean);
        const lines = [];
        let current = "";
        for (const word of words) {
            if (current.length === 0) {
                current = word;
            } else if ((current + " " + word).length <= width) {
                current += " " + word;
            } else {
                lines.push(current);
                current = word;
            }
        }
        if (current.length > 0) lines.push(current);
        return lines.length ? lines : [""];
    }

    /**
     * Topline response-distribution horizontal bar chart.
     * @param {string} elementId
     * @param {string[]} sortOrder
     * @param {Object<string,string>} colors
     * @param {Object<string,number>} percents -- response -> 0-1 fraction
     * @param {string} questionTitle
     */
    function buildToplineBarChart(elementId, sortOrder, colors, percents, questionTitle) {
        // Width tuned for the chart's actual rendered width now that it
        // sits inside a padded .chart-card (see style.css) -- narrower
        // than the page-shell width this was originally calibrated
        // against, so the character budget per line is lower too.
        const titleLines = wrapText(questionTitle, 112);
        const wrappedTitle = titleLines.join("<br>");
        const nCategories = sortOrder.length;

        const traces = sortOrder
            .filter((r) => percents[r] !== undefined)
            .map((response) => ({
                type: "bar",
                orientation: "h",
                x: [percents[response]],
                y: [response],
                name: response,
                marker: { color: colors[response] || FALLBACK_BAR_COLOR },
                text: [percents[response]],
                texttemplate: "%{text:.0%}",
                textposition: "outside",
                hovertemplate: "Response: %{fullData.name}<br>Percent: %{text:.0%}<extra></extra>",
                showlegend: false,
            }));

        const height = scaledDimension(nCategories, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            height,
            font: { family: FONT_FAMILY_CSS },
            title: {
                text: `<i>${wrappedTitle}</i>`,
                font: { size: 18, color: TITLE_FONT_COLOR },
            },
            showlegend: false,
            hovermode: "closest",
            bargap: BARGAP,
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: titleMarginTop(titleLines.length, 80), l: 0, r: 20, b: 60 },
            xaxis: {
                title: "Percentage",
                tickformat: ".0%",
                showgrid: true,
                gridcolor: GRID_COLOR,
            },
            yaxis: {
                title: null,
                automargin: true,
                ticklabelstandoff: TICK_LABEL_STANDOFF,
                categoryorder: "array",
                categoryarray: sortOrder,
                autorange: "reversed",
            },
        };

        Plotly.newPlot(elementId, traces, layout, { responsive: true, displaylogo: false });
    }

    /**
     * Line-with-markers trend chart -- reused for both the metro-wide
     * year-over-year trend and the per-demographic-value historical trend.
     * @param {string} elementId
     * @param {string[]} sortOrder
     * @param {Object<string,string>} colors
     * @param {Object<string,Object<string,number>>} byYear -- year(string) -> response -> 0-1 fraction
     * @param {string} chartTitle
     * @param {string} endDate -- "YYYY-12-31"
     * @param {boolean} isMobile
     * @param {{label:string, value:string}|null} demographic -- when set, adds a leading hover line
     */
    function buildTrendLineChart(elementId, sortOrder, colors, byYear, chartTitle, endDate, isMobile, demographic) {
        const years = Object.keys(byYear).sort();
        const minDate = `${years[0]}-01-01`;

        const hovertemplate = demographic
            ? `${demographic.label}: ${demographic.value}<br>Response: %{fullData.name}<br>Percent: %{y:.0%}<br>Year: %{x|%Y}<extra></extra>`
            : "Response: %{fullData.name}<br>Percent: %{y:.0%}<br>Year: %{x|%Y}<extra></extra>";

        const traces = sortOrder
            .filter((response) => years.some((y) => byYear[y][response] !== undefined))
            .map((response) => ({
                type: "scatter",
                mode: "lines+markers",
                x: years.filter((y) => byYear[y][response] !== undefined).map((y) => `${y}-01-01`),
                y: years.filter((y) => byYear[y][response] !== undefined).map((y) => byYear[y][response]),
                name: response,
                // Thicker connecting line on desktop only (mobile keeps
                // Plotly's default width) -- shared by both the Metro
                // Summary trend chart and Demographic Breakdown's
                // historic trend chart, since both call this function.
                line: { color: colors[response] || FALLBACK_BAR_COLOR, width: isMobile ? 2 : 3.5 },
                marker: { color: colors[response] || FALLBACK_BAR_COLOR },
                hovertemplate,
            }));

        const layout = {
            font: { family: FONT_FAMILY_CSS },
            title: { text: chartTitle, font: { size: 18, color: TITLE_FONT_COLOR } },
            legend: isMobile ? MOBILE_LEGEND : DESKTOP_LEGEND,
            hovermode: "closest",
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: 60, l: 60, r: 20, b: 60 },
            xaxis: {
                type: "date",
                range: [minDate, endDate],
                dtick: "M12",
                tickformat: "%Y",
                title: "Survey Year",
            },
            yaxis: {
                tickformat: ".0%",
                title: "Percentage",
                rangemode: "tozero",
            },
        };

        const config = isMobile ? { staticPlot: true } : { responsive: true, displaylogo: false };
        Plotly.newPlot(elementId, traces, layout, config);
    }

    /**
     * Demographic-crosstab horizontal stacked bar chart -- one bar per
     * demographic group, stacked by response category. The only
     * interactive chart: attaches a plotly_click handler and calls
     * onDemoClick(rawValue) with the clicked bar's raw (pre-rename)
     * demographic value, read from customdata (never from the display
     * label) -- directly analogous to lib.session_state.
     * get_clicked_demo_value().
     *
     * @param {string} elementId
     * @param {{question_title, response_sort_order, colors, groups}} crosstab
     * @param {string} demographicLabel
     * @param {string|null} selectedDemoValue
     * @param {(rawValue:string)=>void} onDemoClick
     */
    function buildDemographicStackedBarChart(elementId, crosstab, demographicLabel, selectedDemoValue, onDemoClick) {
        const { question_title: questionTitle, response_sort_order: responseSortOrder, colors, groups } = crosstab;
        // See buildToplineBarChart's comment: narrowed for the chart's
        // actual rendered width inside a padded .chart-card, plus this
        // chart's own right margin (r:120, for the legend).
        const titleLines = wrapText(questionTitle, 118);
        const wrappedTitle = titleLines.join("<br>");

        // crosstab.groups arrives already in the correct display order --
        // build_static_data.py computed it via resolve_demographic_grouping's
        // demo_sort_order (e.g. Jurisdiction's Atlanta-first county order,
        // Income's bracket order) and wrote it out pre-sorted, so there's no
        // separate sort-order array to re-apply here. Do NOT alphabetize as a
        // "fallback" -- that silently overrides the real order (confirmed via
        // a live rendering bug: alphabetical sorting put "Cherokee County"
        // before "City of Atlanta" instead of Atlanta-first).
        const orderedGroups = groups.map((g) => g.group_display);

        const traces = responseSortOrder
            .filter((response) => groups.some((g) => g.percents[response] !== undefined))
            .map((response) => {
                const x = [];
                const y = [];
                const customdata = [];
                for (const groupDisplay of orderedGroups) {
                    const group = groups.find((g) => g.group_display === groupDisplay);
                    if (!group || group.percents[response] === undefined) continue;
                    x.push(group.percents[response]);
                    y.push(groupDisplay);
                    customdata.push([group.group_raw]);
                }
                const opacity =
                    selectedDemoValue != null ? customdata.map((cd) => (cd[0] === selectedDemoValue ? 1.0 : 0.7)) : 1.0;
                return {
                    type: "bar",
                    orientation: "h",
                    x,
                    y,
                    name: response,
                    marker: { color: colors[response] || FALLBACK_BAR_COLOR, opacity },
                    customdata,
                    hovertemplate: `${demographicLabel}: %{y}<br>Response: %{fullData.name}<br>Percent: %{x:.0%}<extra></extra>`,
                };
            });

        const nGroups = orderedGroups.length;
        const height = scaledDimension(nGroups, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            barmode: "stack",
            legend: DESKTOP_LEGEND,
            height,
            hovermode: "closest",
            bargap: BARGAP,
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: titleMarginTop(titleLines.length, 80), l: 0, r: 120, b: 60 },
            font: { family: FONT_FAMILY_CSS },
            title: {
                // "Response by X Demographic (Year)" (crosstab.subtitle) is
                // no longer part of this chart's own title -- it's shown as
                // a real .section-heading above the card instead (see
                // demographicBreakdown.js), matching how the Metro Summary
                // page's "2025 Response Distribution" heading sits outside
                // its chart rather than inside the Plotly title.
                text: `<i>${wrappedTitle}</i>`,
                font: { size: 18, color: TITLE_FONT_COLOR },
            },
            xaxis: {
                range: [0, 1],
                tickformat: ".0%",
                title: "Percentage",
                showgrid: true,
                gridcolor: GRID_COLOR,
            },
            yaxis: {
                title: null,
                automargin: true,
                ticklabelstandoff: TICK_LABEL_STANDOFF,
                categoryorder: "array",
                categoryarray: orderedGroups,
                autorange: "reversed",
            },
        };

        // Attached synchronously on the div returned by Plotly.newPlot's
        // call (not inside its .then()) -- confirmed via a live rapid-click
        // stress test (8 clicks at 150ms intervals) that deferring listener
        // attachment to the resolved promise leaves a real window where a
        // click lands after the new chart is visually rendered but before
        // its click handler is (re)attached, silently swallowing that
        // click. Plotly.newPlot() already returns the target div
        // synchronously (the promise it also returns resolves later, once
        // animations/etc. settle) with hit-testing wired up, so attaching
        // here closes that window -- verified 8/8 reliable afterward.
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, { responsive: true, displaylogo: false });
        gd.removeAllListeners && gd.removeAllListeners("plotly_click");
        gd.on("plotly_click", (evt) => {
            if (!evt || !evt.points || !evt.points.length) return;
            const point = evt.points[0];
            try {
                const rawValue = point.customdata[0];
                if (rawValue != null && onDemoClick) onDemoClick(rawValue);
            } catch (e) {
                console.warn("malformed plotly click payload, ignoring:", e);
            }
        });
    }

    /**
     * Demographic-crosstab small multiples -- one small panel per response
     * category (instead of one segment per response within a single
     * stacked bar), each panel a horizontal bar per demographic group.
     * Trades "everything in one bar" for "easy to compare one response
     * category's spread across every group at a glance" -- the same data
     * as buildDemographicStackedBarChart, just laid out as a grid instead
     * of a stack. Desktop only, an alternate view of the same crosstab
     * (see demographicBreakdown.js's view-mode toggle); same click-to-
     * drill contract as the stacked chart, so selecting a group works
     * identically in both views.
     *
     * Every panel shares one x-axis scale (not each auto-scaling to its
     * own max) -- lets a reader compare *magnitude* across response
     * categories ("Economy runs higher than Other, everywhere"), not just
     * relative differences within one category. Row labels (demographic
     * group names) show once, on the leftmost panel only, with every
     * panel sharing the same category order so rows stay aligned.
     *
     * Deliberately fixed-width, not responsive: with enough response
     * categories (e.g. BIGPROBLEM's 9) this is wider than the card, so
     * the caller wraps it in a horizontally-scrolling container instead
     * of squeezing every panel down to illegibility.
     *
     * @param {string} elementId
     * @param {{question_title, response_sort_order, colors, groups}} crosstab
     * @param {string} demographicLabel
     * @param {string|null} selectedDemoValue
     * @param {(rawValue:string)=>void} onDemoClick
     */
    function buildDemographicSmallMultiples(elementId, crosstab, demographicLabel, selectedDemoValue, onDemoClick) {
        const { question_title: questionTitle, response_sort_order: responseSortOrder, colors, groups } = crosstab;

        // Same ordering contract as buildDemographicStackedBarChart -- see
        // its comment: crosstab.groups already arrives pre-sorted, never
        // re-alphabetize.
        const orderedGroups = groups.map((g) => g.group_display);
        const nGroups = orderedGroups.length;

        const panelResponses = responseSortOrder.filter((response) => groups.some((g) => g.percents[response] !== undefined));
        const nPanels = panelResponses.length;

        // Unlike every other chart here, this one's total width genuinely
        // varies a lot (a 3-panel question vs. BIGPROBLEM's 10) -- so the
        // title's wrap width can't be a hand-tuned constant the way the
        // other charts' can. A centered title wrapped wider than the
        // actual figure overflows the SVG's own bounds and gets clipped
        // by the browser (confirmed live: a 4-panel chart, ~650px wide,
        // silently lost the first ~15 characters of a title wrapped for
        // the stacked chart's ~940px). ~8px/char at this title's 18px
        // italic font is what the other charts' hand-tuned constants
        // (e.g. 118 chars at ~940px) already imply -- reused here as a
        // ratio instead of a fixed count, with a floor so a narrow
        // 3-panel chart doesn't wrap to near-nothing.
        const PANEL_WIDTH = 130; // px -- wide enough for a "12%"-style label without crowding
        const FIRST_PANEL_EXTRA = 130; // extra px on panel 1 for group-name labels ("City of Atlanta")
        const minWidth = FIRST_PANEL_EXTRA + PANEL_WIDTH * nPanels;
        // Fill the card's actual available width when there's room, instead
        // of always sizing strictly off panel count -- a 3-4 panel question
        // was rendering visibly narrower than the stacked chart's full-width
        // look, with a lot of unused card to its right. Only grows past the
        // available width (triggering the wrapper's horizontal scroll) once
        // there are genuinely too many panels to fit -- e.g. BIGPROBLEM's 10.
        // The container div is already in the DOM by the time this runs
        // (demographicBreakdown.js sets the wrapper's innerHTML first), so
        // its parent's clientWidth is a real, measured value here, not a
        // guess.
        const containerEl = document.getElementById(elementId);
        const availableWidth = (containerEl && containerEl.parentElement && containerEl.parentElement.clientWidth) || 0;
        const width = Math.max(minWidth, availableWidth);
        const titleLines = wrapText(questionTitle, Math.max(40, Math.floor(width / 8.5)));
        const wrappedTitle = titleLines.join("<br>");

        let maxPercent = 0;
        for (const response of panelResponses) {
            for (const group of groups) {
                const v = group.percents[response];
                if (v !== undefined && v > maxPercent) maxPercent = v;
            }
        }
        const sharedRange = [0, maxPercent > 0 ? maxPercent * 1.12 : 1];

        const traces = panelResponses.map((response, i) => {
            const x = [];
            const y = [];
            const customdata = [];
            for (const groupDisplay of orderedGroups) {
                const group = groups.find((g) => g.group_display === groupDisplay);
                if (!group || group.percents[response] === undefined) continue;
                x.push(group.percents[response]);
                y.push(groupDisplay);
                customdata.push([group.group_raw]);
            }
            const opacity =
                selectedDemoValue != null ? customdata.map((cd) => (cd[0] === selectedDemoValue ? 1.0 : 0.7)) : 1.0;
            const axisNum = i + 1;
            return {
                type: "bar",
                orientation: "h",
                x,
                y,
                name: response,
                marker: { color: colors[response] || FALLBACK_BAR_COLOR, opacity },
                customdata,
                text: x,
                texttemplate: "%{text:.0%}",
                textposition: "outside",
                textfont: { size: 11 },
                cliponaxis: false,
                xaxis: `x${axisNum}`,
                yaxis: `y${axisNum}`,
                showlegend: false,
                hovertemplate: `${demographicLabel}: %{y}<br>Response: %{fullData.name}<br>Percent: %{x:.0%}<extra></extra>`,
            };
        });

        const height = scaledDimension(nGroups, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        // Column headers (response category names) -- Plotly subplots don't
        // have a built-in per-panel title, so these are positioned by hand
        // just above each panel's own domain, as annotations. Plotly does
        // NOT auto-wrap annotation text to fit a given `width` the way HTML
        // text wraps in a box (confirmed live: setting width alone left a
        // long response category, e.g. "Developers building too expensive
        // units", rendered as one line that ran straight into the next
        // panel) -- so this wraps the text itself first, the same way the
        // title above already does, just at the header's own smaller font
        // size. ~5.2px/char is this measured at 12px Barlow (vs. the
        // title's ~8.5px/char at 18px) -- close to the same ratio scaled by
        // font size, confirmed against two real labels ("Quality of Local
        // Schools" and "Developers building too expensive units").
        const HEADER_GUTTER = 16; // px of breathing room within each panel's own width
        const headerCharsPerLine = Math.max(8, Math.floor((PANEL_WIDTH - HEADER_GUTTER) / 5.2));
        const wrappedHeaders = panelResponses.map((response) => wrapText(response, headerCharsPerLine));
        const maxHeaderLines = Math.max(1, ...wrappedHeaders.map((lines) => lines.length));

        // Title and column headers are two independently-sized text blocks
        // stacked in the top margin (title on top, headers just above the
        // plot). Previously the title relied on Plotly's own default
        // vertical placement within margin.t, which isn't guaranteed to stay
        // pinned to the very top as margin.t grows -- on narrow charts (few
        // panels, more wrapped title lines) the title crept down far enough
        // to scrunch against, or overlap, the header row below it. Fixed by
        // explicitly reserving pixel-accurate space for each block and
        // pinning the title's own y-position to the top, so the two blocks
        // can never compete for the same vertical space.
        const TOP_PAD = 24; // px above the title's first line
        const TITLE_LINE_HEIGHT = 26; // px per wrapped title line, ~18px italic font
        const HEADER_LINE_HEIGHT = 16; // px per wrapped header line, 12px font
        const TITLE_HEADER_GAP = 14; // px breathing room between title block and headers
        const PLOT_GAP = 8; // px between the lowest header line and the plot area
        const titleBlockHeight = titleLines.length * TITLE_LINE_HEIGHT;
        const headerBlockHeight = maxHeaderLines * HEADER_LINE_HEIGHT;
        const marginTop = TOP_PAD + titleBlockHeight + TITLE_HEADER_GAP + headerBlockHeight + PLOT_GAP;

        const layout = {
            grid: { rows: 1, columns: nPanels, pattern: "independent" },
            width,
            height,
            hovermode: "closest",
            bargap: BARGAP,
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: marginTop, l: 0, r: 20, b: 40 },
            font: { family: FONT_FAMILY_CSS },
            title: {
                text: `<i>${wrappedTitle}</i>`,
                font: { size: 18, color: TITLE_FONT_COLOR },
                x: 0.5,
                xanchor: "center",
                y: 1,
                yanchor: "top",
                pad: { t: TOP_PAD },
            },
            annotations: panelResponses.map((response, i) => ({
                text: wrappedHeaders[i].join("<br>"),
                xref: `x${i + 1} domain`,
                yref: "paper",
                x: 0.5,
                y: 1,
                align: "center",
                xanchor: "center",
                yanchor: "bottom",
                yshift: PLOT_GAP,
                showarrow: false,
                font: { size: 12, color: TITLE_FONT_COLOR },
            })),
        };

        panelResponses.forEach((response, i) => {
            const axisNum = i + 1;
            layout[`xaxis${axisNum}`] = {
                range: sharedRange,
                tickformat: ".0%",
                showgrid: true,
                gridcolor: GRID_COLOR,
                tickfont: { size: 10 },
                nticks: 3,
            };
            layout[`yaxis${axisNum}`] = {
                categoryorder: "array",
                categoryarray: orderedGroups,
                autorange: "reversed",
                showticklabels: i === 0,
                ticklabelstandoff: TICK_LABEL_STANDOFF,
                automargin: i === 0,
            };
        });

        // Same synchronous-attach reasoning as buildDemographicStackedBarChart
        // (see its comment) -- avoids the same click-lands-during-the-gap-
        // before-the-handler-reattaches race.
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, { responsive: false, displaylogo: false });
        gd.removeAllListeners && gd.removeAllListeners("plotly_click");
        gd.on("plotly_click", (evt) => {
            if (!evt || !evt.points || !evt.points.length) return;
            const point = evt.points[0];
            try {
                const rawValue = point.customdata[0];
                if (rawValue != null && onDemoClick) onDemoClick(rawValue);
            } catch (e) {
                console.warn("malformed plotly click payload, ignoring:", e);
            }
        });
    }

    return {
        wrapText,
        scaledDimension,
        buildToplineBarChart,
        buildTrendLineChart,
        buildDemographicStackedBarChart,
        buildDemographicSmallMultiples,
    };
})();
