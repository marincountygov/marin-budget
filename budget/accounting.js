// The "Budget and spending" page: the departments as cards. A card is a name, its code in brackets, and the figures that are chosen; it links to the
// department's own page (budget/department.js), where what the department is made of is opened in an accordion. This script adds, to the shared tool
// (budget/tool.js):
//   - the choice of Names and codes (a card shows both, the name, or the code),
//   - a code that filters: a department's code selects that department,
//   - the choices of the Funds, Functions and Categories filters, named or coded as the choice says, without the ones no department in view has,
//   - the chosen measures, amounts and years carried into the link to a department's page.
(() => {
  const toolConfig = JSON.parse(document.getElementById("tool-config").textContent);
  const whenToolIsReady = () => (window.marinBudgetTool ? Promise.resolve() : new Promise((resolve) => document.addEventListener("marin-budget-tool-ready", resolve, { once: true })));

  whenToolIsReady().then(() => {
    const tool = window.marinBudgetTool;
    const column = tool.column;
    const mode = () => column.filterState.groups.labels || "both";

    // ---- names and codes ----
    const applyLabels = () => {
      document.querySelectorAll("[data-label-name]").forEach((el) => { el.textContent = mode() === "codes" ? el.dataset.labelCode : el.dataset.labelName; });
      document.querySelectorAll("[data-code-kind]").forEach((el) => { el.hidden = mode() !== "both"; });
    };

    // ---- a department's code selects it ----
    document.addEventListener("click", (event) => {
      const chip = event.target.closest('[data-code-kind="department"]');
      if (!chip) return;
      const card = document.querySelector(`#line-cards > li[data-ref="${chip.dataset.code}"]`);
      if (!card) return;
      event.preventDefault();
      column.setValue("department", [card.dataset.title]);
      tool.refilter();
    });

    // ---- the choices of the filters of codes ----
    const optionLabel = (name, code) => (mode() === "codes" ? code : mode() === "names" ? name : `${name} (${code})`);
    const facetKey = (name) => `facet${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    const supplyOptions = () => {
      toolConfig.facets.filter((f) => f.list && f.names).forEach((f) => {
        const codes = Object.keys(f.names).filter((code) => [...document.querySelectorAll("#line-cards > li")].some((card) => (card.dataset[facetKey(f.name)] || "").split("|").includes(code)));
        codes.sort((a, b) => (mode() === "codes" ? a.localeCompare(b, "en", { numeric: true }) : f.names[a].localeCompare(f.names[b])));
        column.setOptions(f.name, codes.map((code) => ({ value: code, label: optionLabel(f.names[code], code) })));
      });
      tool.refilter();
    };
    // A choice that no department in view has is left out until one has it (the count beside it is 0), unless it is chosen.
    const hideEmptyChoices = () => {
      toolConfig.facets.filter((f) => f.list && f.names).forEach((f) => {
        const group = [...document.querySelectorAll("aside fieldset")].find((x) => x.querySelector("legend") && x.querySelector("legend").textContent === f.label);
        if (!group) return;
        group.querySelectorAll("li").forEach((li) => {
          const count = li.querySelector(".search-facet-count");
          const box = li.querySelector("input");
          li.hidden = Boolean(count) && /^\(0\)$/.test(count.textContent.trim()) && !(box && box.checked);
        });
      });
    };

    // ---- the amounts that are chosen go with the link to a department's page ----
    const carry = () => {
      const now = new URLSearchParams(window.location.search);
      const keep = new URLSearchParams();
      ["measure", "basis", "year", "change", "labels"].forEach((name) => { if (now.has(name)) keep.set(name, now.get(name)); });
      const query = keep.toString();
      document.querySelectorAll("#line-cards .mm-card__title a, #line-table th a").forEach((a) => {
        const base = a.getAttribute("href").split("?")[0];
        a.setAttribute("href", query ? `${base}?${query}` : base);
      });
    };

    const update = () => { applyLabels(); carry(); hideEmptyChoices(); };
    document.addEventListener("marin-budget-counts", hideEmptyChoices); // before the choices are supplied, so the first counts are seen
    update();
    supplyOptions();
    column.addEventListener("marin-filter-change", (event) => {
      if (event.detail.source === "labels" || event.detail.source === "reset") supplyOptions();
      window.setTimeout(update, 0);
    });
  });
})();
