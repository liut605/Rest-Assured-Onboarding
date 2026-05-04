import { WebSocketServer } from "ws";
import { SerialPort } from "serialport";
import { ReadlineParser } from "serialport";

const WS_PORT = Number(process.env.WS_PORT || "8787");
const SERIAL_PATH = process.env.SERIAL_PORT || "";
const BAUD_RATE = Number(process.env.BAUD_RATE || "115200");

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

if (!SERIAL_PATH) {
  const ports = await listPorts();
  console.error(
    `Missing SERIAL_PORT.\n\nDetected ports:\n${ports
      .map((p) => `- ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ""}`)
      .join(
        "\n",
      )}\n\nRun e.g.:\nSERIAL_PORT=/dev/cu.usbserial-XXXX npm start\n`,
  );
  process.exit(1);
}

const port = new SerialPort({
  path: mustEnv("SERIAL_PORT", SERIAL_PATH),
  baudRate: BAUD_RATE,
});

const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

const wss = new WebSocketServer({ port: WS_PORT });

function writeLine(line) {
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
  });
});

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
    `If Arduino Serial Monitor is open, close it and retry.\nThen run e.g.:\nSERIAL_PORT=/dev/cu.usbserial-XXXX npm start\n`,
  );
  process.exit(1);
});
