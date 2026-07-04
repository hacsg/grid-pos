//go:build windows

package printer

import (
	"fmt"
	"syscall"
	"unsafe"
)

var (
	winspool             = syscall.NewLazyDLL("winspool.drv")
	procOpenPrinterW     = winspool.NewProc("OpenPrinterW")
	procClosePrinter     = winspool.NewProc("ClosePrinter")
	procStartDocPrinterW = winspool.NewProc("StartDocPrinterW")
	procEndDocPrinter    = winspool.NewProc("EndDocPrinter")
	procStartPagePrinter = winspool.NewProc("StartPagePrinter")
	procEndPagePrinter   = winspool.NewProc("EndPagePrinter")
	procWritePrinter     = winspool.NewProc("WritePrinter")
	procGetDefaultPrnW   = winspool.NewProc("GetDefaultPrinterW")
)

type docInfo1 struct {
	docName    *uint16
	outputFile *uint16
	datatype   *uint16
}

// DefaultPrinterName returns the Windows default printer (e.g. "POS58 Printer").
func DefaultPrinterName() (string, error) {
	var n uint32
	_, _, _ = procGetDefaultPrnW.Call(0, uintptr(unsafe.Pointer(&n)))
	if n == 0 {
		return "", fmt.Errorf("no default printer configured")
	}
	buf := make([]uint16, n)
	r, _, err := procGetDefaultPrnW.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n)))
	if r == 0 {
		return "", fmt.Errorf("GetDefaultPrinter: %w", err)
	}
	return syscall.UTF16ToString(buf), nil
}

// PrintRaw spools payload to the named printer with datatype RAW, so ESC/POS
// bytes reach the device untouched by the driver's renderer. Empty name means
// the Windows default printer.
func PrintRaw(name string, payload []byte) error {
	if len(payload) == 0 {
		return fmt.Errorf("empty payload")
	}
	if name == "" {
		var err error
		if name, err = DefaultPrinterName(); err != nil {
			return err
		}
	}
	name16, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	var h syscall.Handle
	if r, _, callErr := procOpenPrinterW.Call(uintptr(unsafe.Pointer(name16)), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		return fmt.Errorf("OpenPrinter %q: %w", name, callErr)
	}
	defer procClosePrinter.Call(uintptr(h))

	docName, _ := syscall.UTF16PtrFromString("Grid POS receipt")
	datatype, _ := syscall.UTF16PtrFromString("RAW")
	doc := docInfo1{docName: docName, datatype: datatype}
	if r, _, callErr := procStartDocPrinterW.Call(uintptr(h), 1, uintptr(unsafe.Pointer(&doc))); r == 0 {
		return fmt.Errorf("StartDocPrinter: %w", callErr)
	}
	defer procEndDocPrinter.Call(uintptr(h))
	if r, _, callErr := procStartPagePrinter.Call(uintptr(h)); r == 0 {
		return fmt.Errorf("StartPagePrinter: %w", callErr)
	}
	defer procEndPagePrinter.Call(uintptr(h))

	var written uint32
	r, _, callErr := procWritePrinter.Call(uintptr(h), uintptr(unsafe.Pointer(&payload[0])), uintptr(len(payload)), uintptr(unsafe.Pointer(&written)))
	if r == 0 {
		return fmt.Errorf("WritePrinter: %w", callErr)
	}
	if int(written) != len(payload) {
		return fmt.Errorf("WritePrinter wrote %d of %d bytes", written, len(payload))
	}
	return nil
}
