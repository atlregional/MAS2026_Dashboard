/**
 * state.js -- cross-page shared state, backed by sessionStorage. This is
 * the static-site equivalent of the server app's st.session_state (which
 * is shared across every page for the lifetime of one Streamlit session):
 * sessionStorage is scoped to one browser tab and cleared when the tab
 * closes, the closest available match to "one session" without a server.
 * localStorage was deliberately NOT used -- it would persist a visitor's
 * selections indefinitely across separate visits, which the server app
 * never did either.
 *
 * Mirrors lib.session_state.py's helpers:
 *   - shared_question_text / shared_year_text -> keeps the question/year
 *     selection in sync when switching between Metro Summary and
 *     Demographic Breakdown via the Topline/Detailed pill.
 *   - is_mobile -> the mobile/desktop layout toggle, seeded once per
 *     session from a real viewport check (window.matchMedia), a more
 *     direct signal than the server app's User-Agent sniffing ever was.
 *   - saved_demographic -> last-selected demographic type on Demographic
 *     Breakdown.
 *   - mobile_selected_demo_value__{demo_col_raw} -> the selected/clicked
 *     demographic group, scoped by demographic *column* (not by question),
 *     matching the original: a selection carries over across a question
 *     change (still the same demographic type) but resets when the
 *     demographic type itself changes. Used for both desktop's
 *     click-to-drill highlight and mobile's card selection -- one
 *     mechanism serving both, same as the server app.
 */

const SharedState = (() => {
    const KEYS = {
        question: "mas_shared_question",
        year: "mas_shared_year",
        isMobile: "mas_is_mobile",
        savedDemographic: "mas_saved_demographic",
    };

    function _get(key, fallback) {
        const raw = sessionStorage.getItem(key);
        if (raw === null) return fallback;
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function _set(key, value) {
        sessionStorage.setItem(key, JSON.stringify(value));
    }

    function getSharedQuestion(validOptions) {
        const val = _get(KEYS.question, null);
        if (val !== null && validOptions.includes(val)) return val;
        return validOptions[0];
    }

    function setSharedQuestion(displayValue) {
        _set(KEYS.question, displayValue);
    }

    function getSharedYear(validOptions) {
        const val = _get(KEYS.year, null);
        if (val !== null && validOptions.includes(val)) return val;
        return validOptions[0];
    }

    function setSharedYear(yearValue) {
        _set(KEYS.year, yearValue);
    }

    /** Seeded once per session from the real viewport width; the checkbox
     * (or any later resize) can override it in either direction from then
     * on, exactly like the server app's checkbox-overrides-detection
     * contract. */
    function getIsMobile() {
        const val = _get(KEYS.isMobile, null);
        if (val !== null) return val;
        const detected = window.matchMedia("(max-width: 768px)").matches;
        _set(KEYS.isMobile, detected);
        return detected;
    }

    function setIsMobile(value) {
        _set(KEYS.isMobile, value);
    }

    function getSavedDemographic(defaultValue) {
        return _get(KEYS.savedDemographic, defaultValue);
    }

    function setSavedDemographic(value) {
        _set(KEYS.savedDemographic, value);
    }

    function _selectedDemoKey(demoColumn) {
        return `mas_selected_demo_value__${demoColumn}`;
    }

    function getSelectedDemoValue(demoColumn) {
        return _get(_selectedDemoKey(demoColumn), null);
    }

    function setSelectedDemoValue(demoColumn, rawValue) {
        _set(_selectedDemoKey(demoColumn), rawValue);
    }

    return {
        getSharedQuestion,
        setSharedQuestion,
        getSharedYear,
        setSharedYear,
        getIsMobile,
        setIsMobile,
        getSavedDemographic,
        setSavedDemographic,
        getSelectedDemoValue,
        setSelectedDemoValue,
    };
})();
