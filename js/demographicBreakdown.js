/**
 * demographicBreakdown.js -- page orchestration for the Demographic
 * Breakdown page. Mirrors MAS_Dashboard_App/demographic_breakdown.py's
 * control flow: question picker -> year radio + Topline/Detailed pill ->
 * demographic segmented control -> stacked bar (desktop, click-to-drill)
 * / card list (mobile) -> historical trend.
 *
 * Selected-demo-value persistence: SharedState.getSelectedDemoValue(
 * demoColumn) is read fresh on every render rather than kept in local
 * `state`, mirroring get_clicked_demo_value()'s own contract in the
 * server app (it re-reads the persisted widget selection every rerun,
 * rather than the app tracking a separate copy) -- keyed by demographic
 * *column*, so a selection survives a question change (still a valid
 * value for the same demographic type) but resets when the demographic
 * type itself changes.
 *
 * One deliberate, minor difference from the server app, documented here
 * rather than silently ported: the server app used two independent
 * selection keys for the same concept (the desktop Plotly widget's own
 * internal state vs. mobile's separate `mobile_selected_demo_value__*`
 * session-state key), so a selection made on desktop didn't show as
 * selected after toggling to mobile mid-session, and vice versa -- an
 * artifact of two different naming schemes, not a deliberate design
 * choice. This build uses one shared key (SharedState.getSelectedDemoValue)
 * for both, so a selection survives toggling the mobile/desktop view.
 */

(function () {
    const state = {
        question: null,
        year: null,
        isMobile: false,
        demographic: null, // display name, e.g. "Jurisdiction"
        chartView: "stacked", // "stacked" | "small-multiples" -- desktop only
    };

    const CROSSTAB_NOTE = "Note: Remaining percentages are either Don't Know or Not Available. Percentages may vary slightly from those reported in other MAS products, go to FAQ for more details.";
    // Only the stacked view has a legend (small multiples uses per-panel
    // column headers instead) -- shown as a second line under the note
    // above so the legend's own click/double-click behavior isn't
    // something a user has to already know Plotly supports.
    const LEGEND_HINT = "Tip: Click a legend entry to hide that response; double-click one to isolate it.";

    function validateYear(year, yearOptions) {
        return yearOptions.includes(year) ? year : yearOptions[0];
    }

    function currentQuestionRecord() {
        return MASData.getQuestions().find((q) => q.display === state.question);
    }

    function yearOptionsFor(questionRecord) {
        return questionRecord.years
            .slice()
            .sort((a, b) => b - a)
            .map(String);
    }

    function currentDemoColumn() {
        return MASData.getDemographics().find((d) => d.name === state.demographic).column;
    }

    function toTitleCase(str) {
        return str
            .toLowerCase()
            .split(" ")
            .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(" ");
    }

    function renderQuestionPicker() {
        const questions = MASData.getQuestions();
        const container = document.getElementById("question-picker-container");
        if (state.isMobile) {
            MASMobileViews.renderQuestionPicker(container, questions, state.question, onQuestionChange);
            return;
        }
        // See metroSummary.js's identical comment: the wrapper is built
        // once so the picker element's own listeners (bound once, see
        // questionPicker.js) aren't re-attached on every question change.
        let pickerEl = document.getElementById("demo-question-picker");
        if (!pickerEl) {
            container.innerHTML = `
                <label class="field-label" for="demo-question-btn">Choose a question from the MAS 2025 Survey<span class="help-icon" tabindex="0">?<span class="help-icon__tooltip">Select a question to display, (No Trend) questions do not have year-over-year trend data whereas (Trend Available) questions do if you scroll down</span></span></label>
                <div id="demo-question-picker" class="qpicker"></div>`;
            pickerEl = document.getElementById("demo-question-picker");
        }
        MASQuestionPicker.render(pickerEl, questions, state.question, onQuestionChange, "demo-question-btn");
    }

    function onQuestionChange(newDisplay) {
        state.question = newDisplay;
        SharedState.setSharedQuestion(newDisplay);
        const q = currentQuestionRecord();
        const yearOptions = yearOptionsFor(q);
        state.year = validateYear(state.year, yearOptions);
        SharedState.setSharedYear(state.year);
        renderQuestionPicker();
        renderYearControls();
        renderCrosstabSection();
    }

    function renderYearControls() {
        const q = currentQuestionRecord();
        const yearOptions = yearOptionsFor(q);
        const group = document.getElementById("year-radio-group");
        group.innerHTML = "";
        yearOptions.forEach((year) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = year;
            if (year === state.year) btn.className = "selected";
            btn.addEventListener("click", () => onYearChange(year));
            group.appendChild(btn);
        });
    }

    function onYearChange(newYear) {
        state.year = newYear;
        SharedState.setSharedYear(newYear);
        renderYearControls();
        renderCrosstabSection();
    }

    function renderModePills() {
        const container = document.getElementById("mode-pills");
        container.innerHTML = `
            <button type="button" data-mode="Topline">Topline</button>
            <button type="button" class="selected" data-mode="Detailed">Detailed</button>`;
        container.querySelector('[data-mode="Topline"]').addEventListener("click", () => {
            window.location.href = "metro_summary.html";
        });
    }

    /** Desktop shows this as a dropdown sitting in the controls row
     * (between the year and summary-type selectors); mobile keeps the
     * original pill row, in its own spot below that row -- two separate
     * elements, one shown and one hidden via display:none based on
     * state.isMobile, same split as renderChartViewToggle() elsewhere in
     * this file. */
    function renderDemographicSelector() {
        const demographics = MASData.getDemographics();
        const desktopWrap = document.getElementById("demo-select-wrap");
        const mobileWrap = document.getElementById("demo-segmented-wrap");

        if (state.isMobile) {
            desktopWrap.style.display = "none";
            mobileWrap.style.display = "";
            const container = document.getElementById("demo-segmented");
            container.innerHTML = "";
            demographics.forEach((d) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.textContent = d.name;
                if (d.name === state.demographic) btn.className = "selected";
                btn.addEventListener("click", () => onDemographicChange(d.name));
                container.appendChild(btn);
            });
        } else {
            mobileWrap.style.display = "none";
            desktopWrap.style.display = "";
            const select = document.getElementById("demo-select");
            select.innerHTML = demographics
                .map((d) => `<option value="${escapeHtml(d.name)}"${d.name === state.demographic ? " selected" : ""}>${escapeHtml(d.name)}</option>`)
                .join("");
            // A plain property assignment (not addEventListener) so
            // re-calling this on every render replaces the old handler
            // instead of piling up a new one each time.
            select.onchange = () => onDemographicChange(select.value);
        }
    }

    function onDemographicChange(newDemo) {
        state.demographic = newDemo;
        SharedState.setSavedDemographic(newDemo);
        renderDemographicSelector();
        renderCrosstabSection();
    }

    /** Stacked-vs-small-multiples view toggle -- desktop only (mobile
     * already has its own card-list layout, unaffected by this). Both
     * views are built from the exact same crosstab data, just laid out
     * differently, and share the same click-to-drill selection callback
     * in renderCrosstabSection() below, so switching views never disturbs
     * a current selection. */
    function renderChartViewToggle() {
        const container = document.getElementById("chart-view-toggle");
        if (state.isMobile) {
            container.innerHTML = "";
            return;
        }
        // Built once; every later call (a toggle click, or just re-rendering
        // because the year/demographic changed) only updates .selected and
        // repositions the thumb below, rather than recreating the buttons.
        // The thumb has to be the *same* DOM node across renders for its
        // left/width CSS transition to have a "from" position to slide
        // from -- a freshly-recreated element has no prior state, so it'd
        // just snap into place instead of sliding.
        if (!container.querySelector(".chart-view-toggle__thumb")) {
            container.innerHTML = `
                <span class="chart-view-toggle__thumb"></span>
                <button type="button" data-view="stacked">Stacked</button>
                <button type="button" data-view="small-multiples">Small Multiples</button>`;
            // One listener on the whole track, not on each button, so
            // clicking anywhere in the switch -- its padding, the currently
            // selected label, the unselected one -- toggles it, like a real
            // switch rather than two separate hit targets. switchChartView
            // is a stable top-level function reference, so this is safe to
            // re-run on every render: addEventListener no-ops on a duplicate
            // (same function, same event, same target).
            container.addEventListener("click", switchChartView);
        }
        container.querySelectorAll("button").forEach((btn) => {
            btn.classList.toggle("selected", btn.dataset.view === state.chartView);
        });
        positionToggleThumb(container);
    }

    function positionToggleThumb(container) {
        const thumb = container.querySelector(".chart-view-toggle__thumb");
        const selected = container.querySelector("button.selected");
        if (!thumb || !selected) return;
        thumb.style.width = `${selected.offsetWidth}px`;
        thumb.style.left = `${selected.offsetLeft}px`;
    }

    /** Toggle-track click handler. Flips chartView and re-renders the
     * toggle immediately (so the thumb starts sliding right on click,
     * independent of the chart swap below), then separately fades the
     * chart out, rebuilds it in the new view, and fades it back in --
     * see the #crosstab-container.chart-transition-* rules in style.css. */
    function switchChartView() {
        state.chartView = state.chartView === "stacked" ? "small-multiples" : "stacked";
        renderChartViewToggle();

        const chartContainer = document.getElementById("crosstab-container");
        const canAnimate = !state.isMobile && chartContainer && chartContainer.children.length > 0;
        if (!canAnimate) {
            renderCrosstabSection();
            return;
        }
        chartContainer.classList.add("chart-transition-exit");
        window.setTimeout(() => {
            renderCrosstabSection();
            const el = document.getElementById("crosstab-container");
            if (!el) return;
            el.classList.remove("chart-transition-exit");
            el.classList.add("chart-transition-enter");
            void el.offsetWidth; // force layout so the "enter" starting state actually paints before it's removed below
            requestAnimationFrame(() => el.classList.remove("chart-transition-enter"));
        }, 180);
    }

    /** Wires (or hides) a "Download CSV" button. buildExport() returns
     * null when there's nothing valid to export right now -- the button
     * hides rather than downloading a stale file left over from whatever
     * was last successfully rendered. Re-run on every render, so .onclick
     * (a plain property, not addEventListener) always reflects the
     * current data rather than piling up old listeners. */
    function wireDownloadButton(btnId, buildExport) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const exportData = buildExport();
        if (!exportData) {
            btn.style.display = "none";
            btn.onclick = null;
            return;
        }
        btn.style.display = "";
        btn.onclick = () => MASCharts.downloadCSV(exportData.filename, exportData.headers, exportData.rows);
    }

    /** Wires (or hides) a "Download Image" button -- see metroSummary.js's
     * identical helper for the full explanation. Pass chartElementId: null
     * for anything that isn't a live Plotly chart right now (no data, or
     * mobile's non-Plotly card-list view). */
    function wireImageButton(btnId, chartElementId, filename) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (!chartElementId) {
            btn.style.display = "none";
            btn.onclick = null;
            return;
        }
        btn.style.display = "";
        btn.onclick = () => MASCharts.downloadChartImage(chartElementId, filename);
    }

    function renderCrosstabSection() {
        const q = currentQuestionRecord();
        const demoColumn = currentDemoColumn();
        const crosstab = MASData.getCrosstab(q.key, state.year, state.demographic);
        const headingEl = document.getElementById("crosstab-heading");
        const tipContainer = document.getElementById("tip-container");
        const chartContainer = document.getElementById("crosstab-container");
        const captionEl = document.getElementById("crosstab-caption");
        const historicalCard = document.getElementById("historical-card");
        const historicalContainer = document.getElementById("historical-container");

        // Rebuilding the Plotly chart(s) below (innerHTML + Plotly.newPlot)
        // can make the browser jump the page back toward the top on
        // desktop -- reported when selecting a bar (which also reveals the
        // historical chart below) or switching stacked/small-multiples.
        // Pin the scroll position back to wherever the user actually was,
        // both right after this render and on the next frame, in case the
        // jump happens slightly later (e.g. via Plotly's own responsive
        // resize handling). Desktop only -- mobile's own card-list view has
        // its own deliberate scroll-to-top elsewhere (picking a new
        // question), which this must not interfere with.
        const scrollY = state.isMobile ? null : window.scrollY;
        const restoreScroll = () => {
            if (scrollY != null && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
        };

        renderChartViewToggle();
        headingEl.textContent = "";
        tipContainer.innerHTML = "";
        historicalContainer.innerHTML = "";
        historicalCard.style.display = "none";
        captionEl.style.display = "none";

        const crosstabBaseFilename = `${MASCharts.slugify(q.key)}_${state.year}_${MASCharts.slugify(state.demographic)}`;
        wireDownloadButton("crosstab-download-btn", () => {
            if (!crosstab) return null;
            return {
                filename: `${crosstabBaseFilename}.csv`,
                headers: [state.demographic, ...crosstab.response_sort_order],
                rows: crosstab.groups.map((g) => [
                    g.group_display,
                    ...crosstab.response_sort_order.map((r) => (g.percents[r] !== undefined ? (g.percents[r] * 100).toFixed(0) : "")),
                ]),
            };
        });

        if (!crosstab) {
            // Same distinction the server app makes: does this (question, year)
            // have ANY data at all (topline would exist), or just not for this
            // particular demographic?
            const hasAnyData = MASData.getTopline(q.key, state.year) != null;
            chartContainer.innerHTML = hasAnyData
                ? `<div class="warning-box">${escapeHtml(state.demographic)} data not available for this question.</div>`
                : `<div class="info-box">No data available for the selected filters.</div>`;
            wireImageButton("crosstab-download-img-btn", null);
            restoreScroll();
            requestAnimationFrame(restoreScroll);
            return;
        }

        captionEl.style.display = "";
        captionEl.innerHTML =
            !state.isMobile && state.chartView === "stacked"
                ? `${CROSSTAB_NOTE}<br>${LEGEND_HINT}`
                : CROSSTAB_NOTE;

        if (state.isMobile) {
            // Desktop-only heading stays blank here -- the mobile card list
            // shows "Response by X Demographic (Year)" itself, styled as
            // its own heading with the question demoted below it (see
            // MASMobileViews.renderDemographicCardList), so showing it a
            // second time up here would just duplicate it.
            const selectedValue = SharedState.getSelectedDemoValue(demoColumn);
            MASMobileViews.renderDemographicCardList(chartContainer, crosstab, state.demographic, {
                selectedValue,
                showTrendButton: q.has_trend,
                onSelectionChange: (rawValueOrNull) => {
                    SharedState.setSelectedDemoValue(demoColumn, rawValueOrNull);
                    renderCrosstabSection();
                },
                renderTrendForSelected: (trendContainerEl, rawValue) => {
                    renderHistoricalChartInto(trendContainerEl, q, rawValue, true);
                },
            });
            wireImageButton("crosstab-download-img-btn", null); // mobile's card list isn't a Plotly chart
        } else {
            // "Response by X Demographic (Year)" -- styled the same
            // .section-heading blue as the Metro Summary page's card
            // headings (e.g. "2025 Response Distribution"), rather than
            // living inside the Plotly chart's own title as a smaller
            // subtitle.
            headingEl.textContent = crosstab.subtitle;
            const selectedValue = SharedState.getSelectedDemoValue(demoColumn);
            const onSelect = (rawValue) => {
                SharedState.setSelectedDemoValue(demoColumn, rawValue);
                renderCrosstabSection();
            };
            if (state.chartView === "small-multiples") {
                chartContainer.innerHTML = `<div class="small-multiples-scroll"><div id="demo-stacked-chart"></div></div>`;
                MASCharts.buildDemographicSmallMultiples("demo-stacked-chart", crosstab, state.demographic, selectedValue, onSelect);
            } else {
                chartContainer.innerHTML = `<div id="demo-stacked-chart" class="chart-container"></div>`;
                MASCharts.buildDemographicStackedBarChart("demo-stacked-chart", crosstab, state.demographic, selectedValue, onSelect);
            }
            wireImageButton("crosstab-download-img-btn", "demo-stacked-chart", `${crosstabBaseFilename}.png`);
            renderDesktopHistoricalSection(q, selectedValue);
        }

        restoreScroll();
        requestAnimationFrame(restoreScroll);
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** Desktop's 3-way branch below the stacked bar chart: an actual
     * chart, a "click a bar" tip, or a "no historical data" message --
     * see this file's docstring / demographic_breakdown.py's own
     * elif-chain for the exact conditions ported here. The "Year-over-Year
     * Trends" card (a static heading like the Metro Summary page's, wrapping
     * #historical-container) is shown/hidden as a whole rather than relying
     * on the container being :empty, since it now always has that heading
     * as a child even when there's nothing else to show yet. */
    function renderDesktopHistoricalSection(q, selectedValue) {
        const card = document.getElementById("historical-card");
        const container = document.getElementById("historical-container");
        const tipContainer = document.getElementById("tip-container");
        container.innerHTML = "";
        tipContainer.innerHTML = "";

        if (q.has_trend && selectedValue != null) {
            const hist = MASData.getHistorical(q.key, state.demographic, selectedValue);
            if (hist && Object.keys(hist.by_year).length) {
                card.style.display = "";
                renderHistoricalChartInto(container, q, selectedValue, false);
                return;
            }
            // Falls through to the generic "no historical data" message below,
            // matching the server app's own elif-chain behavior for this edge
            // case (a selected value with no computable historical series).
        }

        if (q.has_trend && selectedValue == null) {
            card.style.display = "none";
            tipContainer.innerHTML = `<div class="tip-box">💡 <strong>Tip:</strong> <em>Click on any bar in the chart above and Scroll Down to see historical trends for that demographic group which will pop up in a lower chart</em></div>`;
        } else {
            card.style.display = "";
            container.innerHTML = `<div class="info-box">Selected question does not have historical data or has no valid time series data.</div>`;
            wireDownloadButton("historical-download-btn", () => null);
            wireImageButton("historical-download-img-btn", null);
        }
    }

    function renderHistoricalChartInto(containerEl, q, rawValue, isMobileCard) {
        const hist = MASData.getHistorical(q.key, state.demographic, rawValue);
        if (!hist || !Object.keys(hist.by_year).length) {
            containerEl.innerHTML = `<div class="info-box">Selected question does not have historical data or has no valid time series data.</div>`;
            if (!isMobileCard) wireImageButton("historical-download-img-btn", null);
            return;
        }
        const elId = `historical-chart-${Math.random().toString(36).slice(2)}`;
        // Desktop's gray Plotly title is now just "Cobb County (Jurisdiction)"
        // -- the "Historic Response Trends:" prefix is redundant now that
        // the "Year-over-Year Trends" heading sits above this chart's card.
        const chartTitle = isMobileCard
            ? `Historic ${rawValue} Response`
            : `${rawValue} (${toTitleCase(state.demographic)})`;
        const historicalNote = "Note: The Historic Response Trends chart shows trends across ALL survey years, regardless of the year filter above.";
        containerEl.innerHTML = `
            <div id="${elId}" class="chart-container"></div>
            <div class="section-caption">${isMobileCard ? historicalNote : `${historicalNote}<br>${LEGEND_HINT}`}</div>`;
        if (!isMobileCard) {
            const histBaseFilename = `${MASCharts.slugify(q.key)}_${MASCharts.slugify(state.demographic)}_${MASCharts.slugify(rawValue)}_trend`;
            wireDownloadButton("historical-download-btn", () => {
                const years = Object.keys(hist.by_year).sort();
                return {
                    filename: `${histBaseFilename}.csv`,
                    headers: ["Year", ...hist.sort_order],
                    rows: years.map((y) => [y, ...hist.sort_order.map((r) => (hist.by_year[y][r] !== undefined ? (hist.by_year[y][r] * 100).toFixed(0) : ""))]),
                };
            });
            wireImageButton("historical-download-img-btn", elId, `${histBaseFilename}.png`);
        }
        MASCharts.buildTrendLineChart(
            elId,
            hist.sort_order,
            hist.colors,
            hist.by_year,
            chartTitle,
            hist.end_date,
            state.isMobile,
            { label: state.demographic, value: rawValue }
        );
    }

    function init() {
        MASData.load().then(() => {
            const displayOptions = MASData.getQuestions().map((q) => q.display);
            state.question = SharedState.getSharedQuestion(displayOptions);
            const q = currentQuestionRecord();
            state.year = SharedState.getSharedYear(yearOptionsFor(q));
            state.isMobile = SharedState.getIsMobile();
            state.demographic = SharedState.getSavedDemographic("Jurisdiction");

            renderQuestionPicker();
            renderYearControls();
            renderModePills();
            renderDemographicSelector();
            renderCrosstabSection();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
