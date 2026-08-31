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
        const displayOptions = MASData.getQuestions().map((q) => q.display);
        const container = document.getElementById("question-picker-container");
        if (state.isMobile) {
            MASMobileViews.renderQuestionPicker(container, displayOptions, state.question, onQuestionChange);
        } else {
            container.innerHTML = `
                <label class="field-label" for="demo-question-select">Choose a question from the MAS 2025 Survey</label>
                <select id="demo-question-select" class="question-select"></select>
                <div class="field-help">Select a question to display, (No Trend) questions do not have year-over-year trend data whereas (Trend Available) questions do if you scroll down</div>`;
            const select = document.getElementById("demo-question-select");
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
        renderCrosstabSection();
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
            input.name = "demo-year";
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
        renderCrosstabSection();
    }

    function renderModePills() {
        const container = document.getElementById("mode-pills");
        container.innerHTML = `
            <button type="button" data-mode="Topline">Topline</button>
            <button type="button" class="selected" data-mode="Detailed">Detailed</button>`;
        container.querySelector('[data-mode="Topline"]').addEventListener("click", () => {
            window.location.href = "index.html";
        });
    }

    function renderDemographicSelector() {
        const demographics = MASData.getDemographics();
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
    }

    function onDemographicChange(newDemo) {
        state.demographic = newDemo;
        SharedState.setSavedDemographic(newDemo);
        renderDemographicSelector();
        renderCrosstabSection();
    }

    function renderCrosstabSection() {
        const q = currentQuestionRecord();
        const demoColumn = currentDemoColumn();
        const crosstab = MASData.getCrosstab(q.key, state.year, state.demographic);
        const tipContainer = document.getElementById("tip-container");
        const chartContainer = document.getElementById("crosstab-container");
        const captionEl = document.getElementById("crosstab-caption");
        const historicalContainer = document.getElementById("historical-container");

        tipContainer.innerHTML = "";
        historicalContainer.innerHTML = "";
        captionEl.style.display = "none";

        if (!crosstab) {
            // Same distinction the server app makes: does this (question, year)
            // have ANY data at all (topline would exist), or just not for this
            // particular demographic?
            const hasAnyData = MASData.getTopline(q.key, state.year) != null;
            chartContainer.innerHTML = hasAnyData
                ? `<div class="warning-box">${escapeHtml(state.demographic)} data not available for this question.</div>`
                : `<div class="info-box">No data available for the selected filters.</div>`;
            return;
        }

        captionEl.style.display = "";

        if (state.isMobile) {
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
        } else {
            chartContainer.innerHTML = `<div id="demo-stacked-chart" class="chart-container"></div>`;
            const selectedValue = SharedState.getSelectedDemoValue(demoColumn);
            MASCharts.buildDemographicStackedBarChart(
                "demo-stacked-chart",
                crosstab,
                state.demographic,
                selectedValue,
                (rawValue) => {
                    SharedState.setSelectedDemoValue(demoColumn, rawValue);
                    renderCrosstabSection();
                }
            );
            renderDesktopHistoricalSection(q, selectedValue);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** Desktop's 3-way branch below the stacked bar chart: an actual
     * chart, a "click a bar" tip, or a "no historical data" message --
     * see this file's docstring / demographic_breakdown.py's own
     * elif-chain for the exact conditions ported here. */
    function renderDesktopHistoricalSection(q, selectedValue) {
        const container = document.getElementById("historical-container");
        const tipContainer = document.getElementById("tip-container");
        container.innerHTML = "";
        tipContainer.innerHTML = "";

        if (q.has_trend && selectedValue != null) {
            const hist = MASData.getHistorical(q.key, state.demographic, selectedValue);
            if (hist && Object.keys(hist.by_year).length) {
                renderHistoricalChartInto(container, q, selectedValue, false);
                return;
            }
            // Falls through to the generic "no historical data" message below,
            // matching the server app's own elif-chain behavior for this edge
            // case (a selected value with no computable historical series).
        }

        if (q.has_trend && selectedValue == null) {
            tipContainer.innerHTML = `<div class="tip-box">💡 <strong>Tip:</strong> <em>Click on any bar in the stacked bar chart below and Scroll Down to see historical trends for that demographic group which will pop up in a lower chart</em></div>`;
        } else {
            container.innerHTML = `<div class="info-box">Selected question does not have historical data or has no valid time series data.</div>`;
        }
    }

    function renderHistoricalChartInto(containerEl, q, rawValue, isMobileCard) {
        const hist = MASData.getHistorical(q.key, state.demographic, rawValue);
        if (!hist || !Object.keys(hist.by_year).length) {
            containerEl.innerHTML = `<div class="info-box">Selected question does not have historical data or has no valid time series data.</div>`;
            return;
        }
        const elId = `historical-chart-${Math.random().toString(36).slice(2)}`;
        const chartTitle = isMobileCard
            ? `Historic ${rawValue} Response`
            : `Historic Response Trends: ${rawValue} (${toTitleCase(state.demographic)})`;
        containerEl.innerHTML = `
            <div id="${elId}" class="chart-container"></div>
            <div class="info-box">📊 The Historic Response Trends chart shows trends across ALL survey years, regardless of the year filter above.</div>`;
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

            const toggle = document.getElementById("mobile-toggle");
            MASMain.initMobileToggle(toggle, (isMobile) => {
                state.isMobile = isMobile;
                renderQuestionPicker();
                renderCrosstabSection();
            });

            renderQuestionPicker();
            renderYearControls();
            renderModePills();
            renderDemographicSelector();
            renderCrosstabSection();
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
