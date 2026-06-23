package sg.hundredacre.grid.data.repository

import kotlinx.coroutines.flow.Flow
import sg.hundredacre.grid.data.local.CartDao
import sg.hundredacre.grid.data.local.CategoryDao
import sg.hundredacre.grid.data.local.OrderDao
import sg.hundredacre.grid.data.local.ProductDao
import sg.hundredacre.grid.data.models.CartItem
import sg.hundredacre.grid.data.models.Category
import sg.hundredacre.grid.data.models.Order
import sg.hundredacre.grid.data.models.OrderItem
import sg.hundredacre.grid.data.models.Product
import sg.hundredacre.grid.data.models.ProductModifier
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProductRepository @Inject constructor(
    private val productDao: ProductDao
) {
    fun getAllProducts(): Flow<List<Product>> = productDao.getAllProducts()

    fun getProductsByCategory(categoryId: Long): Flow<List<Product>> =
        productDao.getProductsByCategory(categoryId)

    suspend fun getProductById(productId: Long): Product? =
        productDao.getProductById(productId)

    fun getModifiersForProduct(productId: Long): Flow<List<ProductModifier>> =
        productDao.getModifiersForProduct(productId)
}

@Singleton
class CategoryRepository @Inject constructor(
    private val categoryDao: CategoryDao
) {
    fun getAllCategories(): Flow<List<Category>> = categoryDao.getAllCategories()
}

@Singleton
class CartRepository @Inject constructor(
    private val cartDao: CartDao
) {
    fun getCartItems(): Flow<List<CartItem>> = cartDao.getCartItems()

    fun getCartItemCount(): Flow<Int> = cartDao.getCartItemCount()

    fun getCartTotal(): Flow<Double?> = cartDao.getCartTotal()

    suspend fun addToCart(cartItem: CartItem) = cartDao.upsert(cartItem)

    suspend fun updateQuantity(cartItem: CartItem) = cartDao.upsert(cartItem)

    suspend fun removeItem(cartItem: CartItem) = cartDao.delete(cartItem)

    suspend fun clearCart() = cartDao.clearCart()
}

@Singleton
class OrderRepository @Inject constructor(
    private val orderDao: OrderDao
) {
    fun getAllOrders(): Flow<List<Order>> = orderDao.getAllOrders()

    suspend fun createOrder(order: Order, items: List<OrderItem>): Long {
        val orderId = orderDao.insertOrder(order)
        orderDao.insertOrderItems(items.map { it.copy(orderId = orderId) })
        return orderId
    }

    fun getOrderItems(orderId: Long): Flow<List<OrderItem>> =
        orderDao.getOrderItems(orderId)
}