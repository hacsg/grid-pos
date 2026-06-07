package sg.hundredacre.grid.printing

object EscPosFormatter {

    // ESC/POS command constants
    private const val ESC = 0x1B
    private const val GS = 0x1D
    private const val LF = 0x0A

    /**
     * Format a complete receipt as ESC/POS byte commands.
     * 80mm paper = ~48 characters wide for regular text.
     */
    fun formatReceipt(receipt: ReceiptData): ByteArray {
        val bytes = mutableListOf<Byte>()

        // Initialize printer
        bytes.addAll(byteArrayOf(ESC.toByte(), 0x40.toByte()).toList()) // ESC @ - initialize

        // === HEADER ===
        bytes.addAll(centerAlign().toList())
        bytes.addAll(doubleSize(true).toList())
        bytes.addAll(bold(true).toList())
        bytes.addAll((receipt.outletName + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(doubleSize(false).toList())
        bytes.addAll(bold(false).toList())

        bytes.addAll(centerAlign().toList())
        bytes.addAll((receipt.orderNumber + "\n").toByteArray(Charsets.US_ASCII).toList())

        bytes.addAll(centerAlign().toList())
        bytes.addAll((receipt.outletAddress + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(centerAlign().toList())
        bytes.addAll(("Tel: " + receipt.outletPhone + "\n").toByteArray(Charsets.US_ASCII).toList())

        // Separator
        bytes.addAll(separator('=').toList())
        bytes.addAll(lineFeed().toList())

        // === ORDER INFO ===
        bytes.addAll(leftAlign().toList())
        bytes.addAll(bold(true).toList())
        bytes.addAll(("Order #" + receipt.orderNumber + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(bold(false).toList())
        bytes.addAll(("Date: " + receipt.formattedDate + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(("Staff: " + receipt.staffName + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(lineFeed().toList())

        // === ITEMS ===
        for (item in receipt.items) {
            // Item name and quantity on same line
            bytes.addAll(bold(true).toList())
            val itemLine = formatItemLine(item.name, item.quantity)
            bytes.addAll((itemLine + "\n").toByteArray(Charsets.US_ASCII).toList())
            bytes.addAll(bold(false).toList())

            // Modifiers indented
            if (item.modifiers.isNotEmpty()) {
                bytes.addAll(("  " + item.modifiers.joinToString(", ") + "\n").toByteArray(Charsets.US_ASCII).toList())
            }

            // Price right-aligned
            val priceLine = formatPriceLine(item.totalPrice)
            bytes.addAll((priceLine + "\n").toByteArray(Charsets.US_ASCII).toList())
        }

        bytes.addAll(lineFeed().toList())

        // === TOTAL ===
        bytes.addAll(separator('-').toList())
        bytes.addAll(lineFeed().toList())

        bytes.addAll(leftAlign().toList())
        bytes.addAll(bold(true).toList())
        val totalLine = formatTotalLine("Total", receipt.total)
        bytes.addAll((totalLine + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(bold(false).toList())

        bytes.addAll(separator('=').toList())
        bytes.addAll(lineFeed().toList())

        // === PAYMENT INFO ===
        bytes.addAll(leftAlign().toList())
        bytes.addAll(("Paid by: " + receipt.paymentMethod + "\n").toByteArray(Charsets.US_ASCII).toList())
        if (!receipt.paymentReference.isNullOrBlank()) {
            bytes.addAll(("Ref: " + receipt.paymentReference + "\n").toByteArray(Charsets.US_ASCII).toList())
        }
        bytes.addAll(lineFeed().toList())

        // === LOYALTY POINTS ===
        if (receipt.loyaltyPointsEarned != null) {
            bytes.addAll(("Earned: " + receipt.loyaltyPointsEarned + " points\n").toByteArray(Charsets.US_ASCII).toList())
        }
        if (receipt.loyaltyPointsBalance != null) {
            bytes.addAll(("Balance: " + receipt.loyaltyPointsBalance + " points\n").toByteArray(Charsets.US_ASCII).toList())
        }
        if (receipt.loyaltyPointsEarned != null || receipt.loyaltyPointsBalance != null) {
            bytes.addAll(lineFeed().toList())
        }

        // === FOOTER ===
        bytes.addAll(centerAlign().toList())
        bytes.addAll(("Thank you!\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(centerAlign().toList())
        bytes.addAll(("Follow us @hundredacrecreamery\n").toByteArray(Charsets.US_ASCII).toList())

        bytes.addAll(separator('=').toList())
        bytes.addAll(lineFeed(3).toList())

        // Cut paper
        bytes.addAll(cutPaper().toList())

        return bytes.toByteArray()
    }

    /**
     * Format a test receipt for printer testing.
     */
    fun formatTestReceipt(): ByteArray {
        val bytes = mutableListOf<Byte>()

        bytes.addAll(byteArrayOf(ESC.toByte(), 0x40.toByte()).toList()) // Initialize

        bytes.addAll(centerAlign().toList())
        bytes.addAll(doubleSize(true).toList())
        bytes.addAll(bold(true).toList())
        bytes.addAll("TEST PRINT\n".toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(doubleSize(false).toList())
        bytes.addAll(bold(false).toList())

        bytes.addAll(separator('=').toList())
        bytes.addAll(lineFeed().toList())

        bytes.addAll(leftAlign().toList())
        bytes.addAll("Printer: OK\n".toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll("Paper: OK\n".toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll("ESC/POS: Enabled\n".toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(lineFeed().toList())

        // Test character width
        bytes.addAll("Character width test:\n".toByteArray(Charsets.US_ASCII).toList())
        val fortyEight = "123456789012345678901234567890123456789012345678"
        bytes.addAll((fortyEight + "\n").toByteArray(Charsets.US_ASCII).toList())
        bytes.addAll(lineFeed().toList())

        bytes.addAll(centerAlign().toList())
        bytes.addAll("Print successful!\n".toByteArray(Charsets.US_ASCII).toList())

        bytes.addAll(separator('=').toList())
        bytes.addAll(lineFeed(3).toList())
        bytes.addAll(cutPaper().toList())

        return bytes.toByteArray()
    }

    // ========== ESC/POS Helpers ==========

    fun centerAlign(): ByteArray = byteArrayOf(ESC.toByte(), 0x61.toByte(), 0x01.toByte())

    fun leftAlign(): ByteArray = byteArrayOf(ESC.toByte(), 0x61.toByte(), 0x00.toByte())

    fun rightAlign(): ByteArray = byteArrayOf(ESC.toByte(), 0x61.toByte(), 0x02.toByte())

    fun bold(on: Boolean): ByteArray =
        byteArrayOf(ESC.toByte(), 0x45.toByte(), if (on) 0x01.toByte() else 0x00.toByte())

    fun doubleSize(on: Boolean): ByteArray =
        byteArrayOf(ESC.toByte(), 0x21.toByte(), if (on) 0x10.toByte() else 0x00.toByte())

    fun lineFeed(lines: Int = 1): ByteArray {
        return ByteArray(lines) { LF.toByte() }
    }

    fun cutPaper(): ByteArray = byteArrayOf(GS.toByte(), 0x56.toByte(), 0x00.toByte())

    fun separator(char: Char = '='): ByteArray {
        val line = buildString { repeat(48) { append(char) } }
        return (line + "\n").toByteArray(Charsets.US_ASCII)
    }

    // ========== Layout Helpers ==========

    /**
     * Format an item line with name on left and quantity on right.
     * Max width: 48 chars
     */
    private fun formatItemLine(name: String, quantity: Int): String {
        val qtyStr = "x$quantity"
        // Leave room for qtyStr + 2 spaces padding
        val maxNameLen = 46 - qtyStr.length
        val truncatedName = if (name.length > maxNameLen) name.take(maxNameLen - 1) + "…" else name
        val padding = " ".repeat(46 - truncatedName.length - qtyStr.length)
        return truncatedName + padding + qtyStr
    }

    /**
     * Format a price line with dollars right-aligned.
     */
    private fun formatPriceLine(price: Double): String {
        val priceStr = formatCurrency(price)
        val padding = " ".repeat(48 - priceStr.length)
        return padding + priceStr
    }

    /**
     * Format a total line with label on left and price on right.
     */
    private fun formatTotalLine(label: String, price: Double): String {
        val priceStr = formatCurrency(price)
        val padding = " ".repeat(48 - label.length - priceStr.length)
        return label + padding + priceStr
    }

    private fun formatCurrency(amount: Double): String {
        return "$${String.format("%.2f", amount)}"
    }
}