/**
 * demographicBreakdown.js -- controller for the Demographic Breakdown page:
 * question picker, year buttons, Topline/Detailed toggle, demographic
 * selector, the crosstab chart (stacked bars or small multiples on desktop,
 * cards on mobile), and the selected group's historical trend.
 *
 * The selected demographic group is read from SharedState on every render
 * rather than kept in `state`. It is stored per demographic column, so it
 * survives a question change but resets when the demographic type changes.
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
    // Shown under the note for the stacked view only; small multiples has no legend.
    const LEGEND_HINT = "Tip: Click a legend entry to hide that response; double-click one to isolate it.";

    function validateYear(year, yearOptions) {
        return yearOptions.includes(year) ? year : yearOptions[0];
    }

    function currentQuestionRecord() {
        return MASData.getQuestions().find((q) => q.key === state.question);
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
        // Build the label and wrapper once; later calls re-render only the picker.
        let pickerEl = document.getElementById("demo-question-picker");
        if (!pickerEl) {
            container.innerHTML = `
                <label class="field-label" for="demo-question-btn">Choose a question from the MAS 2026 Survey<span class="help-icon" tabindex="0">?<span class="help-icon__tooltip">Select a question to display, (No Trend) questions do not have year-over-year trend data whereas (Trend Available) questions do if you scroll down</span></span></label>
                <div id="demo-question-picker" class="qpicker"></div>`;
            pickerEl = document.getElementById("demo-question-picker");
        }
        MASQuestionPicker.render(pickerEl, questions, state.question, onQuestionChange, "demo-question-btn");
    }

    function onQuestionChange(newKey) {
        state.question = newKey;
        SharedState.setSharedQuestion(newKey);
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

    /** Demographic selector: a dropdown in the controls row on desktop, a row
     * of pill buttons on mobile. Both exist in the HTML; one is hidden. */
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
            // .onchange so each render replaces the previous handler.
            select.onchange = () => onDemographicChange(select.value);
        }
    }

    function onDemographicChange(newDemo) {
        state.demographic = newDemo;
        SharedState.setSavedDemographic(newDemo);
        renderDemographicSelector();
        renderCrosstabSection();
    }

    /** Stacked / Small Multiples toggle (desktop only). Both views use the
     * same data and selection, so switching keeps the selected group. */
    function renderChartViewToggle() {
        const container = document.getElementById("chart-view-toggle");
        if (state.isMobile) {
            container.innerHTML = "";
            return;
        }
        // Built once, then only updated, so the thumb element persists and
        // its CSS transition can slide rather than snap.
        if (!container.querySelector(".chart-view-toggle__thumb")) {
            container.innerHTML = `
                <span class="chart-view-toggle__thumb"></span>
                <button type="button" data-view="stacked">Stacked</button>
                <button type="button" data-view="small-multiples">Small Multiples</button>`;
            // Clicking anywhere on the track toggles the view.
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

    /** Flips the chart view: moves the toggle immediately, then fades the
     * chart out, rebuilds it, and fades it back in (see the
     * .chart-transition-* rules in style.css). */
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
            void el.offsetWidth; // force a layout so the "enter" state paints before it's removed
            requestAnimationFrame(() => el.classList.remove("chart-transition-enter"));
        }, 180);
    }

    /** Shows a "Download CSV" button wired to the current data, or hides it
     * when buildExport() returns null. Uses .onclick so each render replaces
     * the previous handler instead of adding another. */
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

    /** Shows a "Download Image" button for a Plotly chart, or hides it when
     * chartElementId is null (no data, or a mobile view with no Plotly chart). */
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

        // Rebuilding the charts can make the page jump toward the top on
        // desktop. Restore the scroll position after rendering and again on
        // the next frame. Skipped on mobile, which scrolls to the top on
        // purpose when a new question is picked.
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
            // Distinguish "no data for this question/year" from "no data for
            // this demographic".
            const hasAnyData = MASData.getTopline(q.key, state.year) != null;
            chartContainer.innerHTML = hasAnyData
                ? `<div class="warning-box">${escapeHtml(state.demographic)} data not available for this question.</div>`
                : `<div class="info-box">No data available for the selected filters.</div>`;
            wireImageButton("crosstab-download-img-btn", null);
            restoreScroll();
            requestAnimationFrame(restoreScroll);
            return;
        }

        // Optional per-demographic sentence from demo_notes in demographics.yaml,
        // added to the end of the standard note.
        const demoNote = MASData.getDemographics().find((d) => d.name === state.demographic).note;
        const noteText = demoNote ? `${CROSSTAB_NOTE} ${escapeHtml(demoNote)}` : CROSSTAB_NOTE;
        captionEl.style.display = "";
        captionEl.innerHTML =
            !state.isMobile && state.chartView === "stacked"
                ? `${noteText}<br>${LEGEND_HINT}`
                : noteText;

        // Groups without a trend series (e.g. ones listed under
        // excluded_historical in demographics.yaml) can't be selected; a saved
        // selection of one is treated as no selection.
        const hasTrendFor = (rawValue) => {
            const hist = q.has_trend ? MASData.getHistorical(q.key, state.demographic, rawValue) : null;
            return !!(hist && Object.keys(hist.by_year).length);
        };
        const savedValue = SharedState.getSelectedDemoValue(demoColumn);
        const selectedValue = savedValue != null && hasTrendFor(savedValue) ? savedValue : null;

        if (state.isMobile) {
            // The card list shows its own heading, so the page heading stays blank.
            MASMobileViews.renderDemographicCardList(chartContainer, crosstab, state.demographic, {
                selectedValue,
                showTrendButton: q.has_trend,
                hasTrendFor,
                onSelectionChange: (rawValueOrNull) => {
                    SharedState.setSelectedDemoValue(demoColumn, rawValueOrNull);
                    renderCrosstabSection();
                },
                renderTrendForSelected: (trendContainerEl, rawValue) => {
                    renderHistoricalChartInto(trendContainerEl, q, rawValue, true);
                },
            });
            wireImageButton("crosstab-download-img-btn", null); // no Plotly chart on mobile
        } else {
            // "Response by X Demographic (Year)"
            headingEl.textContent = crosstab.subtitle;
            const onSelect = (rawValue) => {
                if (!hasTrendFor(rawValue)) return; // no trend chart for this group: ignore the click
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
            renderDesktopHistoricalSection(q, selectedValue, crosstab.groups.filter((g) => !hasTrendFor(g.group_raw)));
        }

        restoreScroll();
        requestAnimationFrame(restoreScroll);
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** Below the desktop chart, shows one of: the selected group's trend
     * chart, a "click a bar" tip (nothing selected), or a "no historical
     * data" message. Shows or hides the whole "Year-over-Year Trends" card. */
    function renderDesktopHistoricalSection(q, selectedValue, groupsWithoutTrend) {
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
            // No series for this group: fall through to the "no data" message.
        }

        if (q.has_trend && selectedValue == null) {
            card.style.display = "none";
            const noTrendNote = groupsWithoutTrend.length
                ? ` (historical trends aren't available for ${escapeHtml(groupsWithoutTrend.map((g) => g.group_display).join(", "))})`
                : "";
            tipContainer.innerHTML = `<div class="tip-box">💡 <strong>Tip:</strong> <em>Click on any bar in the chart above and Scroll Down to see historical trends for that demographic group which will pop up in a lower chart${noTrendNote}</em></div>`;
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
        // Desktop title, e.g. "Cobb County (Jurisdiction)"; the card heading
        // above already says "Year-over-Year Trends".
        const chartTitle = isMobileCard
            ? `Historic ${rawValue} Response`
            : `${rawValue} (${toTitleCase(state.demographic)})`;
        const historicalNote = `Note: The Historic Response Trends chart shows trends ${q.trend_start_year ? `from ${q.trend_start_year} onward` : "across ALL survey years"}, regardless of the year filter above.`;
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
            const questionKeys = MASData.getQuestions().map((q) => q.key);
            state.question = SharedState.getSharedQuestion(questionKeys);
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
