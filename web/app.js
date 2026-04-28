// Fit 1728×1117 screens into the viewport without changing layout.
const BASE_W = 1728;
const BASE_H = 1117;

function updateScale() {
  const stage = document.querySelector(".stage");
  if (!stage) return;

  // Full-screen: scale to cover the viewport (no letterboxing).
  const vw = Math.max(320, window.innerWidth);
  const vh = Math.max(320, window.innerHeight);

  // Allow scaling up on large desktop displays.
  const scale = Math.max(vw / BASE_W, vh / BASE_H);
  stage.style.setProperty("--scale", String(scale));
}

window.addEventListener("resize", updateScale);
window.addEventListener("DOMContentLoaded", updateScale);

