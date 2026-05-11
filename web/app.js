// Fit 1728×1117 screens into the viewport without changing layout.
const BASE_W = 1728;
const BASE_H = 1117;

function updateScale() {
  const stage = document.querySelector(".stage");
  if (!stage) return;

  // Use VisualViewport when available (more accurate on some systems where
  // browser UI/chrome affects innerWidth/innerHeight).
  const vv = window.visualViewport;
  const vw = Math.max(320, vv?.width ?? window.innerWidth);
  const vh = Math.max(320, vv?.height ?? window.innerHeight);

  // Default behavior is now "cover" so screens fill the full viewport.
  // Opt into "contain" per-page with: <main class="stage" data-scale="contain" ...>
  const mode = (stage.getAttribute("data-scale") || "cover").toLowerCase();
  const containScale = Math.min(vw / BASE_W, vh / BASE_H);
  const coverScale = Math.max(vw / BASE_W, vh / BASE_H);
  const scale = mode === "cover" ? coverScale : containScale;
  stage.style.setProperty("--scale", String(scale));
}

window.addEventListener("resize", updateScale);
window.addEventListener("DOMContentLoaded", updateScale);
