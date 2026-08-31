/**
 * data.js -- loads data/dashboard_data.json (built by
 * scripts/build_static_data.py) and exposes lookup helpers. Mirrors
 * lib.aggregation's get_*_grouped()/lib.chart_config's resolve_*()
 * functions from the server app, except there's no computation left to
 * do here -- every view was already resolved at build time, so these are
 * pure dictionary lookups.
 *
 * Percent values throughout are 0-1 floats (same convention as
 * resolve_chart_config's "percent" column) -- multiply by 100 for display.
 */

const MASData = (() => {
    let _data = null;
    let _loadPromise = null;

    function load() {
        if (_loadPromise) return _loadPromise;
        _loadPromise = fetch("data/dashboard_data.json")
            .then((resp) => {
                if (!resp.ok) throw new Error(`Failed to load dashboard_data.json: HTTP ${resp.status}`);
                return resp.json();
            })
            .then((json) => {
                _data = json;
                return _data;
            });
        return _loadPromise;
    }

    function _ensureLoaded() {
        if (!_data) throw new Error("MASData not loaded yet -- call MASData.load() and await it first.");
    }

    /** Question display order: BIGPROBLEM first, then alphabetical -- same
     * order build_static_data.py already computed and stored. */
    function getQuestions() {
        _ensureLoaded();
        return _data.questions;
    }

    function getQuestionByKey(questionKey) {
        _ensureLoaded();
        return _data.questions.find((q) => q.key === questionKey) || null;
    }

    /** [{name, column}, ...] in config/demographics.yaml's demo_col_map order. */
    function getDemographics() {
        _ensureLoaded();
        return _data.demographics;
    }

    function getCurrentSurveyYear() {
        _ensureLoaded();
        return _data.current_survey_year;
    }

    /** {sort_order, colors, percents} for (question, year)'s topline
     * response distribution, or null if not available. */
    function getTopline(questionKey, year) {
        _ensureLoaded();
        return _data.topline[`${questionKey}|${year}`] || null;
    }

    /** {sort_order, colors, end_date, by_year} for question's metro-wide
     * year-over-year trend, or null if the question has no trend data. */
    function getMetroTrend(questionKey) {
        _ensureLoaded();
        return _data.metro_trend[questionKey] || null;
    }

    /** {question_title, subtitle, response_sort_order, colors,
     * has_custom_order, groups: [{group_raw, group_display, percents}]}
     * for (question, year, demographicName)'s crosstab, or null. */
    function getCrosstab(questionKey, year, demographicName) {
        _ensureLoaded();
        return _data.crosstab[`${questionKey}|${year}|${demographicName}`] || null;
    }

    /** {sort_order, colors, end_date, by_year} for the historical trend of
     * one demographic group's raw value (e.g. "Cherokee"), or null. */
    function getHistorical(questionKey, demographicName, demoRawValue) {
        _ensureLoaded();
        return _data.historical[`${questionKey}|${demographicName}|${demoRawValue}`] || null;
    }

    return {
        load,
        getQuestions,
        getQuestionByKey,
        getDemographics,
        getCurrentSurveyYear,
        getTopline,
        getMetroTrend,
        getCrosstab,
        getHistorical,
    };
})();
