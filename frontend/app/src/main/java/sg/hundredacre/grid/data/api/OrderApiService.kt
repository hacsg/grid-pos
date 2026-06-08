package sg.hundredacre.grid.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST
import sg.hundredacre.grid.data.models.Order
import sg.hundredacre.grid.data.models.OrderItem

// ──────────────────────────────────────────────
// Request / Response DTOs
// ──────────────────────────────────────────────

data class OrderRequest(
    val order_number: String,
    val total_amount: Double,
    val payment_method: String,
    val status: String,
    val staff_id: String,
    val created_at: Long,
    val items: List<OrderItemRequest>,
    val customer_id: String? = null
) {
    companion object {
        fun from(order: Order, items: List<OrderItem>, customerId: String? = null): OrderRequest {
            return OrderRequest(
                order_number = order.orderNumber,
                total_amount = order.totalAmount,
                payment_method = order.paymentMethod,
                status = order.status,
                staff_id = order.staffId,
                created_at = order.createdAt,
                items = items.map { OrderItemRequest.from(it) },
                customer_id = customerId
            )
        }
    }
}

data class OrderItemRequest(
    val product_name: String,
    val unit_price: Double,
    val quantity: Int,
    val modifier_name: String?
) {
    companion object {
        fun from(item: OrderItem): OrderItemRequest {
            return OrderItemRequest(
                product_name = item.productName,
                unit_price = item.unitPrice,
                quantity = item.quantity,
                modifier_name = item.modifierName
            )
        }
    }
}

data class OrderResponse(
    val id: Long?,
    val order_number: String,
    val message: String = ""
)

// ──────────────────────────────────────────────
// API Service Interface
// ──────────────────────────────────────────────

interface OrderApiService {

    @POST("api/orders")
    suspend fun createOrder(@Body request: OrderRequest): Response<OrderResponse>
}
