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
        const titleLines = wrapText(questionTitle, 130);
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
            plot_bgcolor: "white",
            paper_bgcolor: "white",
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
                line: { color: colors[response] || FALLBACK_BAR_COLOR },
                marker: { color: colors[response] || FALLBACK_BAR_COLOR },
                hovertemplate,
            }));

        const layout = {
            font: { family: FONT_FAMILY_CSS },
            title: { text: chartTitle, font: { size: 18, color: TITLE_FONT_COLOR } },
            legend: isMobile ? MOBILE_LEGEND : DESKTOP_LEGEND,
            hovermode: "closest",
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
     * @param {{question_title, subtitle, response_sort_order, colors, groups}} crosstab
     * @param {string} demographicLabel
     * @param {string|null} selectedDemoValue
     * @param {(rawValue:string)=>void} onDemoClick
     */
    function buildDemographicStackedBarChart(elementId, crosstab, demographicLabel, selectedDemoValue, onDemoClick) {
        const { question_title: questionTitle, subtitle, response_sort_order: responseSortOrder, colors, groups } = crosstab;
        const titleLines = wrapText(questionTitle, 140);
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
            plot_bgcolor: "white",
            paper_bgcolor: "white",
            margin: { t: titleMarginTop(titleLines.length + 1, 66), l: 0, r: 120, b: 60 },
            font: { family: FONT_FAMILY_CSS },
            title: {
                text: `<i>${wrappedTitle}</i><br><sup>${subtitle}</sup>`,
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

    return {
        wrapText,
        scaledDimension,
        buildToplineBarChart,
        buildTrendLineChart,
        buildDemographicStackedBarChart,
    };
})();
