/**
 * state.js -- selections shared across pages, stored in sessionStorage so
 * they last for one browser tab and reset on the next visit.
 *
 *   - question / year: kept in sync between Metro Summary and Demographic
 *     Breakdown.
 *   - isMobile: layout mode, detected once per tab from the viewport width.
 *   - savedDemographic: last demographic type chosen on Demographic Breakdown.
 *   - selected demo value: the clicked demographic group, stored per
 *     demographic column, so it survives a question change but resets when
 *     the demographic type changes. Shared by desktop and mobile views.
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

    function setSharedQuestion(questionKey) {
        _set(KEYS.question, questionKey);
    }

    function getSharedYear(validOptions) {
        const val = _get(KEYS.year, null);
        if (val !== null && validOptions.includes(val)) return val;
        return validOptions[0];
    }

    function setSharedYear(yearValue) {
        _set(KEYS.year, yearValue);
    }

    /** Detected from the viewport width on first call, then fixed for the tab. */
    function getIsMobile() {
        const val = _get(KEYS.isMobile, null);
        if (val !== null) return val;
        const detected = window.matchMedia("(max-width: 768px)").matches;
        _set(KEYS.isMobile, detected);
        return detected;
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
        getSavedDemographic,
        setSavedDemographic,
        getSelectedDemoValue,
        setSelectedDemoValue,
    };
})();
