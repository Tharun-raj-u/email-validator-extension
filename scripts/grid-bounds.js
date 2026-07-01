(function () {
  const selectors = [
    "#grid-container [role='grid']",
    "#grid-container",
    "#waffle-grid-container",
    '[role="grid"]',
  ];

  let el = null;
  for (const sel of selectors) {
    el = document.querySelector(sel);
    if (el) break;
  }

  if (!el) {
    window.__gridBounds = null;
    return;
  }

  const r = el.getBoundingClientRect();
  if (r.width < 50 || r.height < 50) {
    window.__gridBounds = null;
    return;
  }

  window.__gridBounds = {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    dpr: window.devicePixelRatio || 1,
  };
})();
