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
        const displayOptions = MASData.getQuestions().map((q) => q.display);
        const container = document.getElementById("question-picker-container");
        if (state.isMobile) {
            MASMobileViews.renderQuestionPicker(container, displayOptions, state.question, onQuestionChange);
        } else {
            container.innerHTML = `
                <label class="field-label" for="metro-question-select">Choose a question from the MAS 2025 Survey</label>
                <select id="metro-question-select" class="question-select"></select>
                <div class="field-help">Select a question to display, (No Trend) questions do not have year-over-year trend data whereas (Trend Available) questions do if you scroll down</div>`;
            const select = document.getElementById("metro-question-select");
            displayOptions.forEach((opt) => {
                const el = document.createElement("option");
                el.value = opt;
                el.textContent = opt;
                if (opt === state.question) el.selected = true;
                select.appendChild(el);
            });
            select.addEventListener("change", () => onQuestionChange(select.value));
        }
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
            const label = document.createElement("label");
            label.className = year === state.year ? "selected" : "";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "metro-year";
            input.value = year;
            input.checked = year === state.year;
            input.addEventListener("change", () => onYearChange(year));
            label.appendChild(input);
            label.appendChild(document.createTextNode(year));
            group.appendChild(label);
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

    function renderResponseDistribution() {
        const heading = document.getElementById("response-dist-heading");
        heading.textContent = `${state.year} Response Distribution`;

        const topline = MASData.getTopline(currentQuestionRecord().key, state.year);
        const container = document.getElementById("response-dist-container");
        if (!topline) {
            container.innerHTML = `<div class="loading-note">No data available for this question/year.</div>`;
            return;
        }
        const questionTitle = currentQuestionRecord().verb_by_year[state.year] || currentQuestionRecord().key;

        if (state.isMobile) {
            container.innerHTML = MASMobileViews.responseBarListHTML(topline.sort_order, topline.colors, topline.percents, questionTitle);
        } else {
            container.innerHTML = `<div id="topline-chart" class="chart-container"></div>`;
            MASCharts.buildToplineBarChart("topline-chart", topline.sort_order, topline.colors, topline.percents, questionTitle);
        }
    }

    function renderTrendSection() {
        const q = currentQuestionRecord();
        const container = document.getElementById("trend-container");
        if (!q.has_trend) {
            container.innerHTML = `<div class="info-box">📊 There is no recent and viable year-over-year trend data for this question.</div>`;
            return;
        }
        const trend = MASData.getMetroTrend(q.key);
        if (!trend) {
            container.innerHTML = `<div class="info-box">📊 There is no recent and viable year-over-year trend data for this question.</div>`;
            return;
        }
        container.innerHTML = `
            <div id="trend-chart" class="chart-container"></div>
            <div class="section-caption">Note: Remaining percentages are either Don't Know or Not Available.</div>
            <div class="info-box">📊 This chart shows trends across ALL survey years, regardless of the year filter above.</div>`;
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

            const toggle = document.getElementById("mobile-toggle");
            MASMain.initMobileToggle(toggle, (isMobile) => {
                state.isMobile = isMobile;
                renderQuestionPicker();
                renderResponseDistribution();
                renderTrendSection();
            });

            renderQuestionPicker();
            renderYearControls();
            renderModePills();
            renderResponseDistribution();
            renderTrendSection();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
