/**
 * mobileViews.js -- phone layouts built from HTML/CSS instead of Plotly:
 * label-above-bar lists for response distributions, one card per
 * demographic group, and the mobile question picker. Long response labels
 * stay readable at phone width this way, where a Plotly bar chart would
 * squeeze them.
 */

const MASMobileViews = (() => {
    const FALLBACK_BAR_COLOR = "#999999";

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    function barRowHTML(label, percent, color) {
        const pctDisplay = `${Math.round(percent * 100)}%`;
        const fillWidth = Math.max(0, Math.min(100, percent * 100));
        return `
        <div class="bar-row">
            <div class="bar-row__label">${escapeHtml(label)}</div>
            <div class="bar-row__track-wrap">
                <div class="bar-row__track">
                    <div class="bar-row__fill" style="width:${fillWidth.toFixed(2)}%; background:${color};"></div>
                </div>
                <div class="bar-row__pct">${pctDisplay}</div>
            </div>
        </div>`;
    }

    /** Mobile version of the topline bar chart. Returns an HTML string. */
    function responseBarListHTML(sortOrder, colors, percents, questionTitle) {
        const rows = sortOrder
            .filter((r) => percents[r] !== undefined)
            .map((r) => barRowHTML(r, percents[r], colors[r] || FALLBACK_BAR_COLOR))
            .join("");
        return `
        <div class="mobile-topline-title">${escapeHtml(questionTitle)}</div>
        ${rows}`;
    }

    /**
     * Mobile version of the demographic stacked bar chart: one card per
     * demographic group, each with a button that shows or hides that group's
     * historical trend. Renders directly into `container`.
     *
     * @param {HTMLElement} container
     * @param {{question_title, subtitle, response_sort_order, colors, groups, has_custom_order}} crosstab
     * @param {string} demographicLabel
     * @param {Object} opts
     * @param {string|null} opts.selectedValue -- currently-selected group_raw, or null
     * @param {boolean} opts.showTrendButton -- false when the question has no trend data at all
     * @param {(rawValue:string)=>boolean} [opts.hasTrendFor] -- false for a group with no
     *        trend series, which then gets no trend button
     * @param {(rawValue:string|null)=>void} opts.onSelectionChange -- called with the new
     *        selection (null when deselecting) so the caller can save it and re-render
     * @param {(containerEl:HTMLElement, rawValue:string)=>void} [opts.renderTrendForSelected] --
     *        draws the selected group's trend into a container inside its card
     */
    function renderDemographicCardList(container, crosstab, demographicLabel, opts) {
        const { response_sort_order: responseSortOrder, colors, groups, question_title: questionTitle, subtitle, has_custom_order: hasCustomOrder } = crosstab;
        const { selectedValue, showTrendButton, hasTrendFor, onSelectionChange, renderTrendForSelected } = opts;
        const sortWithinGroupByPercent = !hasCustomOrder;

        // crosstab.groups is already in display order.
        const orderedGroups = groups.map((g) => g.group_display);

        container.innerHTML = "";

        // "Response by X Demographic (Year)" heading, then the survey question.
        const heading = document.createElement("div");
        heading.className = "demo-card-heading";
        heading.textContent = subtitle;
        container.appendChild(heading);

        const sub = document.createElement("div");
        sub.className = "demo-card-subtitle";
        sub.textContent = questionTitle;
        container.appendChild(sub);

        for (const groupDisplay of orderedGroups) {
            const group = groups.find((g) => g.group_display === groupDisplay);
            if (!group) continue;
            const groupHasTrend = showTrendButton && (!hasTrendFor || hasTrendFor(group.group_raw));
            const isSelected = groupHasTrend && selectedValue === group.group_raw;

            let responseOrder;
            if (sortWithinGroupByPercent) {
                responseOrder = Object.keys(group.percents).sort((a, b) => group.percents[b] - group.percents[a]);
            } else {
                responseOrder = responseSortOrder.filter((r) => group.percents[r] !== undefined);
            }
            const rowsHtml = responseOrder
                .map((r) => barRowHTML(r, group.percents[r], colors[r] || FALLBACK_BAR_COLOR))
                .join("");

            const card = document.createElement("div");
            card.className = "demo-card" + (isSelected ? " selected" : "");
            card.innerHTML = `
                <div class="demo-card__header">${escapeHtml(group.group_display)}</div>
                ${rowsHtml}`;
            container.appendChild(card);

            if (groupHasTrend) {
                const btn = document.createElement("button");
                btn.className = "demo-card__button";
                btn.type = "button";
                btn.textContent = isSelected
                    ? `▲ Hide Historic ${group.group_display} Response`
                    : `▼ View Historic ${group.group_display} Response`;
                btn.addEventListener("click", () => {
                    const newValue = isSelected ? null : group.group_raw;
                    onSelectionChange(newValue);
                });
                card.appendChild(btn);

                if (isSelected && renderTrendForSelected) {
                    const trendContainer = document.createElement("div");
                    card.appendChild(trendContainer);
                    renderTrendForSelected(trendContainer, group.group_raw);
                }
            }
        }
    }

    /** Category badge, question and trend label stacked vertically; used for
     * the collapsed summary and each option. */
    function stackedRowsHTML(q) {
        const style = MASQuestionPicker.categoryStyle(q.category);
        const trendClass = q.has_trend ? "qpicker-trend--available" : "qpicker-trend--none";
        const trendText = q.has_trend ? "Trend Available" : "No Trend";
        return `
            <span class="mobile-qpicker__option-rows">
                <span class="qpicker-category" style="color:${style.color};background:${style.bg}">${style.emoji} ${escapeHtml(q.category)}</span>
                <span class="qpicker-question">${escapeHtml(q.text)}</span>
                <span class="qpicker-trend ${trendClass}">${trendText}</span>
            </span>`;
    }

    /**
     * Mobile question picker: a collapsible <details> list with one
     * full-width button per question. Uses the same category badges as the
     * desktop picker (questionPicker.js), stacked to fit a phone screen.
     *
     * @param {HTMLElement} container
     * @param {Array} questions -- MASData.getQuestions() records
     * @param {string} currentKey -- q.key of the selected question
     * @param {(key:string)=>void} onSelect
     */
    function renderQuestionPicker(container, questions, currentKey, onSelect) {
        container.innerHTML = "";
        const details = document.createElement("details");
        details.className = "mobile-qpicker";

        const current = questions.find((q) => q.key === currentKey) || questions[0];
        const summary = document.createElement("summary");
        summary.className = "mobile-qpicker__summary";
        summary.innerHTML = stackedRowsHTML(current);
        details.appendChild(summary);

        const body = document.createElement("div");
        body.className = "mobile-qpicker__body";
        body.innerHTML = `<div class="mobile-qpicker__caption">Tap a question below to select it.</div>`;

        questions.forEach((q) => {
            const isCurrent = q.key === currentKey;
            const btn = document.createElement("button");
            btn.className = "mobile-qpicker__option";
            btn.type = "button";
            btn.disabled = isCurrent;
            btn.innerHTML = stackedRowsHTML(q);
            btn.addEventListener("click", () => {
                // Scroll to the top so the updated charts are in view.
                window.scrollTo(0, 0);
                onSelect(q.key);
            });
            body.appendChild(btn);
        });

        details.appendChild(body);
        container.appendChild(details);
    }

    return {
        escapeHtml,
        barRowHTML,
        responseBarListHTML,
        renderDemographicCardList,
        renderQuestionPicker,
    };
})();
