// Minimal base58 (Bitcoin alphabet) used for NEAR public keys.
// Dependency-free deliberately: auth code runs in the Node route handlers and must not
// pull a browser crypto bundle into the server build.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = new Map(Array.from(ALPHABET, (character, index) => [character, BigInt(index)]));

export function encodeBase58(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    encoded = `1${encoded}`;
  }
  return encoded;
}

export function decodeBase58(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("base58 value must be a non-empty string");
  }

  let value = 0n;
  for (const character of text) {
    const digit = DIGITS.get(character);
    if (digit === undefined) {
      throw new Error(`invalid base58 character: ${character}`);
    }
    value = value * 58n + digit;
  }

  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }

  let leadingZeros = 0;
  for (const character of text) {
    if (character !== "1") {
      break;
    }
    leadingZeros += 1;
  }

  return Uint8Array.from([...Array(leadingZeros).fill(0), ...bytes]);
}
