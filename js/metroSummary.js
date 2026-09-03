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
            container.innerHTML = `<div class="info-box">There is no recent and viable year-over-year trend data for this question.</div>`;
            return;
        }
        const trend = MASData.getMetroTrend(q.key);
        if (!trend) {
            container.innerHTML = `<div class="info-box">There is no recent and viable year-over-year trend data for this question.</div>`;
            return;
        }
        container.innerHTML = `
            <div id="trend-chart" class="chart-container"></div>
            <div class="section-caption">Note: Remaining percentages are either Don't Know or Not Available.</div>
            <div class="section-caption">Note: This chart shows trends across ALL survey years, regardless of the year filter above.</div>`;
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
