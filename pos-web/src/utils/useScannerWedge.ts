import { useEffect, useRef } from 'react';

/**
 * Keyboard-wedge barcode/QR scanner support.
 *
 * Hardware 2D scanners (like the client-facing scanner on this POS) are NOT
 * cameras — they emulate a USB keyboard, "typing" the decoded text very fast
 * and ending with Enter. This hook captures that burst globally and fires
 * onScan with the decoded string, so scanning works without any camera.
 *
 * A timing heuristic separates a scanner burst (many chars, each arriving
 * within maxInterKeyMs) from a human typing into a field (slow): human
 * keystrokes reset the buffer, so their Enter falls through to the focused
 * input's own handler. A scanner's Enter is captured and consumed here.
 */
interface ScannerWedgeOptions {
  enabled: boolean;
  onScan: (code: string) => void;
  minLength?: number;
  maxInterKeyMs?: number;
}

export function useScannerWedge({
  enabled,
  onScan,
  minLength = 3,
  maxInterKeyMs = 60,
}: ScannerWedgeOptions): void {
  const bufferRef = useRef('');
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    bufferRef.current = '';

    function handleKeydown(event: KeyboardEvent) {
      // Ignore modifier combos (Ctrl/Alt/Meta) — scanners send plain keys.
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      const now = Date.now();
      const gap = now - lastTimeRef.current;
      lastTimeRef.current = now;

      if (event.key === 'Enter') {
        const code = bufferRef.current;
        bufferRef.current = '';
        if (code.length >= minLength) {
          // Consume the Enter so a focused input doesn't also submit it.
          event.preventDefault();
          event.stopPropagation();
          onScanRef.current(code);
        }
        return;
      }

      // A slow gap means this is human typing, not a scanner burst: restart.
      if (gap > maxInterKeyMs) {
        bufferRef.current = '';
      }
      if (event.key.length === 1) {
        bufferRef.current += event.key;
      }
    }

    window.addEventListener('keydown', handleKeydown, true);
    return () => window.removeEventListener('keydown', handleKeydown, true);
  }, [enabled, minLength, maxInterKeyMs]);
}
