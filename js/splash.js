/**
 * splash.js -- tiny controller for the splash page (index.html). The page
 * is otherwise static HTML (the intro blurb moved here from what's now
 * metro_summary.html); the only dynamic bit is appending a "best viewed
 * on desktop" note to the end of the blurb for mobile visitors, read
 * right into the copy itself rather than interrupting with a popup.
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
