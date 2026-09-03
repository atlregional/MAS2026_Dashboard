/**
 * scrollIndicator.js -- makes the decorative down-arrow button in the
 * bottom-right corner (present on every page) actually do something: a
 * click scrolls the page down by about one screen, then the button fades
 * out and removes itself. Loaded on every page since the button appears
 * on every page, including faq.html, which otherwise loads no JS at all.
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
