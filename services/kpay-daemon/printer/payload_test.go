package printer

import (
	"bytes"
	"testing"
)

func TestBuildPrintPayload(t *testing.T) {
	got := BuildPrintPayload("HAC 100¢")
	want := append([]byte{0x1b, 0x40}, []byte("HAC 100?\n\n\n\n")...)
	want = append(want, 0x1d, 0x56, 0x00)
	if !bytes.Equal(got, want) {
		t.Fatalf("payload mismatch\n got %v\nwant %v", got, want)
	}
}

func TestBuildDrawerPulsePayload(t *testing.T) {
	if got := BuildDrawerPulsePayload(0); !bytes.Equal(got, []byte{0x1b, 0x70, 0x00, 0x19, 0xfa}) {
		t.Fatalf("pin 0 payload: %v", got)
	}
	if got := BuildDrawerPulsePayload(1); !bytes.Equal(got, []byte{0x1b, 0x70, 0x01, 0x19, 0xfa}) {
		t.Fatalf("pin 1 payload: %v", got)
	}
	// Any non-zero pin clamps to 1 (ESC/POS pin 5).
	if got := BuildDrawerPulsePayload(7); got[2] != 1 {
		t.Fatalf("pin clamp: %v", got)
	}
}
