/**
 * mobileViews.js -- mobile-specific rendering: label-above-bar lists
 * instead of bar charts, and a tap-to-select demographic card list.
 * Mirrors MAS_Dashboard_App/lib/mobile_views.py's design (see that
 * module's docstring for *why* mobile doesn't just use a rotated bar
 * chart) -- ported as real DOM/CSS instead of st.markdown(unsafe_allow_
 * html=True) strings.
 *
 * Notably simpler here than the Python version in one respect: the
 * Income demographic's "$25k-$60k"-style labels needed a manual
 * `_escape_dollar()` workaround in the server app because Streamlit's
 * markdown renderer mistook "$...$" pairs for LaTeX math delimiters. That
 * whole bug class cannot exist in this build -- there's no markdown
 * parser in the loop at all, just plain HTML text nodes built with
 * escapeHtml() below, so a literal "$" is never special.
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

    /** Mobile equivalent of MASCharts.buildToplineBarChart -- returns an
     * HTML string (caller sets it via innerHTML). */
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
     * Mobile equivalent of MASCharts.buildDemographicStackedBarChart: one
     * card per demographic group, with a disclosure-toggle button that
     * selects the group for the historical-trend section. Renders
     * directly into `container` and wires up click handlers.
     *
     * @param {HTMLElement} container
     * @param {{question_title, subtitle, response_sort_order, colors, groups, has_custom_order}} crosstab
     * @param {string} demographicLabel
     * @param {Object} opts
     * @param {string|null} opts.selectedValue -- currently-selected group_raw, or null
     * @param {boolean} opts.showTrendButton -- false when the question has no trend data at all
     * @param {(rawValue:string|null)=>void} opts.onSelectionChange -- called with the new selection
     *        (or null if the click deselected) immediately when a button is tapped, BEFORE
     *        the trend callback -- lets the caller persist state and re-render
     * @param {(containerEl:HTMLElement, rawValue:string)=>void} [opts.renderTrendForSelected] --
     *        called with a freshly-created container element right after the selected card,
     *        mirroring render_demographic_card_list's render_trend_for_selected parameter
     */
    function renderDemographicCardList(container, crosstab, demographicLabel, opts) {
        const { response_sort_order: responseSortOrder, colors, groups, question_title: questionTitle, subtitle, has_custom_order: hasCustomOrder } = crosstab;
        const { selectedValue, showTrendButton, onSelectionChange, renderTrendForSelected } = opts;
        const sortWithinGroupByPercent = !hasCustomOrder;

        // See charts.js's buildDemographicStackedBarChart for why this is
        // the array order as-is, not re-sorted: build_static_data.py
        // already wrote crosstab.groups out in the correct display order.
        const orderedGroups = groups.map((g) => g.group_display);

        container.innerHTML = "";

        const heading = document.createElement("div");
        heading.className = "demo-card-heading";
        heading.textContent = questionTitle;
        container.appendChild(heading);

        const sub = document.createElement("div");
        sub.className = "demo-card-subtitle";
        sub.textContent = subtitle;
        container.appendChild(sub);

        for (const groupDisplay of orderedGroups) {
            const group = groups.find((g) => g.group_display === groupDisplay);
            if (!group) continue;
            const isSelected = showTrendButton && selectedValue === group.group_raw;

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

            if (showTrendButton) {
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

    /**
     * Mobile equivalent of the native <select> question picker: a
     * collapsed-by-default <details> holding one full-width button per
     * question. Ported straight from render_question_picker (see its
     * docstring in lib/mobile_views.py for why Streamlit's native
     * dropdown couldn't be used on mobile at all) -- here it's simply the
     * more direct implementation, since a native <button> already wraps
     * long text with no virtualization to work around.
     *
     * @param {HTMLElement} container
     * @param {string[]} displayOptions
     * @param {string} current
     * @param {(option:string)=>void} onSelect
     */
    function renderQuestionPicker(container, displayOptions, current, onSelect) {
        container.innerHTML = "";
        const details = document.createElement("details");
        details.className = "mobile-qpicker";

        const summary = document.createElement("summary");
        summary.className = "mobile-qpicker__summary";
        summary.textContent = `📋 ${current}`;
        details.appendChild(summary);

        const body = document.createElement("div");
        body.className = "mobile-qpicker__body";
        body.innerHTML = `<div class="mobile-qpicker__caption">Tap a question below to select it.</div>`;

        displayOptions.forEach((option) => {
            const isCurrent = option === current;
            const btn = document.createElement("button");
            btn.className = "mobile-qpicker__option";
            btn.type = "button";
            btn.textContent = isCurrent ? `✓ ${option}` : option;
            btn.disabled = isCurrent;
            btn.addEventListener("click", () => onSelect(option));
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
