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
    // Matches --control-border in style.css: WCAG SC 1.4.11 (3:1) --
    // GRID_COLOR (#e5e5e5) is only ~1.26:1 against white, fine for a
    // gridline but too faint to serve as a component boundary like a
    // tooltip's own outline.
    const TOOLTIP_BORDER_COLOR = "#8d8d8d";
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

    /** Positions a small custom tooltip at the mouse cursor, instead of
     * Plotly's own default hover label -- which always anchors to the data
     * point itself (e.g. the end of a bar), not the cursor, and has no
     * built-in option to do otherwise. The caller must suppress Plotly's
     * native hover box on its traces (hoverinfo: "none") so the two don't
     * show up stacked on top of each other, and pass renderContent(point)
     * to build the tooltip's HTML from whichever point is hovered.
     * plotly_hover only fires once per point-enter (not per pixel of
     * motion), so this also tracks raw mousemove while a point is active to
     * keep the tooltip actually following the cursor around within it. */
    function attachCursorTooltip(gd, renderContent) {
        // Appended to <body>, positioned with `fixed` (viewport
        // coordinates), rather than living inside the chart's own
        // container with `absolute` -- confirmed live that the small
        // multiples chart's scrollable wrapper (overflow-x: auto, which
        // forces overflow-y: auto too) was clipping the tooltip for any
        // bar near its right or bottom edge. `fixed` positioning escapes
        // that ancestor's clipping entirely. Re-renders of the same chart
        // slot (a stable elementId, e.g. "demo-stacked-chart") reuse the
        // same tooltip element rather than piling up a fresh orphaned one
        // in <body> every time.
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
            // Flips to the other side of the cursor on whichever axis
            // would otherwise push the tooltip past the *browser
            // window's* edge, not just the chart's -- the user's other
            // complaint ("atrocious on the bottom right") was really the
            // same clipping bug, but this guards the viewport edge too
            // now that nothing else is clipping it.
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
        // A plain property assignment (not addEventListener) so re-calling
        // this on a re-render replaces the old handler instead of piling up
        // a new one each time -- same reasoning as the gd.on() pattern above.
        gd.onmousemove = (e) => {
            if (active) position(e.clientX, e.clientY);
        };
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
                // Native hover box suppressed in favor of the cursor-
                // following custom tooltip attached below.
                hoverinfo: "none",
                showlegend: false,
            }));

        const height = scaledDimension(nCategories, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            height,
            dragmode: false, // no click-drag pan/zoom -- these percentages are fixed, not something to be dragged around
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

        // Unlike every other chart's title here, this one was never wrapped
        // at all -- fine on a full-width desktop card, but on a narrow
        // mobile chart (and mobile's per-card historical view, which is
        // narrower still, nested inside a .demo-card) a long title (e.g.
        // "Historic City of Atlanta Response") ran past the chart's own
        // edge and got clipped. Measures the actual container width at
        // render time (same approach as the small multiples chart's title)
        // rather than a fixed mobile-vs-desktop guess, since this single
        // function renders into containers of very different widths
        // depending on which page/view calls it.
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
                // Thicker connecting line on desktop only (mobile keeps
                // Plotly's default width) -- shared by both the Metro
                // Summary trend chart and Demographic Breakdown's
                // historic trend chart, since both call this function.
                line: { color: colors[response] || FALLBACK_BAR_COLOR, width: isMobile ? 2 : 3.5 },
                marker: { color: colors[response] || FALLBACK_BAR_COLOR },
                hovertemplate,
            }));

        const layout = {
            dragmode: false, // no click-drag pan/zoom -- these percentages are fixed, not something to be dragged around
            font: { family: FONT_FAMILY_CSS },
            title: { text: wrappedTitle, font: { size: 18, color: TITLE_FONT_COLOR } },
            legend: isMobile ? MOBILE_LEGEND : DESKTOP_LEGEND,
            hovermode: "closest",
            // Plotly's default hover label uses each trace's own line
            // color as its background (confirmed live: an orange line's
            // tooltip rendered on a bright rgb(255,159,88) background,
            // with the same fixed dark-gray text Plotly always uses) --
            // fine for some trace colors, not guaranteed for all of them.
            // Pinned to a consistent white background + dark gray text
            // (~6.5:1, comfortably over WCAG's 4.5:1) regardless of which
            // line is hovered.
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

        // staticPlot used to disable all interactivity on mobile, which
        // meant no tooltip at all on touch devices. Removed -- now that
        // dragmode is off above, a tap doesn't fight page scrolling the
        // way a drag-to-pan gesture could have.
        const config = { responsive: true, displaylogo: false, displayModeBar: false, doubleClick: false };
        const gd = document.getElementById(elementId);
        Plotly.newPlot(gd, traces, layout, config);

        // Plotly's own hover detection is mouse-driven -- confirmed live
        // (real touch-event simulation via CDP, not just Playwright's
        // higher-level helpers) that a tap alone never fires
        // plotly_hover/plotly_click here, on this Plotly version, so
        // mobile would still show nothing on tap without this. A plain
        // "click" DOM listener *does* fire reliably from a tap (browsers
        // synthesize it independent of Plotly's own gesture recognition),
        // so this finds whichever marker is screen-closest to the tap and
        // asks Plotly to show its hover label for it via the public
        // Fx.hover API -- same label, same styling, as a real hover.
        // Tapping far from any marker (the title, the margins) clears it
        // instead of anchoring to something irrelevant.
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
                    // Plotly's native hover box is suppressed here in favor
                    // of attachCursorTooltip below, which shows the same
                    // info but follows the cursor instead of anchoring to
                    // the bar's end.
                    hoverinfo: "none",
                };
            });

        const nGroups = orderedGroups.length;
        const height = scaledDimension(nGroups, PX_PER_BAR_HEIGHT, HEIGHT_MARGIN, MIN_HEIGHT);

        const layout = {
            barmode: "stack",
            dragmode: false, // no click-drag pan/zoom -- these percentages are fixed, not something to be dragged around
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
                // Native hover box suppressed in favor of the cursor-
                // following custom tooltip attached below.
                hoverinfo: "none",
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
        // -2 chars reserves room for the " ⇅"/" ▼" sort-cue suffix
        // buildHeaderAnnotations appends below, so it never pushes a
        // borderline-length header past its panel's width on the wrapped
        // last line.
        const headerCharsPerLine = Math.max(8, Math.floor((PANEL_WIDTH - HEADER_GUTTER) / 5.2) - 2);
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

        // Clicking a column header cycles that response's sort through
        // three states: most-to-least, least-to-most, then back to the
        // default order -- clicking a *different* header starts that same
        // cycle fresh from most-to-least, matching a typical sortable-table
        // convention. All panels share one row order (only panel 0 shows
        // labels, so every panel MUST stay in the same order or the
        // unlabeled panels' rows would no longer line up with panel 0's),
        // so sorting by one response reorders all of them at once via
        // their y-axes' categoryarray, not just the clicked panel's own.
        let activeSortResponse = null;
        let activeSortDirection = null; // "desc" | "asc" -- only meaningful while activeSortResponse is set

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

        // captureevents makes each header clickable (fires plotly_clickannotation
        // below) and gets Plotly's own pointer-cursor hint on hover for free.
        // Every header carries a small "⇅" so the sort feature is
        // discoverable at a glance -- clicking a bare header with no visual
        // cue isn't something a user would think to try. The active column
        // swaps its "⇅" for "▼" (descending) or "▲" (ascending) to show
        // which sort is currently applied.
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
            dragmode: false, // no click-drag pan/zoom -- these percentages are fixed, not something to be dragged around
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

        // Same synchronous-attach reasoning as buildDemographicStackedBarChart
        // (see its comment) -- avoids the same click-lands-during-the-gap-
        // before-the-handler-reattaches race.
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
                // A different column (or nothing) was active -- start this
                // one's cycle fresh at descending, not wherever the last
                // column's cycle happened to be.
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
                // Plotly.relayout quirk (confirmed live): the first axis has
                // to be addressed as "yaxis", not "yaxis1" -- "yaxis1" is
                // accepted fine as a layout *key* at newPlot time, but as a
                // relayout *path* it silently no-ops instead of updating
                // anything. Every later axis does take its numbered form.
                const axisKey = i === 0 ? "yaxis" : `yaxis${i + 1}`;
                axisUpdate[`${axisKey}.categoryarray`] = newOrder;
            });
            Plotly.relayout(gd, { ...axisUpdate, annotations: buildHeaderAnnotations(activeSortResponse, activeSortDirection) });
        });
        attachCursorTooltip(gd, (point) => {
            return `${demographicLabel}: ${point.y}<br>Response: ${point.data.name}<br>Percent: ${Math.round(point.x * 100)}%`;
        });
    }

    /** Triggers a browser download of `rows` (headers + data, already
     * plain arrays of primitives) as a CSV file -- used by each page's
     * "Download CSV" button to export whatever chart is currently in
     * view. A value containing a comma, quote, or newline gets quoted
     * (and its own quotes doubled) per the usual CSV convention;
     * everything else is written as-is. */
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

    /** Filesystem-safe-ish filename fragment: lowercased, non-alphanumerics
     * collapsed to single underscores, trimmed. Good enough for the
     * question keys/labels this is used on -- not a general slugify. */
    function slugify(text) {
        return String(text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    /** Triggers a PNG download of whatever's currently plotted in
     * elementId, via Plotly's own export (the same thing the modebar's
     * camera icon used to call) -- used by each page's "Download Image"
     * button now that the modebar itself is turned off everywhere
     * (displayModeBar: false, see each build* function's config). Silently
     * does nothing if elementId isn't a live Plotly chart (e.g. mobile's
     * card-list views, which never call Plotly.newPlot at all). */
    function downloadChartImage(elementId, filename) {
        const gd = document.getElementById(elementId);
        if (!gd || !gd.data) return;
        // Plotly.downloadImage appends the format's own extension itself
        // (confirmed live: passing "foo.png" downloaded "foo.png.png") --
        // strip a trailing .png here so every caller can just pass a plain
        // descriptive name without needing to know that.
        const name = filename.replace(/\.png$/i, "");

        // automargin's on-screen margin.l isn't reliable enough to trust
        // for the exported image. Confirmed live with a chart that showed
        // zero visible clipping on screen (every y-axis label had a couple
        // pixels of breathing room, however slim) but still cropped its
        // widest label in the exported PNG regardless -- comparing each
        // label's on-screen position against the chart's own left edge
        // (i.e. checking for *overflow*) still isn't a reliable enough
        // margin, apparently because whatever Plotly's export path
        // measures text with doesn't perfectly agree with the live DOM.
        // What *does* work, confirmed live: measuring the widest y-tick
        // label's own rendered *width* and setting margin.l to comfortably
        // exceed it outright (not just relative to whatever margin
        // currently exists) -- a direct guarantee instead of a delta on
        // top of a number that's already shown itself untrustworthy.
        // Restored immediately after export, so the on-screen chart is
        // completely unaffected.
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
