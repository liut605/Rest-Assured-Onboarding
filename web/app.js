// Intentionally disabled stage auto-scaling.
// Pages render at their authored pixel sizes unless CSS handles scaling.
window.addEventListener("DOMContentLoaded", () => {
  const stage = document.querySelector(".stage");
  if (!stage) return;
  stage.style.setProperty("--scale", "1");
});

