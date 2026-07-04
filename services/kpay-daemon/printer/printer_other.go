//go:build !windows

package printer

import "fmt"

// PrintRaw is Windows-only; the print service reports the error to the caller.
func PrintRaw(name string, payload []byte) error {
	return fmt.Errorf("raw printing is only supported on Windows")
}

// DefaultPrinterName is Windows-only.
func DefaultPrinterName() (string, error) {
	return "", fmt.Errorf("raw printing is only supported on Windows")
}
