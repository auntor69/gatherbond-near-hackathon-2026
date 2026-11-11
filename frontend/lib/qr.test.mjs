import assert from "node:assert/strict";
import test from "node:test";

import jsQR from "jsqr";
import QRCode from "qrcode";

import { encodeTicket } from "./contract.js";

const TICKET = {
  v: 1,
  networkId: "testnet",
  contractId: "cynopom.testnet",
  eventId: "42",
  attendee: "alice.testnet",
  secret: "qr-roundtrip-secret_ABC-123",
};

function rasterizeQr(text, scale = 8, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const modules = qr.modules;
  const width = (modules.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  pixels.fill(255);

  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.data[row * modules.size + column]) continue;
      const startX = (column + quiet) * scale;
      const startY = (row + quiet) * scale;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const offset = ((startY + y) * width + startX + x) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
        }
      }
    }
  }

  return { width, pixels };
}

test("a GB1 ticket survives QR rendering and jsQR decoding", () => {
  const code = encodeTicket(TICKET);
  const { width, pixels } = rasterizeQr(code);
  const decoded = jsQR(pixels, width, width, { inversionAttempts: "dontInvert" });
  assert.ok(decoded, "the QR decoder returned no result");
  assert.equal(decoded.data, code);
});

test("a blank frame does not decode as a ticket", () => {
  const width = 320;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  assert.equal(jsQR(pixels, width, width), null);
});
