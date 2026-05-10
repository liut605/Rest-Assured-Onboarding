// Minimal interactivity layer for the prototype.
//
// How transitions work in this prototype:
// - Primary navigation is plain links (<a href="./some-page.html">). Those leave immediately.
// - For pages that want a consistent "fade out" before leaving, use navigateWithTransition()
//   which adds `.is-leaving` to `.stage` and then changes location after a short timeout.
// - Some pages opt into "stage-to-advance" navigation by setting:
//   - data-next="./next.html"
//   - data-advance="click" (default), "auto", "button-only", or "none"
//   In those cases clicking empty space (or Space/Enter/→) calls goNext() which uses
//   navigateWithTransition() under the hood.
// - Certain multi-step pages stay on one HTML file and switch in-page "scenes" by toggling
//   classes (e.g. `.speaker-try .sp-scene`). Those scene changes do NOT reload the page.
// - A few flows can advance based on serial/WebSocket signals; when they auto-navigate we
//   also go through navigateWithTransition() to keep transitions consistent.
//
// Non-goals:
// - This does NOT implement any "send-to" / figproxy behaviors.

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

  // Intentionally short: enough to show the CSS fade, but not slow to navigate.
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

function normalizeProgressLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveProgressHref(stepEl) {
  if (!(stepEl instanceof Element)) return null;
  if (stepEl.hasAttribute("data-fin-reset")) return null;
  const rawHref = String(stepEl.getAttribute("href") || "").trim();
  if (rawHref && rawHref !== "#" && !rawHref.startsWith("javascript:")) {
    return rawHref;
  }

  const label = normalizeProgressLabel(
    stepEl.querySelector(".label")?.textContent || "",
  );
  const labelToHref = {
    "intro video": "./intro-video.html",
    "figurine motive": "./795-889.html",
    "figurine iot": "./795-1026.html",
    "try - speaker": "./905-1679.html",
    "try - diffuser": "./809-2598.html",
    "remind - light colors": "./913-2849.html",
    "quiz time": "./1144-2351.html",
    fin: "./final-placeholder.html",
    "final scene": "./1019-2235.html",
  };
  return labelToHref[label] || null;
}

window.addEventListener("DOMContentLoaded", () => {
  const stage = document.querySelector(".stage");
  if (!stage) return;

  const DEBUG_SERIAL =
    stage.hasAttribute("data-debug-serial") ||
    new URLSearchParams(window.location.search).has("debugSerial");
  const IGNORE_CAP_TOUCH = stage.hasAttribute("data-ignore-cap-touch");
  if (DEBUG_SERIAL) {
    console.log("[proto] debugSerial enabled", {
      nodeId: stage.getAttribute("data-node-id"),
      href: window.location.href,
    });
  }

  function isCapTouchLine(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (t.toLowerCase().includes("cap_touch")) return true;
    // Also treat JSON {type:"cap_touch"} or {cap_touch:true} as CAP_TOUCH-like
    try {
      const j = JSON.parse(t);
      return Boolean(
        j &&
        typeof j === "object" &&
        (j.type === "cap_touch" || j.cap_touch === true),
      );
    } catch {
      return false;
    }
  }

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
      nextBtn.setAttribute("href", "./795-889.html");
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
      nextBtn.setAttribute("href", "./809-2598.html");
    }
  }

  // Shared WebSocket connection (reused for scene changes)
  let ws = null;
  let wsQueue = [];
  const deviceLineHandlers = new Set();

  function onDeviceLine(text) {
    if (DEBUG_SERIAL) console.log("[serial] device:line", text);
    const hasButtonWord = String(text || "")
      .toLowerCase()
      .includes("button");
    if (IGNORE_CAP_TOUCH && isCapTouchLine(text) && !hasButtonWord) {
      if (DEBUG_SERIAL) console.log("[serial] ignoring CAP_TOUCH on this page");
      return;
    }
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
        if (DEBUG_SERIAL) console.log("[ws] open ws://localhost:8787");
        for (const msg of wsQueue) ws.send(msg);
        wsQueue = [];
      });
      ws.addEventListener("message", (ev) => {
        let payload;
        try {
          payload = JSON.parse(String(ev.data));
        } catch {
          if (DEBUG_SERIAL) console.log("[ws] non-json message", ev.data);
          return;
        }
        if (payload?.type === "device:line" && payload.text != null) {
          onDeviceLine(payload.text);
          return;
        }
        if (DEBUG_SERIAL) console.log("[ws] message", payload);
      });
      ws.addEventListener("error", (e) => {
        if (DEBUG_SERIAL) console.log("[ws] error", e);
      });
      ws.addEventListener("close", (e) => {
        if (DEBUG_SERIAL) console.log("[ws] close", e.code, e.reason);
      });
    } catch {
      ws = null;
    }
    return ws;
  }

  function sendNeopixelState(state) {
    if (!state) return;
    const normalizedState = String(state).trim().toLowerCase();
    const isProgressBarPage = Boolean(stage.querySelector(".progress"));
    if (isProgressBarPage && normalizedState !== "off") {
      if (DEBUG_SERIAL) {
        console.log(
          "[neopixel] blocked non-off state on progress page",
          normalizedState,
        );
      }
      return;
    }
    const payload = JSON.stringify({
      // Web -> bridge command for Arduino/ESP32 NeoPixel state updates.
      type: "neopixel:set",
      // States map to figurine/light modes (off/on/speaker_on/diffuser_on).
      state: normalizedState,
      nodeId: stage.getAttribute("data-node-id") || undefined,
    });
    if (DEBUG_SERIAL) console.log("[neopixel] send", payload);
    const sock = ensureWs();
    if (!sock) return;
    // This WebSocket send is the browser-side signal dispatch toward Arduino.
    if (sock.readyState === WebSocket.OPEN) sock.send(payload);
    else wsQueue.push(payload);
  }

  // Device bridge (future-proof: two-way WS messages)
  // Stage can declare desired neopixel state via:
  // data-neopixel='{"state":"off" | "on" | "speaker_on" | "diffuser_on"}'
  const neopixelSpecRaw = stage.getAttribute("data-neopixel");
  const neopixelSpec = neopixelSpecRaw ? safeJsonParse(neopixelSpecRaw) : null;

  function resolveNeopixelState() {
    const baseState = String(neopixelSpec?.state || "")
      .trim()
      .toLowerCase();

    // Scene-aware override: try-speaker flow.
    if (stage.classList.contains("speaker-try")) {
      const which = stage
        .querySelector(".sp-scene.is-active")
        ?.getAttribute("data-sp");
      if (which === "3") return "speaker_on";
      if (which === "2") return "on";
      if (which === "1") return "off";
    }

    // Scene-aware override: try-diffuser flow.
    if (stage.classList.contains("diffuser-try")) {
      const which = stage
        .querySelector(".df-scene.is-active")
        ?.getAttribute("data-df");
      if (which === "2" || stage.classList.contains("df-button-received")) {
        return "diffuser_on";
      }
      return "off";
    }

    // Scene-aware override: type-2 fill pages after correct answer.
    if (
      stage.classList.contains("type2-fill") &&
      stage.getAttribute("data-fill-state") === "correct"
    ) {
      const nodeId = String(stage.getAttribute("data-node-id") || "")
        .trim()
        .replace(":", "-");
      if (nodeId === "1208-5974") return "diffuser_on";
      if (nodeId === "1208-6017") return "speaker_on";
    }

    return baseState || null;
  }

  function reassertNeopixelState(reason) {
    const current = resolveNeopixelState();
    if (!current) return;
    if (DEBUG_SERIAL) console.log("[neopixel] reassert", reason, current);
    sendNeopixelState(current);
  }

  if (neopixelSpec?.state) {
    // Sends page-declared/current scene figurine/light state on load.
    reassertNeopixelState("init");
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

  function matchesButton(line, customSignal) {
    const t = String(line).trim();
    if (!t) return false;
    const sig = String(customSignal || "BUTTON").toLowerCase();
    if (t.toLowerCase().includes(sig)) return true;
    let j = null;
    try {
      j = JSON.parse(t);
    } catch {
      return false;
    }
    if (j && typeof j === "object") {
      if (j.type === "button" || j.button === true) return true;
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
      reassertNeopixelState("speaker-scene");
    }

    speakerRoot.querySelectorAll("[data-sp-goto]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const next = String(btn.getAttribute("data-sp-goto") || "");
        if (!next) return;
        goSpeakerScene(next);
        if (next === "2") {
          // User action -> turn figurine light "on" via Arduino.
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
        // CAP_TOUCH event -> switch figurine/light to speaker mode.
        sendNeopixelState("speaker_on");
        if (!scene3NavShown) {
          scene3NavShown = true;
          speakerRoot
            .querySelectorAll("[data-sp-await='nav3']")
            .forEach((el) => {
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

    // Prototype safety net:
    // If no device is connected (or the demo is being reviewed without serial),
    // don't leave the user stranded. We allow the Scene 3 navigation controls
    // to appear automatically after a short delay so "Next" works during review.
    window.setTimeout(() => {
      if (scene3NavShown) return;
      scene3NavShown = true;
      speakerRoot.querySelectorAll("[data-sp-await='nav3']").forEach((el) => {
        el.classList.add("is-visible");
        el.setAttribute("aria-hidden", "false");
      });
    }, 1800);

    // Debug shortcut: "[" simulates CAP_TOUCH for try-speaker flow.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "[") return;
      lineHandler(capToken);
    });
  }

  // Try — diffuser: condensed in-page scenes (boop nose).
  // Single waiting scene: animate until serial line containing "BUTTON",
  // then advance to the next page.
  const diffuserRoot = document.querySelector(".diffuser-try");
  if (diffuserRoot) {
    const buttonToken =
      (diffuserRoot.getAttribute("data-button-signal") || "BUTTON").trim() ||
      "BUTTON";
    let buttonAdvanceDone = false;

    function goDiffuserScene(which) {
      diffuserRoot.querySelectorAll(".df-scene").forEach((panel) => {
        const on = panel.getAttribute("data-df") === which;
        panel.classList.toggle("is-active", on);
        panel.setAttribute("aria-hidden", on ? "false" : "true");
      });
      reassertNeopixelState("diffuser-scene");
    }

    const lineHandler = (line) => {
      const isBtn = matchesButton(line, buttonToken);
      if (DEBUG_SERIAL) console.log("[diffuser] line", line, "button?", isBtn);
      if (!isBtn) return;
      if (buttonAdvanceDone) return;
      buttonAdvanceDone = true;
      // BUTTON (or debug "]") turns diffuser NeoPixel mode on.
      sendNeopixelState("diffuser_on");
      diffuserRoot.classList.add("df-button-received");
      const hasScene2 = Boolean(
        diffuserRoot.querySelector('.df-scene[data-df="2"]'),
      );
      if (hasScene2) {
        goDiffuserScene("2");
        return;
      }
      const nextHref =
        diffuserRoot.getAttribute("data-next-on-button") || "./905-2400.html";
      if (DEBUG_SERIAL) console.log("[diffuser] navigate", nextHref);
      window.setTimeout(() => navigateWithTransition(nextHref), 120);
    };

    deviceLineHandlers.add(lineHandler);
    ensureWs();

    // Debug shortcut: "]" simulates BUTTON for try-diffuser flow.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "]") return;
      lineHandler(buttonToken);
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
      // Timed reveal can also push a figurine/light state to Arduino.
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

  // Make progress bars fully functional:
  // clicking any step (including future/placeholder "#" steps) jumps to that stage.
  const progressNav = stage.querySelector(".progress");
  if (progressNav) {
    progressNav.addEventListener("click", (e) => {
      const stepLink =
        e.target instanceof Element
          ? e.target.closest(".step.step-link")
          : null;
      if (!stepLink) return;
      const nextHref = resolveProgressHref(stepLink);
      if (!nextHref) return;
      e.preventDefault();
      navigateWithTransition(nextHref);
    });
  }

  // Re-send current state when user returns to this page/tab.
  window.addEventListener("pageshow", () => reassertNeopixelState("pageshow"));
  window.addEventListener("focus", () => reassertNeopixelState("focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reassertNeopixelState("visibility");
    }
  });

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
