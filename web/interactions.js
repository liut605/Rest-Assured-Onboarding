// Minimal interactivity layer for the prototype.
// - Click "Next" buttons to navigate (normal <a href> behavior).
// - Optional stage-to-advance and keyboard when data-next is set (configurable via data-advance).
// - Does NOT implement any "send-to" / figproxy behaviors.

function shouldIgnoreTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest("a,button,input,textarea,select,label,[data-no-advance]"),
  );
}

function navigateWithTransition(nextHref) {
  const stage = document.querySelector(".stage");
  if (!stage) {
    window.location.href = nextHref;
    return;
  }

  const transition = stage.getAttribute("data-transition") || "fade";
  if (transition === "none") {
    window.location.href = nextHref;
    return;
  }

  // Fade out before leaving.
  stage.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = nextHref;
  }, 240);
}

function goNext() {
  const stage = document.querySelector(".stage");
  const next = stage?.getAttribute("data-next");
  if (!next) return;
  navigateWithTransition(next);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const stage = document.querySelector(".stage");
  if (!stage) return;

  function applyProgressStepIcons(stepLinks, { past, current, future }) {
    stepLinks.forEach((el, i) => {
      const inPast = past.has(i);
      const isCurrent = current != null && current === i;
      el.classList.toggle("active", isCurrent);
      const icon = el.querySelector(".icon");
      if (!icon) return;
      icon.classList.remove("icon--past", "icon--current", "icon--future");
      if (inPast) icon.classList.add("icon--past");
      else if (isCurrent) icon.classList.add("icon--current");
      else if (future.has(i)) icon.classList.add("icon--future");
      else icon.classList.add("icon--future");
    });
  }

  const summaryPage = document.querySelector("[data-summary-page]");
  if (summaryPage) {
    const after = new URLSearchParams(window.location.search).get("after");
    const nextBtn = document.getElementById("summary-next");
    const stepLinks = Array.from(
      summaryPage.querySelectorAll(".progress .steps .step.step-link"),
    );

    if (after === "speaker" && nextBtn && stepLinks.length >= 6) {
      nextBtn.setAttribute("href", "./801-1048.html");
      applyProgressStepIcons(stepLinks, {
        past: new Set([0, 1, 2]),
        current: null,
        future: new Set([3, 4, 5]),
      });
    } else if (after === "classical" && nextBtn && stepLinks.length >= 6) {
      nextBtn.setAttribute("href", "../index.html");
      applyProgressStepIcons(stepLinks, {
        past: new Set([0, 1, 2]),
        current: 3,
        future: new Set([4, 5]),
      });
    } else if (nextBtn) {
      nextBtn.setAttribute("href", "./905-2064.html");
    }
  }

  // Shared WebSocket connection (reused for scene changes)
  let ws = null;
  let wsQueue = [];
  const deviceLineHandlers = new Set();

  function onDeviceLine(text) {
    for (const fn of deviceLineHandlers) {
      try {
        fn(String(text).trim());
      } catch {
        // ignore
      }
    }
  }

  function ensureWs() {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      return ws;
    }
    try {
      ws = new WebSocket("ws://localhost:8787");
      ws.addEventListener("open", () => {
        for (const msg of wsQueue) ws.send(msg);
        wsQueue = [];
      });
      ws.addEventListener("message", (ev) => {
        let payload;
        try {
          payload = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (payload?.type === "device:line" && payload.text != null) {
          onDeviceLine(payload.text);
        }
      });
      ws.addEventListener("error", () => {});
    } catch {
      ws = null;
    }
    return ws;
  }

  function sendNeopixelState(state) {
    if (!state) return;
    const payload = JSON.stringify({
      type: "neopixel:set",
      state,
      nodeId: stage.getAttribute("data-node-id") || undefined,
    });
    const sock = ensureWs();
    if (!sock) return;
    if (sock.readyState === WebSocket.OPEN) sock.send(payload);
    else wsQueue.push(payload);
  }

  // Device bridge (future-proof: two-way WS messages)
  // Stage can declare desired neopixel state via:
  // data-neopixel='{"state":"off" | "on" | "speaker_on" | "diffuser_on"}'
  const neopixelSpecRaw = stage.getAttribute("data-neopixel");
  const neopixelSpec = neopixelSpecRaw ? safeJsonParse(neopixelSpecRaw) : null;
  if (neopixelSpec?.state) {
    sendNeopixelState(neopixelSpec.state);
  }

  function matchesCapTouch(line, customSignal) {
    const t = String(line).trim();
    if (!t) return false;
    const sig = String(customSignal || "CAP_TOUCH").toLowerCase();
    if (t.toLowerCase().includes(sig)) return true;
    let j = null;
    try {
      j = JSON.parse(t);
    } catch {
      return false;
    }
    if (j && typeof j === "object") {
      if (j.type === "cap_touch" || j.cap_touch === true) return true;
    }
    return false;
  }

  // Try — speaker: condensed in-page scenes.
  // Single CAP_TOUCH (default) transitions Scene 1 -> Scene 3 and reveals Scene 3 nav.
  const speakerRoot = document.querySelector(".speaker-try");
  if (speakerRoot) {
    const capToken =
      (speakerRoot.getAttribute("data-cap-signal") || "CAP_TOUCH").trim() ||
      "CAP_TOUCH";
    let scene1to3Done = false;
    let scene3NavShown = false;

    function goSpeakerScene(which) {
      speakerRoot.querySelectorAll(".sp-scene").forEach((panel) => {
        const on = panel.getAttribute("data-sp") === which;
        panel.classList.toggle("is-active", on);
        panel.setAttribute("aria-hidden", on ? "false" : "true");
      });
    }

    speakerRoot.querySelectorAll("[data-sp-goto]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const next = String(btn.getAttribute("data-sp-goto") || "");
        if (!next) return;
        goSpeakerScene(next);
        if (next === "2") {
          sendNeopixelState("on");
        }
      });
    });

    const lineHandler = (line) => {
      if (!matchesCapTouch(line, capToken)) return;
      const active = speakerRoot.querySelector(".sp-scene.is-active");
      const which = active?.getAttribute("data-sp");

      if (which === "1") {
        if (scene1to3Done) return;
        scene1to3Done = true;
        goSpeakerScene("3");
        sendNeopixelState("speaker_on");
        if (!scene3NavShown) {
          scene3NavShown = true;
          speakerRoot.querySelectorAll("[data-sp-await='nav3']").forEach((el) => {
            el.classList.add("is-visible");
            el.setAttribute("aria-hidden", "false");
          });
        }
        return;
      }

      if (which === "3") {
        if (scene3NavShown) return;
        scene3NavShown = true;
        speakerRoot.querySelectorAll("[data-sp-await='nav3']").forEach((el) => {
          el.classList.add("is-visible");
          el.setAttribute("aria-hidden", "false");
        });
      }
    };
    deviceLineHandlers.add(lineHandler);
    ensureWs();
  }

  // Intro (905:1216) + soundwaves split (801:1048) on one page
  const soundRoot = document.querySelector(".sound-flow");
  if (soundRoot) {
    function goSoundScene(which) {
      soundRoot.querySelectorAll(".sound-scene").forEach((panel) => {
        const on = panel.getAttribute("data-sound") === which;
        panel.classList.toggle("is-active", on);
        panel.setAttribute("aria-hidden", on ? "false" : "true");
      });
      soundRoot.classList.toggle("bg-beige", which === "intro");
      if (which === "split") {
        sendNeopixelState("speaker_on");
      } else {
        sendNeopixelState("off");
      }
    }

    soundRoot.querySelectorAll("[data-sound-goto]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const dest = btn.getAttribute("data-sound-goto");
        if (!dest) return;
        e.preventDefault();
        goSoundScene(dest);
      });
    });
  }

  // Simple "smart animation" replacements:
  // - Any element with [data-animate="pop-in"] will add .animate-in after a delay
  // - Any element with [data-reveal] will add .is-visible after a delay
  stage.querySelectorAll("[data-animate]").forEach((el) => {
    const kind = String(el.getAttribute("data-animate") || "");
    const delayMs = Number(el.getAttribute("data-delay-ms") || "0");
    if (!Number.isFinite(delayMs) || delayMs < 0) return;

    window.setTimeout(() => {
      if (kind === "pop-in") el.classList.add("animate-in");
    }, delayMs);
  });

  stage.querySelectorAll("[data-reveal]").forEach((el) => {
    const delayMs = Number(el.getAttribute("data-delay-ms") || "0");
    if (!Number.isFinite(delayMs) || delayMs < 0) return;

    window.setTimeout(() => {
      el.classList.add("is-visible");
      const nextState = el.getAttribute("data-neopixel-state");
      if (nextState) sendNeopixelState(nextState);
      const hideSel = el.getAttribute("data-hides");
      if (hideSel) {
        document
          .querySelectorAll(hideSel)
          .forEach((h) => h.classList.add("u-hidden"));
      }
    }, delayMs);

    const hideMs = Number(el.getAttribute("data-hide-ms") || "");
    if (Number.isFinite(hideMs) && hideMs >= 0) {
      window.setTimeout(() => {
        el.classList.remove("is-visible");
      }, hideMs);
    }
  });

  // data-advance:
  // - click (default): clicking empty stage advances
  // - auto: advances after data-delay-ms (default 1200ms)
  // - button-only: never stage-advances; only buttons/links navigate
  // - none: no implicit advancing
  const advance = (stage.getAttribute("data-advance") || "click").toLowerCase();

  ensureWs();

  if (advance === "auto" && stage.hasAttribute("data-next")) {
    const delayMs = Number(stage.getAttribute("data-delay-ms") || "1200");
    if (Number.isFinite(delayMs) && delayMs >= 0) {
      window.setTimeout(() => {
        goNext();
      }, delayMs);
    }
  }

  stage.addEventListener("click", (e) => {
    if (advance !== "click") return;
    if (!stage.hasAttribute("data-next")) return;
    if (shouldIgnoreTarget(e.target)) return;
    goNext();
  });

  window.addEventListener("keydown", (e) => {
    if (advance !== "click") return;
    if (!stage.hasAttribute("data-next")) return;
    const key = e.key;
    if (key === " " || key === "Enter" || key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  });
});
