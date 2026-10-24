/** Observed protocol facts; provenance and limits: docs/gen1-compatibility.md. */
export class Gen1Error extends Error {}

const MODEL = [0, 0, 0, 0x33];
export const identityRequest = (): number[] => [0xf0, 0x7e, 0x7f, 6, 1, 0xf7];

function sevenBit(bytes: readonly number[]): void {
  if (!bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 127))
    throw new Gen1Error('SysEx fields must contain integer 7-bit bytes.');
}

export function checksum(bytes: readonly number[]): number {
  sevenBit(bytes);
  return (128 - bytes.reduce((sum, b) => (sum + b) % 128, 0)) % 128;
}

function frame(command: number, address: readonly number[], data: readonly number[]): number[] {
  if (address.length !== 4 || !data.length) throw new Gen1Error('Invalid address or empty data.');
  sevenBit([...address, ...data]);
  return [0xf0, 0x41, 0, ...MODEL, command, ...address, ...data, checksum([...address, ...data]), 0xf7];
}

export function encodeRead(address: readonly number[], length: number): number[] {
  if (!Number.isInteger(length) || length < 1 || length > 2)
    throw new Gen1Error('Only evidenced one/two-byte reads are supported.');
  return frame(0x11, address, [0, 0, 0, length]);
}

/** Pure encoder; does not authorize sending a physical write. */
export function encodeData(address: readonly number[], data: readonly number[]): number[] {
  return frame(0x12, address, data);
}

export function decodeData(message: readonly number[], address: readonly number[], length: number): number {
  if (address.length !== 4 || (length !== 1 && length !== 2))
    throw new Gen1Error('Invalid expected DT1 address or length.');
  if (message.length !== 14 + length || message[0] !== 0xf0 || message.at(-1) !== 0xf7 ||
      message[1] !== 0x41 || message[2] !== 0 || message[7] !== 0x12 ||
      !MODEL.every((b, i) => message[3 + i] === b) ||
      !address.every((b, i) => message[8 + i] === b))
    throw new Gen1Error('Unexpected DT1 device, model, address or length; connection locked.');
  sevenBit(message.slice(2, -1));
  if (checksum(message.slice(8, -2)) !== message.at(-2))
    throw new Gen1Error('Invalid DT1 checksum; connection locked.');
  return message.slice(12, -2).reduce((value, b) => value * 128 + b, 0);
}

export function verifyIdentity(message: readonly number[]): void {
  // The observed family/member is NOT a unique KATANA-50 or firmware identifier.
  const prefix = [0xf0, 0x7e, 0, 6, 2, 0x41, 0x33, 3, 0, 0];
  if (message.length !== 15 || message.at(-1) !== 0xf7 ||
      !prefix.every((b, i) => message[i] === b))
    throw new Gen1Error('Unsupported MIDI identity; expected observed Roland 33 03 / 00 00 family.');
  sevenBit(message.slice(2, -1));
}
