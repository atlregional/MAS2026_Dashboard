/**
 * metroSummary.js -- page orchestration for the Metro Summary page.
 * Mirrors MAS_Dashboard_App/metro_summary.py's control flow: question
 * picker -> year radio + Topline/Detailed pill -> response distribution
 * -> year-over-year trend. No framework: one state object, and each
 * control's change handler re-renders just the sections that depend on
 * it (matches this build's plan -- full-section innerHTML/Plotly.newPlot
 * rebuilds, no virtual-DOM diffing).
 */

(function () {
    const state = {
        question: null, // display string
        year: null, // string
        isMobile: false,
    };

    // Desktop only -- the trend chart's legend isn't interactive on mobile
    // (buildTrendLineChart renders it via staticPlot there).
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

    function renderQuestionPicker() {
        const questions = MASData.getQuestions();
        const container = document.getElementById("question-picker-container");
        if (state.isMobile) {
            MASMobileViews.renderQuestionPicker(container, questions, state.question, onQuestionChange);
            return;
        }
        // The label + picker wrapper is built once and left alone on
        // later calls -- MASQuestionPicker.render() re-renders just the
        // picker element itself, so its own listeners (bound once, see
        // questionPicker.js) don't get re-attached on every question
        // change.
        let pickerEl = document.getElementById("metro-question-picker");
        if (!pickerEl) {
            container.innerHTML = `
                <label class="field-label" for="metro-question-btn">Choose a question from the MAS 2025 Survey<span class="help-icon" tabindex="0">?<span class="help-icon__tooltip">Select a question to display, (No Trend) questions do not have year-over-year trend data whereas (Trend Available) questions do if you scroll down</span></span></label>
                <div id="metro-question-picker" class="qpicker"></div>`;
            pickerEl = document.getElementById("metro-question-picker");
        }
        MASQuestionPicker.render(pickerEl, questions, state.question, onQuestionChange, "metro-question-btn");
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
        renderResponseDistribution();
        renderTrendSection();
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
        renderResponseDistribution();
    }

    function renderModePills() {
        const container = document.getElementById("mode-pills");
        container.innerHTML = `
            <button type="button" class="selected" data-mode="Topline">Topline</button>
            <button type="button" data-mode="Detailed">Detailed</button>`;
        container.querySelector('[data-mode="Detailed"]').addEventListener("click", () => {
            window.location.href = "demographic_breakdown.html";
        });
    }

    /** Wires (or hides) a "Download CSV" button. buildExport() returns
     * null when there's nothing valid to export right now (no data for
     * this question/year) -- the button hides rather than downloading a
     * stale file left over from whatever was last successfully rendered.
     * Re-run on every render, so .onclick (a plain property, not
     * addEventListener) always reflects the current data, not a pile of
     * old listeners each still closing over their own render's data. */
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

    /** Wires (or hides) a "Download Image" button. Unlike wireDownloadButton
     * above, this has to run *after* the chart itself has actually been
     * (re)built -- checking a chart's live state any earlier would still
     * see whatever was left over from the previous render. Pass
     * chartElementId: null for anything that isn't a live Plotly chart
     * right now (no data, or mobile's non-Plotly card-list views). */
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

    function renderResponseDistribution() {
        const heading = document.getElementById("response-dist-heading");
        heading.textContent = `${state.year} Response Distribution`;

        const topline = MASData.getTopline(currentQuestionRecord().key, state.year);
        const container = document.getElementById("response-dist-container");
        const baseFilename = `${MASCharts.slugify(currentQuestionRecord().key)}_${state.year}_topline`;
        wireDownloadButton("topline-download-btn", () => {
            if (!topline) return null;
            return {
                filename: `${baseFilename}.csv`,
                headers: ["Response", "Percent"],
                rows: topline.sort_order
                    .filter((r) => topline.percents[r] !== undefined)
                    .map((r) => [r, (topline.percents[r] * 100).toFixed(0)]),
            };
        });
        if (!topline) {
            container.innerHTML = `<div class="loading-note">No data available for this question/year.</div>`;
            wireImageButton("topline-download-img-btn", null);
            return;
        }
        const questionTitle = currentQuestionRecord().verb_by_year[state.year] || currentQuestionRecord().key;

        if (state.isMobile) {
            container.innerHTML = MASMobileViews.responseBarListHTML(topline.sort_order, topline.colors, topline.percents, questionTitle);
            wireImageButton("topline-download-img-btn", null);
        } else {
            container.innerHTML = `<div id="topline-chart" class="chart-container"></div>`;
            MASCharts.buildToplineBarChart("topline-chart", topline.sort_order, topline.colors, topline.percents, questionTitle);
            wireImageButton("topline-download-img-btn", "topline-chart", `${baseFilename}.png`);
        }
    }

    function renderTrendSection() {
        const q = currentQuestionRecord();
        const container = document.getElementById("trend-container");
        const trend = q.has_trend ? MASData.getMetroTrend(q.key) : null;
        const baseFilename = `${MASCharts.slugify(q.key)}_trend`;
        wireDownloadButton("trend-download-btn", () => {
            if (!trend) return null;
            const years = Object.keys(trend.by_year).sort();
            return {
                filename: `${baseFilename}.csv`,
                headers: ["Year", ...trend.sort_order],
                rows: years.map((y) => [y, ...trend.sort_order.map((r) => (trend.by_year[y][r] !== undefined ? (trend.by_year[y][r] * 100).toFixed(0) : ""))]),
            };
        });
        if (!q.has_trend || !trend) {
            container.innerHTML = `<div class="info-box">There is no recent and viable year-over-year trend data for this question.</div>`;
            wireImageButton("trend-download-img-btn", null);
            return;
        }
        container.innerHTML = `
            <div id="trend-chart" class="chart-container"></div>
            <div class="section-caption">Note: Remaining percentages are either Don't Know or Not Available.</div>
            <div class="section-caption">Note: This chart shows trends across ALL survey years, regardless of the year filter above.${state.isMobile ? "" : `<br>${LEGEND_HINT}`}</div>`;
        wireImageButton("trend-download-img-btn", "trend-chart", `${baseFilename}.png`);
        MASCharts.buildTrendLineChart(
            "trend-chart",
            trend.sort_order,
            trend.colors,
            trend.by_year,
            "Response Trends Over Time (All Years)",
            trend.end_date,
            state.isMobile,
            null
        );
    }

    function init() {
        MASData.load().then(() => {
            const displayOptions = MASData.getQuestions().map((q) => q.display);
            state.question = SharedState.getSharedQuestion(displayOptions);
            const q = currentQuestionRecord();
            state.year = SharedState.getSharedYear(yearOptionsFor(q));
            state.isMobile = SharedState.getIsMobile();

            renderQuestionPicker();
            renderYearControls();
            renderModePills();
            renderResponseDistribution();
            renderTrendSection();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
