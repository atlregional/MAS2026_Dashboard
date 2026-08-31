/**
 * main.js -- small shared bootstrap used by every page: the mobile/
 * desktop display toggle (mirrors lib.session_state.init_mobile_toggle(),
 * minus the User-Agent-based first-guess -- see state.js's docstring for
 * why a real matchMedia check is a strict improvement here). Nav-link
 * active-state and the footer are plain static HTML per page (there's
 * exactly 3 pages and no router, so there's nothing to compute).
 */

const MASMain = (() => {
    /**
     * Wires a checkbox to SharedState's is_mobile flag and calls
     * onChange(isMobile) both immediately (with the seeded/stored value)
     * and on every toggle.
     * @param {HTMLInputElement} checkboxEl
     * @param {(isMobile:boolean)=>void} onChange
     * @returns {boolean} the initial value
     */
    function initMobileToggle(checkboxEl, onChange) {
        const initial = SharedState.getIsMobile();
        checkboxEl.checked = initial;
        checkboxEl.addEventListener("change", () => {
            SharedState.setIsMobile(checkboxEl.checked);
            onChange(checkboxEl.checked);
        });
        return initial;
    }

    return { initMobileToggle };
})();
