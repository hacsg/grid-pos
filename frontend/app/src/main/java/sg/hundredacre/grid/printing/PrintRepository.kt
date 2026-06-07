package sg.hundredacre.grid.printing

import android.util.Log
import sg.hundredacre.grid.data.models.Order
import sg.hundredacre.grid.data.models.OrderItem
import sg.hundredacre.grid.data.repository.OrderRepository
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository that converts domain Order/OrderItem data into ReceiptData
 * and sends it to the Sunmi printer.
 */
@Singleton
class PrintRepository @Inject constructor(
    private val receiptPrinter: ReceiptPrinter
) {
    companion object {
        private const val TAG = "PrintRepository"
    }

    /**
     * Print a receipt for the given order.
     * Converts the order + order items to ReceiptData and calls the printer.
     *
     * @param order The completed order
     * @param orderItems The items in the order
     * @param staffName The staff member who processed the order
     * @param paymentReference Optional transaction reference/auth code
     * @param loyaltyPointsEarned Optional loyalty points earned
     * @param loyaltyPointsBalance Optional current loyalty points balance
     * @return true if print was sent successfully
     */
    fun printOrderReceipt(
        order: Order,
        orderItems: List<OrderItem>,
        staffName: String = "",
        paymentReference: String? = null,
        loyaltyPointsEarned: Int? = null,
        loyaltyPointsBalance: Int? = null
    ): Boolean {
        if (!receiptPrinter.isConnected() && !receiptPrinter.connect()) {
            Log.w(TAG, "Printer not available - skipping receipt")
            return false
        }

        val receiptItems = orderItems.map { item ->
            val modifiers = if (!item.modifierName.isNullOrBlank()) {
                item.modifierName.split(",").map { it.trim() }
            } else {
                emptyList()
            }

            ReceiptItem(
                name = item.productName,
                modifiers = modifiers,
                quantity = item.quantity,
                unitPrice = item.unitPrice,
                totalPrice = item.unitPrice * item.quantity
            )
        }

        val date = LocalDateTime.ofInstant(
            Instant.ofEpochMilli(order.createdAt),
            ZoneId.systemDefault()
        )

        val receiptData = ReceiptData(
            outletName = "HUNDRED ACRE CREAMERY",
            outletAddress = "29 Tiong Bahru Rd, #01-01\nTel: 6123 4567",
            outletPhone = "6123 4567",
            orderNumber = order.orderNumber,
            date = date,
            staffName = staffName,
            items = receiptItems,
            total = order.totalAmount,
            paymentMethod = formatPaymentMethod(order.paymentMethod),
            paymentReference = paymentReference,
            loyaltyPointsEarned = loyaltyPointsEarned,
            loyaltyPointsBalance = loyaltyPointsBalance
        )

        val success = receiptPrinter.printReceipt(receiptData)
        if (!success) {
            Log.e(TAG, "Failed to print receipt for order ${order.orderNumber}")
        }
        return success
    }

    /**
     * Print a test receipt to verify printer hardware.
     */
    fun printTestReceipt(): Boolean {
        return receiptPrinter.printTestReceipt()
    }

    /**
     * Check if the printer service is available on this device.
     */
    fun isPrinterAvailable(): Boolean {
        return receiptPrinter.isConnected() || receiptPrinter.connect()
    }

    /**
     * Clean up printer connection when no longer needed.
     */
    fun cleanup() {
        receiptPrinter.disconnect()
    }

    private fun formatPaymentMethod(method: String): String {
        return when (method.lowercase()) {
            "card" -> "Card (PayWave)"
            "qr", "paynow" -> "QR PayNow"
            "cash" -> "Cash"
            else -> method
        }
    }
}