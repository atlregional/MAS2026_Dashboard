/**
 * scrollIndicator.js -- the down-arrow button in the bottom-right corner of
 * every page. Clicking it scrolls down about one screen, then the button
 * fades out and removes itself.
 */
(function () {
    function init() {
        const btn = document.querySelector(".scroll-indicator");
        if (!btn) return;
        btn.addEventListener("click", () => {
            window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
            btn.classList.add("is-hiding");
            btn.addEventListener("transitionend", () => btn.remove(), { once: true });
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
