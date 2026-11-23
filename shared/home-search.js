// The search box on the home page: a contract number, a code or a name finds what has it, each result a link to the page that shows it.
// The lists it looks through are built by scripts/build-search.js and are loaded the first time the box is used.
(() => {
  const form = document.getElementById("home-search");
  if (!form) return;
  const input = document.getElementById("home-search-input");
  const list = document.getElementById("home-search-results");
  const status = document.getElementById("home-search-status");
  const everything = form.hasAttribute("data-all"); // the page of results lists every result; the home page lists a few and goes there when the box is sent
  const SHOWN = everything ? 1000 : 8;
  const FILES = ["search-index.json", "budget/accounting/search-index.json"];
  let entries = null;
  let loading = null;
  const load = () => {
    if (!loading) {
      loading = Promise.all(FILES.map((file) => fetch(file).then((r) => (r.ok ? r.json() : [])).catch(() => []))).then((parts) => {
        entries = parts.flat().map((e) => ({ ...e, hay: `${e.n} ${e.c} ${e.x}`.toLowerCase(), code: String(e.c || "").toLowerCase() }));
      });
    }
    return loading;
  };
  const rank = (e, q) => (e.code === q ? 0 : e.code.startsWith(q) ? 1 : e.n.toLowerCase().startsWith(q) ? 2 : 3);
  const run = () => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren();
    if (!q) { status.textContent = ""; return; }
    load().then(() => {
      if (input.value.trim().toLowerCase() !== q) return; // the box has changed since
      const terms = q.split(/\s+/);
      const found = entries.filter((e) => terms.every((t) => e.hay.includes(t))).sort((a, b) => rank(a, q) - rank(b, q));
      const item = (e, grouped) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = e.h;
        a.textContent = e.n;
        li.append(a, ` ${e.c ? `(${e.c})` : ""}`, Object.assign(document.createElement("span"), { className: "home-search__kind", textContent: grouped ? (e.x ? ` ${e.x}` : "") : ` ${e.k}${e.x ? `, ${e.x}` : ""}` }));
        return li;
      };
      if (everything) {
        // The page of results is grouped by what the results are, the biggest group first; each group is a list with its name and count above it.
        const groups = new Map();
        found.slice(0, SHOWN).forEach((e) => groups.set(e.k, [...(groups.get(e.k) || []), e]));
        const sizes = new Map();
        found.forEach((e) => sizes.set(e.k, (sizes.get(e.k) || 0) + 1));
        list.replaceChildren(...[...groups].sort((p, q) => sizes.get(q[0]) - sizes.get(p[0])).map(([kind, items]) => {
          const group = document.createElement("li");
          group.className = "home-search__group";
          const heading = Object.assign(document.createElement("h2"), { textContent: `${kind} (${sizes.get(kind).toLocaleString("en-US")})` });
          const inner = document.createElement("ul");
          inner.className = "home-search__results";
          inner.append(...items.map((e) => item(e, true)));
          group.append(heading, inner);
          return group;
        }));
      } else {
        list.replaceChildren(...found.slice(0, SHOWN).map((e) => item(e, false)));
      }
      // The same line as the filter column's: the count, then what narrows it (the groups below say the kinds).
      status.replaceChildren(window.marinResultsLine({ count: `${found.length.toLocaleString("en-US")} ${found.length === 1 ? "result" : "results"}${found.length > SHOWN ? `, the first ${SHOWN} listed` : ""}`, filters: [`matching \u201c${input.value.trim()}\u201d`] }));
      if (everything) { const url = new URL(window.location.href); url.searchParams.set("q", input.value.trim()); window.history.replaceState(null, "", url); }
    });
  };
  input.addEventListener("focus", load);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (everything) run();
    else if (input.value.trim()) window.location.href = `search.html?q=${encodeURIComponent(input.value.trim())}`;
  });
  // The page of results opens with what was asked for.
  const asked = new URLSearchParams(window.location.search).get("q");
  if (everything && asked) { input.value = asked; run(); }
})();
