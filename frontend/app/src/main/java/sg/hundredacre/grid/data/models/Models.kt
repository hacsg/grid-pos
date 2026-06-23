package sg.hundredacre.grid.data.models

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "categories")
data class Category(
    @PrimaryKey val id: Long = 0,
    val name: String,
    val sortOrder: Int = 0
)

@Entity(
    tableName = "products",
    foreignKeys = [
        ForeignKey(
            entity = Category::class,
            parentColumns = ["id"],
            childColumns = ["categoryId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("categoryId")]
)
data class Product(
    @PrimaryKey val id: Long = 0,
    val name: String,
    val description: String = "",
    val price: Double,
    val imageUrl: String? = null,
    val categoryId: Long,
    val isSoldOut: Boolean = false,
    val isActive: Boolean = true
)

@Entity(tableName = "product_modifiers")
data class ProductModifier(
    @PrimaryKey val id: Long = 0,
    val productId: Long,
    val name: String,
    val priceAdjustment: Double = 0.0
)

@Entity(tableName = "cart_items")
data class CartItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val productId: Long,
    val productName: String,
    val unitPrice: Double,
    val quantity: Int,
    val modifierName: String? = null,
    val modifierPriceAdjustment: Double = 0.0
) {
    val totalPrice: Double get() = (unitPrice + modifierPriceAdjustment) * quantity
}

@Entity(tableName = "orders")
data class Order(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderNumber: String,
    val createdAt: Long = System.currentTimeMillis(),
    val totalAmount: Double,
    val paymentMethod: String = "",
    val status: String = "pending", // pending, paid, cancelled
    val staffId: String = ""
)

@Entity(
    tableName = "order_items",
    foreignKeys = [
        ForeignKey(
            entity = Order::class,
            parentColumns = ["id"],
            childColumns = ["orderId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("orderId")]
)
data class OrderItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderId: Long,
    val productName: String,
    val unitPrice: Double,
    val quantity: Int,
    val modifierName: String? = null
)

data class ProductWithModifiers(
    val product: Product,
    val modifiers: List<ProductModifier> = emptyList()
)