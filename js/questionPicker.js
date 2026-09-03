/**
 * questionPicker.js -- a custom (non-native) dropdown for choosing a
 * question on desktop, replacing the native <select> that used to render
 * each question as one flat string ("BIGPROBLEM| What is the biggest
 * problem in metro Atlanta today? (No Trend)"). A native <select>'s
 * <option> elements cannot have per-substring styling -- no color, no
 * italics, nothing -- in any browser, so getting a colored category
 * badge, a styled trend label, and column alignment across every row
 * requires building the list ourselves instead. The mobile question
 * picker is unaffected -- see mobileViews.js's own, simpler
 * <details>-based list.
 *
 * Every row (including the closed button showing the current selection)
 * shares one 3-column CSS grid (category badge | question | trend label)
 * so all three start at the same x position on every option, not just
 * within the open list but in the closed button too.
 */

const MASQuestionPicker = (() => {
    // Hand-picked emoji + color per question category (config/questions
    // isn't categorized in the data file beyond the "CATEGORY| question"
    // prefix baked into q.short, so this mapping lives here rather than
    // being computed). FALLBACK_CATEGORY_STYLE covers any category added
    // later that isn't in this list yet.
    const CATEGORY_STYLES = {
        BIGPROBLEM: { emoji: "🎯", color: "#B91C1C", bg: "#FEE2E2" },
        AI: { emoji: "🤖", color: "#6D28D9", bg: "#EDE9FE" },
        ECONOMY: { emoji: "💰", color: "#B45309", bg: "#FEF3C7" },
        ENVIRONMENT: { emoji: "🌎", color: "#15803D", bg: "#DCFCE7" },
        HOUSING: { emoji: "🏠", color: "#C2410C", bg: "#FFEDD5" },
        "QUALITY OF LIFE": { emoji: "⭐", color: "#0369A1", bg: "#E0F2FE" },
        TRANSPORTATION: { emoji: "🚗", color: "#1D4ED8", bg: "#DBEAFE" },
        WORKFORCE: { emoji: "💼", color: "#0F766E", bg: "#CCFBF1" },
    };
    const FALLBACK_CATEGORY_STYLE = { emoji: "📋", color: "#4B5563", bg: "#F3F4F6" };

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    /** q.short is "CATEGORY| question text" (no trend label) -- split on
     * the first "|" rather than trusting a fixed offset. */
    function splitShort(short) {
        const idx = short.indexOf("|");
        if (idx === -1) return { category: "", question: short.trim() };
        return { category: short.slice(0, idx).trim(), question: short.slice(idx + 1).trim() };
    }

    /** The 3-column row content shared by the closed button and every
     * option in the open panel. */
    function rowHTML(q) {
        const { category, question } = splitShort(q.short);
        const style = CATEGORY_STYLES[category] || FALLBACK_CATEGORY_STYLE;
        const trendClass = q.has_trend ? "qpicker-trend--available" : "qpicker-trend--none";
        const trendText = q.has_trend ? "Trend Available" : "No Trend";
        return `
            <span class="qpicker-category" style="color:${style.color};background:${style.bg}">${style.emoji} ${escapeHtml(category)}</span>
            <span class="qpicker-question">${escapeHtml(question)}</span>
            <span class="qpicker-trend ${trendClass}">${trendText}</span>`;
    }

    function openPanel(container) {
        const btn = container.querySelector(".qpicker__button");
        const panel = container.querySelector(".qpicker__panel");
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        const target = panel.querySelector(".qpicker__option.selected") || panel.querySelector(".qpicker__option");
        if (target) target.focus();
    }

    function closePanel(container, { refocusButton = false } = {}) {
        const btn = container.querySelector(".qpicker__button");
        const panel = container.querySelector(".qpicker__panel");
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        btn.setAttribute("aria-expanded", "false");
        if (refocusButton) btn.focus();
    }

    /** Delegated listeners attached once per container (guarded by a
     * dataset flag) -- render() is called again on every selection change
     * and rebuilds the button/panel DOM each time, so listeners attached
     * directly to those elements would need re-binding (and re-removing)
     * on every render. Delegating from the persistent container, and
     * reading the latest onSelect callback off container._qpOnSelect
     * (refreshed every render), avoids that entirely. */
    function bindOnce(container) {
        if (container.dataset.qpickerBound) return;
        container.dataset.qpickerBound = "1";

        container.addEventListener("click", (e) => {
            if (e.target.closest(".qpicker__button")) {
                const panel = container.querySelector(".qpicker__panel");
                if (panel.hidden) openPanel(container);
                else closePanel(container);
                return;
            }
            const optBtn = e.target.closest(".qpicker__option");
            if (optBtn) {
                closePanel(container, { refocusButton: true });
                container._qpOnSelect(optBtn.dataset.display);
            }
        });

        container.addEventListener("keydown", (e) => {
            const panel = container.querySelector(".qpicker__panel");
            if (panel.hidden) return;
            const options = Array.from(panel.querySelectorAll(".qpicker__option"));
            const idx = options.indexOf(document.activeElement);
            if (e.key === "ArrowDown") {
                e.preventDefault();
                (options[idx + 1] || options[options.length - 1])?.focus();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                (options[idx - 1] || options[0])?.focus();
            } else if (e.key === "Escape") {
                e.preventDefault();
                closePanel(container, { refocusButton: true });
            }
        });

        document.addEventListener("click", (e) => {
            if (!container.contains(e.target)) closePanel(container);
        });
    }

    /**
     * @param {HTMLElement} container
     * @param {Array} questions -- MASData.getQuestions() records
     * @param {string} currentDisplay -- q.display of the selected question
     * @param {(display:string)=>void} onSelect
     * @param {string} buttonId -- id put on the button, so a <label for>
     *        elsewhere on the page can target it
     */
    function render(container, questions, currentDisplay, onSelect, buttonId) {
        container._qpOnSelect = onSelect;
        const current = questions.find((q) => q.display === currentDisplay) || questions[0];

        container.innerHTML = `
            <button type="button" id="${buttonId}" class="qpicker__button" aria-haspopup="listbox" aria-expanded="false">
                <span class="qpicker__button-row">${rowHTML(current)}</span>
                <span class="qpicker__chevron">&#9660;</span>
            </button>
            <div class="qpicker__panel" role="listbox" hidden>
                ${questions
                    .map((q) => {
                        const selected = q.display === currentDisplay;
                        return `<button type="button" class="qpicker__option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" data-display="${escapeHtml(q.display)}">${rowHTML(q)}</button>`;
                    })
                    .join("")}
            </div>`;

        bindOnce(container);
    }

    return {
        render,
        // Exposed so mobileViews.js's question picker can reuse the same
        // category badge colors/emoji and category/question split instead
        // of duplicating that map -- it renders the pieces stacked
        // (one per line) rather than in this file's 3-column grid, since
        // fixed-width columns don't fit a phone-width screen.
        splitShort,
        categoryStyle: (category) => CATEGORY_STYLES[category] || FALLBACK_CATEGORY_STYLE,
    };
})();
