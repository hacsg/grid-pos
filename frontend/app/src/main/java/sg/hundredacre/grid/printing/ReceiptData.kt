package sg.hundredacre.grid.printing

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

data class ReceiptData(
    val outletName: String,
    val outletAddress: String,
    val outletPhone: String,
    val orderNumber: String,
    val date: LocalDateTime,
    val staffName: String,
    val items: List<ReceiptItem>,
    val total: Double,
    val paymentMethod: String,
    val paymentReference: String?,
    val loyaltyPointsEarned: Int?,
    val loyaltyPointsBalance: Int?
) {
    val formattedDate: String
        get() = date.format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))
}

data class ReceiptItem(
    val name: String,
    val modifiers: List<String>,
    val quantity: Int,
    val unitPrice: Double,
    val totalPrice: Double
)