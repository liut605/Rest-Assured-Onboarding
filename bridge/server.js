import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { ReadlineParser } from "serialport";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TuyAPI from "tuyapi";
import { TuyaContext } from "@tuya/tuya-connector-nodejs";

const WS_PORT = Number(process.env.WS_PORT || "8787");
const SERIAL_PATH = process.env.SERIAL_PORT || "";
const BAUD_RATE = Number(process.env.BAUD_RATE || "115200");
const TUYA_MODE = String(process.env.TUYA_MODE || "local")
  .trim()
  .toLowerCase();
const TUYA_DEVICE_ID = process.env.TUYA_DEVICE_ID || "eb07e6ad331f0a44dblrat";
const TUYA_DEVICE_KEY = process.env.TUYA_DEVICE_KEY || "p5bt7bhUrX*wU4[]";
const TUYA_IP = process.env.TUYA_IP || "";
const TUYA_VERSION = process.env.TUYA_VERSION || "3.3";
const TUYA_ACCESS_KEY = process.env.TUYA_ACCESS_KEY || "";
const TUYA_ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET || "";
const TUYA_CLOUD_BASE_URL =
  process.env.TUYA_CLOUD_BASE_URL || "https://openapi.tuyaus.com";
const TUYA_SWITCH_CODE = process.env.TUYA_SWITCH_CODE || "switch";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "web", "assets");
let audioProc = null;

async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    vendorId: p.vendorId,
    productId: p.productId,
  }));
}

function mustEnv(name, value) {
  if (!value) {
    throw new Error(
      `Missing ${name}. Example: ${name}=/dev/tty.usbserial-XXXX npm start`,
    );
  }
  return value;
}

let port = null;
let parser = null;

if (!SERIAL_PATH) {
  const ports = await listPorts();
  console.warn(
    `Missing SERIAL_PORT. Starting WS/audio bridge without serial.\n\nDetected ports:\n${ports
      .map((p) => `- ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ""}`)
      .join(
        "\n",
      )}\n\nTo enable Arduino I/O, run e.g.:\nSERIAL_PORT=/dev/cu.usbserial-XXXX npm start\n`,
  );
} else {
  try {
    port = new SerialPort({
      path: mustEnv("SERIAL_PORT", SERIAL_PATH),
      baudRate: BAUD_RATE,
    });
    parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  } catch (err) {
    console.error(
      `Failed to initialize serial port: ${SERIAL_PATH}\n${err}\nContinuing without serial.`,
    );
  }
}

const wss = new WebSocketServer({ port: WS_PORT });

function writeLine(line) {
  if (!port || !port.isOpen) {
    console.warn(`[serial->esp32] skipped (serial unavailable): ${line}`);
    return;
  }
  console.log(`[serial->esp32] ${line}`);
  port.write(`${line}\n`, (err) => {
    if (err) console.error(`[serial->esp32] write error`, err);
    port.drain(() => {});
  });
}

function normalizeState(state) {
  const v = String(state || "")
    .trim()
    .toLowerCase();
  if (!v) return null;
  const allowed = new Set(["off", "on", "speaker_on", "diffuser_on"]);
  return allowed.has(v) ? v : null;
}

function logTuya(event, data) {
  if (data === undefined) {
    console.log(`[tuya] ${event}`);
    return;
  }
  try {
    console.log(`[tuya] ${event}`, JSON.stringify(data));
  } catch {
    console.log(`[tuya] ${event}`, data);
  }
}

function stopAudio() {
  if (!audioProc) return;
  try {
    audioProc.kill("SIGTERM");
  } catch {
    // ignore process stop failures
  }
  audioProc = null;
}

function resolveAssetAudioPath(fileName) {
  const requested = String(fileName || "").trim();
  if (!requested) return null;
  const baseName = path.basename(requested);
  if (!baseName) return null;
  const fullPath = path.resolve(ASSETS_DIR, baseName);
  if (!fullPath.startsWith(ASSETS_DIR + path.sep)) return null;
  return fullPath;
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg?.type === "neopixel:set") {
      const state = normalizeState(msg.state);
      if (!state) return;
      console.log(`[ws<-web] neopixel:set ${state}`);
      // Bridge hop: forwards web figurine/light state to Arduino over serial.
      // Serial protocol: "<state>\\n"
      // (matches Arduino-side line parsing; simplest for now)
      writeLine(state);
      void applyDiffuserState(state === "diffuser_on").catch(() => {
        // Tuya failures are logged in setDiffuserPower; keep WS bridge alive.
      });
      ws.send(JSON.stringify({ type: "ack", for: "neopixel:set", state }));
      return;
    }

    if (msg?.type === "audio:play") {
      const audioPath = resolveAssetAudioPath(msg.file);
      if (!audioPath) {
        ws.send(
          JSON.stringify({
            type: "ack",
            for: "audio:play",
            ok: false,
            error: "invalid_file",
          }),
        );
        return;
      }
      stopAudio();
      audioProc = spawn("afplay", [audioPath], { stdio: "ignore" });
      audioProc.on("exit", () => {
        audioProc = null;
      });
      audioProc.on("error", (err) => {
        console.error("[audio] afplay error", err);
        audioProc = null;
      });
      ws.send(
        JSON.stringify({
          type: "ack",
          for: "audio:play",
          ok: true,
          file: msg.file,
        }),
      );
      return;
    }

    if (msg?.type === "audio:stop") {
      stopAudio();
      ws.send(JSON.stringify({ type: "ack", for: "audio:stop", ok: true }));
      return;
    }
  });
});

if (parser) {
  parser.on("data", (line) => {
    const text = String(line).trim();
    if (!text) return;
    // Debug: confirm what we receive from ESP32
    console.log(`[serial<-esp32] ${text}`);
    // Web forwards `device:line` to the page; match there for capacitive touch, etc.
    // Try-speaker (905-1679): one line per threshold crossing — e.g. 1) reveal Continue,
    // 2) go to next scene, 3) reveal Back/Next. Serial.println("CAP_TOUCH");
    const payload = JSON.stringify({ type: "device:line", text });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  });
}

if (port) {
  port.on("open", () => {
    // no-op
  });

  port.on("error", async (err) => {
    const ports = await listPorts();
    console.error(`Failed to open serial port: ${SERIAL_PATH}\n${err}\n`);
    console.error(
      `Detected ports:\n${ports
        .map(
          (p) => `- ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ""}`,
        )
        .join("\n")}\n`,
    );
    console.error(
      `If Arduino Serial Monitor is open, close it and retry.\nThen run e.g.:\nSERIAL_PORT=/dev/cu.usbserial-XXXX npm start\nContinuing with WS/audio only.`,
    );
  });
}

const diffuserConfigured = Boolean(TUYA_DEVICE_ID && TUYA_DEVICE_KEY);
const diffuser = diffuserConfigured
  ? new TuyAPI({
      id: TUYA_DEVICE_ID,
      key: TUYA_DEVICE_KEY,
      ...(TUYA_IP ? { ip: TUYA_IP } : {}),
      version: TUYA_VERSION,
    })
  : null;

if (diffuserConfigured) {
  logTuya("bridge:boot", {
    mode: TUYA_MODE,
    id: TUYA_DEVICE_ID,
    ip: TUYA_IP || "auto-discovery",
    version: TUYA_VERSION,
  });
} else {
  logTuya(
    "disabled",
    "Missing TUYA_DEVICE_ID or TUYA_DEVICE_KEY (set env vars to enable diffuser control).",
  );
}

if (diffuser) {
  diffuser.on("error", (err) => {
    logTuya("device:error", {
      message: String(err?.message || err),
      hint: "Local Tuya timeout is expected on hotspot/isolation networks; bridge will continue running.",
    });
  });
}

let tuyaLastAppliedState = null;
let tuyaQueue = Promise.resolve();
let tuyaPendingState = null;
let tuyaPendingPromise = null;

const cloudConfigured = Boolean(
  TUYA_ACCESS_KEY && TUYA_ACCESS_SECRET && TUYA_DEVICE_ID,
);
const tuyaCloud = cloudConfigured
  ? new TuyaContext({
      baseUrl: TUYA_CLOUD_BASE_URL,
      accessKey: TUYA_ACCESS_KEY,
      secretKey: TUYA_ACCESS_SECRET,
    })
  : null;

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function setDiffuserPower(nextOn) {
  if (!diffuser) return;
  const verb = nextOn ? "on" : "off";
  const startedAt = Date.now();
  logTuya(`diffuser:${verb}:start`);
  try {
    if (!TUYA_IP) {
      await withTimeout(diffuser.find(), 7000, "diffuser.find");
      logTuya(`diffuser:${verb}:found`);
    }
    await withTimeout(diffuser.connect(), 8000, "diffuser.connect");
    logTuya(`diffuser:${verb}:connected`);
    await withTimeout(
      diffuser.set({ dps: 1, set: nextOn }),
      8000,
      "diffuser.set",
    );
    logTuya(`diffuser:${verb}:set`, { dps: 1, set: nextOn });
    logTuya(`diffuser:${verb}:done`, { elapsedMs: Date.now() - startedAt });
  } catch (err) {
    const message = String(err?.message || err);
    logTuya(`diffuser:${verb}:error`, {
      message,
      hint: TUYA_IP
        ? "Fixed IP is set. Verify diffuser IP is current and reachable."
        : "Auto-discovery failed or local control unreachable. On hotspot/cellular networks, local Tuya control is commonly blocked.",
    });
    throw err;
  } finally {
    try {
      diffuser.disconnect();
    } catch {
      // ignore disconnect failures
    }
  }
}

async function setDiffuserPowerCloud(nextOn) {
  if (!tuyaCloud) {
    throw new Error(
      "Tuya cloud not configured. Set TUYA_ACCESS_KEY, TUYA_ACCESS_SECRET, TUYA_DEVICE_ID.",
    );
  }
  const verb = nextOn ? "on" : "off";
  const startedAt = Date.now();
  logTuya(`cloud:${verb}:start`, {
    baseUrl: TUYA_CLOUD_BASE_URL,
    deviceId: TUYA_DEVICE_ID,
    code: TUYA_SWITCH_CODE,
  });
  const body = {
    commands: [{ code: TUYA_SWITCH_CODE, value: nextOn }],
  };
  const res = await withTimeout(
    tuyaCloud.request({
      method: "POST",
      path: `/v1.0/iot-03/devices/${TUYA_DEVICE_ID}/commands`,
      body,
    }),
    12000,
    "tuyaCloud.request",
  );
  const success = Boolean(res?.success);
  if (!success) {
    const message = String(
      res?.msg || res?.message || "Tuya cloud command failed",
    );
    const code = res?.code != null ? ` (${res.code})` : "";
    throw new Error(`${message}${code}`);
  }
  logTuya(`cloud:${verb}:done`, { elapsedMs: Date.now() - startedAt });
}

async function setDiffuserPowerByMode(nextOn) {
  if (TUYA_MODE === "cloud") {
    await setDiffuserPowerCloud(nextOn);
    return;
  }
  if (TUYA_MODE === "local") {
    await setDiffuserPower(nextOn);
    return;
  }
  // auto mode: local first, then cloud fallback
  try {
    await setDiffuserPower(nextOn);
  } catch (localErr) {
    logTuya("auto:local_failed", {
      message: String(localErr?.message || localErr),
      fallback: cloudConfigured ? "cloud" : "none",
    });
    if (!cloudConfigured) throw localErr;
    await setDiffuserPowerCloud(nextOn);
  }
}

function applyDiffuserState(nextOn) {
  if (TUYA_MODE === "cloud" && !cloudConfigured) {
    logTuya("cloud:disabled", "Missing cloud env vars.");
    return Promise.resolve();
  }
  if (TUYA_MODE !== "cloud" && !diffuser) {
    logTuya("local:disabled", "Missing local Tuya config.");
    return Promise.resolve();
  }
  const desired = nextOn ? "on" : "off";
  if (tuyaLastAppliedState === desired) {
    logTuya("queue:dedupe_applied", { state: desired });
    return Promise.resolve();
  }
  if (tuyaPendingState === desired && tuyaPendingPromise) {
    logTuya("queue:dedupe_pending", { state: desired });
    return tuyaPendingPromise;
  }
  tuyaPendingState = desired;
  tuyaQueue = tuyaQueue
    .catch(() => {
      // keep queue alive after failures
    })
    .then(async () => {
      await setDiffuserPowerByMode(nextOn);
      tuyaLastAppliedState = desired;
    });
  tuyaPendingPromise = tuyaQueue.finally(() => {
    if (tuyaPendingState === desired) {
      tuyaPendingState = null;
      tuyaPendingPromise = null;
    }
  });
  return tuyaPendingPromise;
}
