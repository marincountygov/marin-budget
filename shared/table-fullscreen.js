// Fullscreen for a table: a button with data-fullscreen-target opens what it names (the buttons above the table and the table together, so the
// actions are still there) at the size of the screen, as the slides of Marin Learn open. The same icon (Lucide maximize), which becomes minimize
// while open. The browser's own fullscreen is used where there is one; otherwise the element is fixed over the page. Escape closes it either way.
(() => {
  const MAXIMIZE = '<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const MINIMIZE = '<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
  let open = null; // the element that is open
  let opener = null; // the button that opened it: focus goes back to it
  // What a screen reader hears when it opens and closes; the page shows nothing for it.
  const live = Object.assign(document.createElement("div"), { className: "visually-hidden" });
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.addEventListener("DOMContentLoaded", () => document.body.append(live));
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
  const nameOf = (element) => {
    const caption = element.querySelector("caption");
    const heading = document.querySelector("main h1, main .doc-title");
    return `Fullscreen: ${(caption && caption.textContent.trim()) || (heading && heading.textContent.trim()) || document.title}`;
  };

  const targetOf = (button) => {
    const selector = button.dataset.fullscreenTarget;
    return (selector && (button.closest(selector) || document.querySelector(selector))) || null;
  };
  const sync = () => {
    document.querySelectorAll("[data-fullscreen-target]").forEach((button) => {
      const on = open !== null && targetOf(button) === open;
      button.innerHTML = on ? MINIMIZE : MAXIMIZE;
      button.setAttribute("aria-label", on ? "Exit fullscreen" : "Fullscreen");
      button.title = on ? "Exit fullscreen" : "Fullscreen";
    });
  };
  const close = () => {
    if (!open) return;
    if (document.fullscreenElement === open && document.exitFullscreen) document.exitFullscreen();
    open.classList.remove("is-expanded");
    ["role", "aria-modal", "aria-label", "tabindex"].forEach((name) => open.removeAttribute(name));
    document.documentElement.classList.remove("has-expanded");
    const back = opener;
    open = null;
    opener = null;
    sync();
    live.textContent = "Exited fullscreen.";
    if (back && back.isConnected) back.focus(); // where the person was
  };
  const openIt = (element, button) => {
    if (open) close();
    open = element;
    opener = button;
    element.setAttribute("role", "dialog"); // a region the page is not behind: keyboard focus stays in it
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", nameOf(element));
    element.setAttribute("tabindex", "-1");
    element.classList.add("is-expanded"); // the same look with or without the browser's fullscreen
    document.documentElement.classList.add("has-expanded");
    if (element.requestFullscreen) element.requestFullscreen().catch(() => {}); // refused: it stays fixed over the page
    sync();
    live.textContent = "Fullscreen. Press Escape to exit.";
    button.focus(); // the button that closes it, inside it, is where focus is
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-fullscreen-target]");
    if (!button) return;
    const element = targetOf(button);
    if (!element) return;
    if (open === element) close(); else openIt(element, button);
  });
  // The browser closed it (Escape in its own fullscreen): the page follows. Escape is also handled here, for where it is only fixed over the page.
  document.addEventListener("fullscreenchange", () => { if (open && document.fullscreenElement !== open) close(); });
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") { close(); return; }
    if (event.key !== "Tab") return;
    // Tab goes round inside what is open, never out to the page behind it.
    const items = focusables(open);
    if (!items.length) return;
    const first = items[0];
    const lastItem = items[items.length - 1];
    if (!open.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem.focus(); }
    else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first.focus(); }
  });
})();
