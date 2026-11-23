// Makes the bars and slices of a chart links. A chart's data (the script beside it) may carry `links`: { "<name>": "<address>" }, a name being
// a label of the chart (a bar of a service area) or the name of a series (a segment of a category). Pressing a bar goes to its address.
// The same links are in the page as a list for a keyboard and a screen reader, so the chart is not the only way to them.
(() => {
  document.querySelectorAll(".chart-block").forEach((block) => {
    const holder = block.querySelector('script[type="application/json"]');
    let spec = null;
    try { spec = holder ? JSON.parse(holder.textContent) : null; } catch (error) { return; }
    if (!spec || !spec.links) return;
    const names = Object.keys(spec.links);
    const nav = document.createElement("ul");
    nav.className = "visually-hidden";
    nav.setAttribute("aria-label", "Links from this chart");
    names.forEach((name) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = spec.links[name];
      a.textContent = name;
      li.append(a);
      nav.append(li);
    });
    block.append(nav);

    const attach = () => {
      const canvas = block.querySelector("canvas");
      const chart = canvas && window.Chart && window.Chart.getChart ? window.Chart.getChart(canvas) : null;
      if (!chart) return false;
      const target = (event) => {
        const hit = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true)[0];
        if (!hit) return null;
        const label = chart.data.labels[hit.index];
        const set = chart.data.datasets[hit.datasetIndex];
        return spec.links[label] || (set && spec.links[set.label]) || null;
      };
      canvas.addEventListener("click", (event) => { const href = target(event); if (href) window.location.href = href; });
      canvas.addEventListener("mousemove", (event) => { canvas.style.cursor = target(event) ? "pointer" : "default"; });
      return true;
    };
    // The shell draws the chart after the page loads: look until it is there.
    let tries = 0;
    const timer = window.setInterval(() => { tries += 1; if (attach() || tries > 80) window.clearInterval(timer); }, 250);
  });
})();
