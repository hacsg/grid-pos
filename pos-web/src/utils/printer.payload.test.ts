import { describe, expect, it } from 'vitest';
import {
  buildDrawerPulsePayload,
  buildPrintPayload,
  sanitizeAscii,
} from './printer';

describe('sanitizeAscii', () => {
  it('keeps printable ASCII', () => {
    expect(sanitizeAscii('Hello, world!')).toBe('Hello, world!');
  });

  it('replaces non-ASCII with ?', () => {
    expect(sanitizeAscii('café')).toBe('caf?');
  });
});

describe('buildPrintPayload', () => {
  it('prepends ESC @ init and appends GS V 0 cut', () => {
    const payload = buildPrintPayload('TEST');
    expect(Array.from(payload.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(payload.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
    const body = new TextDecoder().decode(payload.slice(2, -3));
    expect(body).toBe('TEST\n\n\n\n');
  });
});

describe('buildDrawerPulsePayload', () => {
  it('builds pin 0 pulse', () => {
    expect(Array.from(buildDrawerPulsePayload(0))).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it('builds pin 1 pulse', () => {
    expect(Array.from(buildDrawerPulsePayload(1))).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa]);
  });
});