/**
 * charts.js -- Plotly.js chart builders (topline bars, trend lines,
 * demographic stacked bars, small multiples) plus CSV and PNG download.
 *
 * Horizontal bar charts set `yaxis.autorange = "reversed"` so the first
 * category in sort order is drawn at the top; Plotly's default puts it at
 * the bottom.
 */

const MASCharts = (() => {
    const TITLE_FONT_COLOR = "#59595b";
    const GRID_COLOR = "#e5e5e5";
    // Same as --control-border in style.css; meets WCAG 3:1 for a component
    // outline, which GRID_COLOR is too faint for.
    const TOOLTIP_BORDER_COLOR = "#8d8d8d";
    const FONT_FAMILY_CSS = "'Barlow', sans-serif";
    const FALLBACK_BAR_COLOR = "#999999";
    // Transparent so the surrounding .chart-card provides the background.
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

    /** Shows a custom tooltip that follows the mouse cursor. Plotly's own
     * hover label is anchored to the data point and can't follow the cursor.
     * Traces must set hoverinfo: "none" to hide Plotly's label.
     * renderContent(point) returns the tooltip's HTML. */
    function attachCursorTooltip(gd, renderContent) {
        // Attached to <body> with fixed positioning so scrollable chart
        // wrappers can't clip it. One tooltip element per chart id, reused
        // across re-renders.
        let tooltipEl = document.querySelector(`.cursor-tooltip[data-for="${gd.id}"]`);
        if (!tooltipEl) {
            tooltipEl = document.createElement("div");
            tooltipEl.className = "cursor-tooltip";
            tooltipEl.dataset.for = gd.id;
            document.body.appendChild(tooltipEl);
        }
        let active = false;

        const OFFSET = 8;
        const position = (clientX, clientY) => {
            // Flip to the other side of the cursor near the window edge.
            const w = tooltipEl.offsetWidth;
            const h = tooltipEl.offsetHeight;
            let left = clientX + OFFSET;
            if (left + w > window.innerWidth) left = clientX - OFFSET - w;
            let top = clientY + OFFSET;
            if (top + h > window.innerHeight) top = clientY - OFFSET - h;
            tooltipEl.style.left = `${Math.max(0, left)}px`;
            tooltipEl.style.top = `${Math.max(0, top)}px`;
        };

        gd.removeAllListeners && gd.removeAllListeners("plotly_hover");
        gd.removeAllListeners && gd.removeAllListeners("plotly_unhover");
        gd.on("plotly_hover", (evt) => {
            if (!evt || !evt.points || !evt.points.length) return;
            const content = renderContent(evt.points[0]);
            if (!content) return;
            tooltipEl.innerHTML = content;
            tooltipEl.style.display = "block";
            active = true;
            if (evt.event) position(evt.event.clientX, evt.event.clientY);
        });
        gd.on("plotly_unhover", () => {
            active = false;
            tooltipEl.style.display = "none";
        });
        // plotly_hover fires once per point, so track mousemove to keep the
        // tooltip following the cursor. .onmousemove replaces any previous handler.
        gd.onmousemove = (e) => {
            if (active) position(e.clientX, e.clientY);
        };
    }

    /** Splits text into lines of at most `width` characters at word
     * boundaries. Returns an array of lines. */
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
        // Characters per title line, tuned to the chart card's width.
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
                // Hover handled by attachCursorTooltip below.
                hoverinfo: "none",
                showlegend: false,
            }));

        const height = scaledDimension(nCategories, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            height,
            dragmode: false, // no pan/zoom
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

        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, { responsive: true, displaylogo: false, displayModeBar: false, doubleClick: false });
        attachCursorTooltip(gd, (point) => `Response: ${point.data.name}<br>Percent: ${Math.round(point.x * 100)}%`);
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

        // Wrap the title to the container's measured width; this chart is
        // drawn into containers of very different widths (desktop card,
        // mobile card).
        const containerEl = document.getElementById(elementId);
        const containerWidth = (containerEl && containerEl.parentElement && containerEl.parentElement.clientWidth) || (isMobile ? 320 : 900);
        const titleLines = wrapText(chartTitle, Math.max(20, Math.floor(containerWidth / 8.5)));
        const wrappedTitle = titleLines.join("<br>");

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
                // Thicker lines on desktop.
                line: { color: colors[response] || FALLBACK_BAR_COLOR, width: isMobile ? 2 : 3.5 },
                marker: { color: colors[response] || FALLBACK_BAR_COLOR },
                hovertemplate,
            }));

        const layout = {
            dragmode: false, // no pan/zoom
            font: { family: FONT_FAMILY_CSS },
            title: { text: wrappedTitle, font: { size: 18, color: TITLE_FONT_COLOR } },
            legend: isMobile ? MOBILE_LEGEND : DESKTOP_LEGEND,
            hovermode: "closest",
            // White hover label with dark text. Plotly's default uses the
            // line color as the background, which isn't readable for every color.
            hoverlabel: { bgcolor: "#ffffff", bordercolor: TOOLTIP_BORDER_COLOR, font: { color: TITLE_FONT_COLOR } },
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: titleMarginTop(titleLines.length, 60), l: 60, r: 20, b: 60 },
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

        const config = { responsive: true, displaylogo: false, displayModeBar: false, doubleClick: false };
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, config);

        // Tap-to-show tooltips for touch screens. Plotly's hover events don't
        // fire on a tap, but a DOM click does: find the nearest marker to the
        // tap and show its hover label, or clear it if the tap is far from
        // any marker.
        const TAP_HOVER_RADIUS = 40;
        gd.addEventListener("click", (evt) => {
            let best = null;
            let bestDistSq = Infinity;
            gd.querySelectorAll(".scatterlayer .trace").forEach((traceGroup, curveNumber) => {
                traceGroup.querySelectorAll(".points path.point").forEach((pt, pointNumber) => {
                    const r = pt.getBoundingClientRect();
                    const dx = r.x + r.width / 2 - evt.clientX;
                    const dy = r.y + r.height / 2 - evt.clientY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        best = { curveNumber, pointNumber };
                    }
                });
            });
            if (best && Math.sqrt(bestDistSq) <= TAP_HOVER_RADIUS) {
                Plotly.Fx.hover(gd, [best]);
            } else {
                Plotly.Fx.unhover(gd);
            }
        });
    }

    /**
     * Demographic crosstab as a horizontal stacked bar chart: one bar per
     * demographic group, stacked by response. Clicking a bar calls
     * onDemoClick(rawValue) with the group's raw value from customdata
     * (not its display label, which may be renamed).
     *
     * @param {string} elementId
     * @param {{question_title, response_sort_order, colors, groups}} crosstab
     * @param {string} demographicLabel
     * @param {string|null} selectedDemoValue
     * @param {(rawValue:string)=>void} onDemoClick
     */
    function buildDemographicStackedBarChart(elementId, crosstab, demographicLabel, selectedDemoValue, onDemoClick) {
        const { question_title: questionTitle, response_sort_order: responseSortOrder, colors, groups } = crosstab;
        // Characters per title line, tuned to the card width minus the legend.
        const titleLines = wrapText(questionTitle, 118);
        const wrappedTitle = titleLines.join("<br>");

        // crosstab.groups is already in display order (e.g. City of Atlanta
        // first, income brackets in order). Don't re-sort it.
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
                    // Hover handled by attachCursorTooltip below.
                    hoverinfo: "none",
                };
            });

        const nGroups = orderedGroups.length;
        const height = scaledDimension(nGroups, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            barmode: "stack",
            dragmode: false, // no pan/zoom
            legend: DESKTOP_LEGEND,
            height,
            hovermode: "closest",
            bargap: BARGAP,
            plot_bgcolor: CHART_BG_COLOR,
            paper_bgcolor: CHART_BG_COLOR,
            margin: { t: titleMarginTop(titleLines.length, 80), l: 0, r: 120, b: 60 },
            font: { family: FONT_FAMILY_CSS },
            title: {
                // crosstab.subtitle is shown as the page heading, not here.
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

        // Attach the click handler right after newPlot, not in its .then():
        // waiting for the promise leaves a gap where fast clicks are dropped.
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, { responsive: true, displaylogo: false, displayModeBar: false, doubleClick: false });
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
        attachCursorTooltip(gd, (point) => {
            return `${demographicLabel}: ${point.y}<br>Response: ${point.data.name}<br>Percent: ${Math.round(point.x * 100)}%`;
        });
    }

    /**
     * Demographic crosstab as small multiples (desktop only): one panel per
     * response, each with a bar per demographic group. Same data and click
     * behavior as buildDemographicStackedBarChart.
     *
     * All panels share one x-axis scale so values are comparable across
     * panels. Group names appear on the first panel only, and every panel
     * uses the same row order so rows line up. Clicking a column header
     * sorts all panels by that response.
     *
     * Fixed width (not responsive): with many responses the chart is wider
     * than the card, and the caller wraps it in a horizontal scroll container.
     *
     * @param {string} elementId
     * @param {{question_title, response_sort_order, colors, groups}} crosstab
     * @param {string} demographicLabel
     * @param {string|null} selectedDemoValue
     * @param {(rawValue:string)=>void} onDemoClick
     */
    function buildDemographicSmallMultiples(elementId, crosstab, demographicLabel, selectedDemoValue, onDemoClick) {
        const { question_title: questionTitle, response_sort_order: responseSortOrder, colors, groups } = crosstab;

        // crosstab.groups is already in display order. Don't re-sort it.
        const orderedGroups = groups.map((g) => g.group_display);
        const nGroups = orderedGroups.length;

        const panelResponses = responseSortOrder.filter((response) => groups.some((g) => g.percents[response] !== undefined));
        const nPanels = panelResponses.length;

        // Chart width depends on the number of panels, so the title wraps to
        // the computed width (~8.5px per character at 18px) rather than a
        // fixed count; a title wider than the chart would be clipped.
        const PANEL_WIDTH = 130; // px -- wide enough for a "12%"-style label without crowding
        const FIRST_PANEL_EXTRA = 130; // extra px on panel 1 for group-name labels ("City of Atlanta")
        const minWidth = FIRST_PANEL_EXTRA + PANEL_WIDTH * nPanels;
        // Fill the card width when the panels fit; otherwise grow wider and
        // let the wrapper scroll horizontally.
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
                // Hover handled by attachCursorTooltip below.
                hoverinfo: "none",
            };
        });

        const height = scaledDimension(nGroups, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        // Column headers (response names) are annotations above each panel,
        // since subplots have no per-panel title. Plotly doesn't wrap
        // annotation text, so wrap it here at ~5.2px per character (12px font),
        // leaving 2 characters for the sort icon.
        const HEADER_GUTTER = 16; // px of padding within each panel
        const headerCharsPerLine = Math.max(8, Math.floor((PANEL_WIDTH - HEADER_GUTTER) / 5.2) - 2);
        const wrappedHeaders = panelResponses.map((response) => wrapText(response, headerCharsPerLine));
        const maxHeaderLines = Math.max(1, ...wrappedHeaders.map((lines) => lines.length));

        // The top margin holds the title and the column headers. Reserve
        // space for each and pin the title to the top so they can't overlap.
        const TOP_PAD = 24; // px above the title's first line
        const TITLE_LINE_HEIGHT = 26; // px per wrapped title line, ~18px italic font
        const HEADER_LINE_HEIGHT = 16; // px per wrapped header line, 12px font
        const TITLE_HEADER_GAP = 14; // px breathing room between title block and headers
        const PLOT_GAP = 8; // px between the lowest header line and the plot area
        const titleBlockHeight = titleLines.length * TITLE_LINE_HEIGHT;
        const headerBlockHeight = maxHeaderLines * HEADER_LINE_HEIGHT;
        const marginTop = TOP_PAD + titleBlockHeight + TITLE_HEADER_GAP + headerBlockHeight + PLOT_GAP;

        // Clicking a column header cycles its sort: descending, ascending,
        // then default order. A different header starts again at descending.
        // All panels are reordered together so rows stay aligned with the
        // labels on the first panel.
        let activeSortResponse = null;
        let activeSortDirection = null; // "desc" | "asc"

        function sortedGroupOrder(sortResponse, direction) {
            if (!sortResponse) return orderedGroups;
            const withValue = [];
            const withoutValue = [];
            for (const groupDisplay of orderedGroups) {
                const group = groups.find((g) => g.group_display === groupDisplay);
                if (group && group.percents[sortResponse] !== undefined) {
                    withValue.push({ groupDisplay, value: group.percents[sortResponse] });
                } else {
                    withoutValue.push(groupDisplay);
                }
            }
            withValue.sort((a, b) => (direction === "asc" ? a.value - b.value : b.value - a.value));
            return [...withValue.map((g) => g.groupDisplay), ...withoutValue];
        }

        // captureevents makes headers clickable (plotly_clickannotation).
        // Each header shows "⇅"; the sorted column shows "▼" or "▲" instead.
        function buildHeaderAnnotations(sortResponse, direction) {
            return panelResponses.map((response, i) => ({
                text: wrappedHeaders[i].join("<br>") + (response === sortResponse ? (direction === "asc" ? " ▲" : " ▼") : " ⇅"),
                xref: `x${i + 1} domain`,
                yref: "paper",
                x: 0.5,
                y: 1,
                align: "center",
                xanchor: "center",
                yanchor: "bottom",
                yshift: PLOT_GAP,
                showarrow: false,
                captureevents: true,
                font: { size: 12, color: TITLE_FONT_COLOR },
            }));
        }

        const layout = {
            grid: { rows: 1, columns: nPanels, pattern: "independent" },
            width,
            height,
            dragmode: false, // no pan/zoom
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
            annotations: buildHeaderAnnotations(activeSortResponse, activeSortDirection),
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

        // Attach handlers right after newPlot (see buildDemographicStackedBarChart).
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, { responsive: false, displaylogo: false, displayModeBar: false, doubleClick: false });
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
        gd.removeAllListeners && gd.removeAllListeners("plotly_clickannotation");
        gd.on("plotly_clickannotation", (evt) => {
            if (!evt || evt.index == null) return;
            const response = panelResponses[evt.index];
            if (!response) return;
            if (activeSortResponse !== response) {
                // New column: start at descending.
                activeSortResponse = response;
                activeSortDirection = "desc";
            } else if (activeSortDirection === "desc") {
                activeSortDirection = "asc";
            } else {
                activeSortResponse = null;
                activeSortDirection = null;
            }
            const newOrder = sortedGroupOrder(activeSortResponse, activeSortDirection);
            const axisUpdate = {};
            panelResponses.forEach((_, i) => {
                // Plotly.relayout ignores "yaxis1"; the first axis must be "yaxis".
                const axisKey = i === 0 ? "yaxis" : `yaxis${i + 1}`;
                axisUpdate[`${axisKey}.categoryarray`] = newOrder;
            });
            Plotly.relayout(gd, { ...axisUpdate, annotations: buildHeaderAnnotations(activeSortResponse, activeSortDirection) });
        });
        attachCursorTooltip(gd, (point) => {
            return `${demographicLabel}: ${point.y}<br>Response: ${point.data.name}<br>Percent: ${Math.round(point.x * 100)}%`;
        });
    }

    /** Downloads a header row and data rows as a CSV file. Values containing
     * commas, quotes or newlines are quoted. */
    function downloadCSV(filename, headerRow, dataRows) {
        const escapeCell = (value) => {
            const s = value == null ? "" : String(value);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [headerRow, ...dataRows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /** Lowercases text and replaces non-alphanumeric runs with "_", for filenames. */
    function slugify(text) {
        return String(text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    /** Downloads the Plotly chart in elementId as a PNG. Does nothing if the
     * element isn't a Plotly chart. */
    function downloadChartImage(elementId, filename) {
        const gd = document.getElementById(elementId);
        if (!gd || !gd.data) return;
        // Plotly.downloadImage adds ".png" itself.
        const name = filename.replace(/\.png$/i, "");

        // The exported PNG can crop long y-axis labels even when the screen
        // doesn't. Temporarily widen the left margin to fit the widest label,
        // export, then restore it.
        let maxLabelWidth = 0;
        gd.querySelectorAll(".ytick text").forEach((tick) => {
            maxLabelWidth = Math.max(maxLabelWidth, tick.getBoundingClientRect().width);
        });
        const originalMarginL = gd._fullLayout.margin.l;
        const neededMarginL = maxLabelWidth > 0 ? Math.ceil(maxLabelWidth) + 20 : 0;

        if (neededMarginL <= originalMarginL) {
            Plotly.downloadImage(gd, { format: "png", filename: name });
            return;
        }
        Plotly.relayout(gd, { "margin.l": neededMarginL })
            .then(() => Plotly.downloadImage(gd, { format: "png", filename: name }))
            .then(() => Plotly.relayout(gd, { "margin.l": originalMarginL }))
            .catch(() => Plotly.relayout(gd, { "margin.l": originalMarginL }));
    }

    return {
        wrapText,
        scaledDimension,
        downloadCSV,
        downloadChartImage,
        slugify,
        buildToplineBarChart,
        buildTrendLineChart,
        buildDemographicStackedBarChart,
        buildDemographicSmallMultiples,
    };
})();
