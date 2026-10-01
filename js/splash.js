/**
 * splash.js -- splash page (index.html). Appends a "best viewed on desktop"
 * note to the intro text for mobile visitors.
 */
(function () {
    function init() {
        if (!SharedState.getIsMobile()) return;
        const note = document.getElementById("splash-mobile-note");
        if (!note) return;
        note.textContent =
            " This dashboard is best viewed on a desktop computer -- we've " +
            "switched you to a mobile-friendly view of the charts, but for " +
            "the full experience, try visiting on a larger screen.";
    }

    document.addEventListener("DOMContentLoaded", init);
})();
