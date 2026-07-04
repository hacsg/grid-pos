// Package printer sends raw ESC/POS bytes to the receipt printer through the
// Windows print spooler (datatype RAW), using the printer driver that Windows
// already has. This is the fallback for POS machines whose built-in printer is
// not reachable over WebUSB (e.g. internal serial wiring) — the browser calls
// the daemon's local HTTP print service instead.
package printer

// SanitizeASCII mirrors pos-web/src/utils/printer.ts sanitizeAscii: the ESC/POS
// default codepage garbles multi-byte characters, so anything outside printable
// ASCII (plus \n \r \t) becomes '?'.
func SanitizeASCII(text string) string {
	out := make([]byte, 0, len(text))
	for _, r := range text {
		switch {
		case r >= 0x20 && r <= 0x7e, r == '\n', r == '\r', r == '\t':
			out = append(out, byte(r))
		default:
			out = append(out, '?')
		}
	}
	return string(out)
}

// BuildPrintPayload mirrors pos-web buildPrintPayload: ESC @ init + sanitized
// text + feed + GS V 0 full cut.
func BuildPrintPayload(text string) []byte {
	body := SanitizeASCII(text) + "\n\n\n\n"
	payload := make([]byte, 0, len(body)+5)
	payload = append(payload, 0x1b, 0x40)
	payload = append(payload, body...)
	payload = append(payload, 0x1d, 0x56, 0x00)
	return payload
}

// BuildDrawerPulsePayload mirrors pos-web buildDrawerPulsePayload:
// ESC p <pin> 25 250 pulses the RJ11 drawer port on the receipt printer.
func BuildDrawerPulsePayload(pin byte) []byte {
	if pin != 0 {
		pin = 1
	}
	return []byte{0x1b, 0x70, pin, 0x19, 0xfa}
}
