// The line above a list of results: the count first, then only the choices that narrow it.
//
//   21 departments / General Fund (1000) / Community & Environment
//
// One line, a slash between the parts. No "Showing:", no "All ..." for a choice that narrows nothing, no breakdown (that is the Stats tab), regular weight (the choices muted).
// An app passes its count and its narrowing choices; the node it gets goes to the filter column's setResults(count, node), which says it to a screen reader.
//
//   marinResultsLine({ count: "21 departments", filters: ["General Fund (1000)", "Community & Environment"] })
//   marinResultsLine.values(["a", "b", "c", "d", "e"], " or ")   ->   "a or b or c or +2 more"
(() => {
  const line = ({ count, filters = [] }) => {
    const root = document.createElement("span");
    root.className = "results-line";
    root.append(Object.assign(document.createElement("span"), { className: "results-line__count", textContent: count }));
    // One line: the count, then each choice that narrows it, a slash between: "6 projects / Needs additional funds".
    filters.filter(Boolean).forEach((choice) => {
      root.append(Object.assign(document.createElement("span"), { className: "results-line__slash", textContent: " / " }), Object.assign(document.createElement("span"), { className: "results-line__filters", textContent: choice }));
    });
    return root;
  };
  // A choice with many values is cut at three: "a, b, c, +2 more".
  line.values = (list, joiner = ", ") => (list.length > 3 ? `${list.slice(0, 3).join(joiner)}${joiner}+${list.length - 3} more` : list.join(joiner));
  // The count: the number of the things the list shows, with the name the cards use. "1,648 vendors", "1 vendor".
  line.count = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  window.marinResultsLine = line;
})();
