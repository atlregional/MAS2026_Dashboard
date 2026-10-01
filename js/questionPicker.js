/**
 * questionPicker.js -- custom question dropdown for desktop. A native
 * <select> can't style parts of an option, so this builds its own list to
 * show a colored category badge, the question, and a trend label.
 *
 * Every row, including the closed button, uses the same 3-column grid
 * (category | question | trend) so the columns line up. The mobile picker
 * is in mobileViews.js.
 */

const MASQuestionPicker = (() => {
    // Badge emoji and colors per question category. Each text color meets
    // WCAG 4.5:1 contrast against its background. Categories not listed
    // here use FALLBACK_CATEGORY_STYLE.
    const CATEGORY_STYLES = {
        BIGPROBLEM: { emoji: "🎯", color: "#B91C1C", bg: "#FEE2E2" },
        AI: { emoji: "🤖", color: "#6D28D9", bg: "#EDE9FE" },
        ECONOMY: { emoji: "💰", color: "#b25209", bg: "#FEF3C7" },
        "ECONOMIC MOBILITY": { emoji: "📈", color: "#047857", bg: "#D1FAE5" },
        ENVIRONMENT: { emoji: "🌎", color: "#157f3d", bg: "#DCFCE7" },
        HOUSING: { emoji: "🏠", color: "#c0400c", bg: "#FFEDD5" },
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

    /** Row content (category | question | trend) for the button and each option. */
    function rowHTML(q) {
        const style = CATEGORY_STYLES[q.category] || FALLBACK_CATEGORY_STYLE;
        const trendClass = q.has_trend ? "qpicker-trend--available" : "qpicker-trend--none";
        const trendText = q.has_trend ? "Trend Available" : "No Trend";
        return `
            <span class="qpicker-category" style="color:${style.color};background:${style.bg}">${style.emoji} ${escapeHtml(q.category)}</span>
            <span class="qpicker-question">${escapeHtml(q.text)}</span>
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

    /** Attaches event listeners to the container once. render() rebuilds the
     * inner DOM on every selection, so listeners are delegated from the
     * container and read the current callback from container._qpOnSelect. */
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
                container._qpOnSelect(optBtn.dataset.key);
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
     * @param {string} currentKey -- q.key of the selected question
     * @param {(key:string)=>void} onSelect
     * @param {string} buttonId -- id put on the button, so a <label for>
     *        elsewhere on the page can target it
     */
    function render(container, questions, currentKey, onSelect, buttonId) {
        container._qpOnSelect = onSelect;
        const current = questions.find((q) => q.key === currentKey) || questions[0];

        container.innerHTML = `
            <button type="button" id="${buttonId}" class="qpicker__button" aria-haspopup="listbox" aria-expanded="false">
                <span class="qpicker__button-row">${rowHTML(current)}</span>
                <span class="qpicker__chevron">&#9660;</span>
            </button>
            <div class="qpicker__panel" role="listbox" hidden>
                ${questions
                    .map((q) => {
                        const selected = q.key === currentKey;
                        return `<button type="button" class="qpicker__option${selected ? " selected" : ""}" role="option" aria-selected="${selected}" data-key="${escapeHtml(q.key)}">${rowHTML(q)}</button>`;
                    })
                    .join("")}
            </div>`;

        bindOnce(container);
    }

    return {
        render,
        // Shared with the mobile question picker in mobileViews.js.
        categoryStyle: (category) => CATEGORY_STYLES[category] || FALLBACK_CATEGORY_STYLE,
    };
})();
