import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { ReadlineParser } from "serialport";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WS_PORT = Number(process.env.WS_PORT || "8787");
const SERIAL_PATH = process.env.SERIAL_PORT || "";
const BAUD_RATE = Number(process.env.BAUD_RATE || "115200");
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
        JSON.stringify({ type: "ack", for: "audio:play", ok: true, file: msg.file }),
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
        .map((p) => `- ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ""}`)
        .join("\n")}\n`,
    );
    console.error(
      `If Arduino Serial Monitor is open, close it and retry.\nThen run e.g.:\nSERIAL_PORT=/dev/cu.usbserial-XXXX npm start\nContinuing with WS/audio only.`,
    );
  });
}
