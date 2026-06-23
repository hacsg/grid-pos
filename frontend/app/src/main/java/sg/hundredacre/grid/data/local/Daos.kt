package sg.hundredacre.grid.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow
import sg.hundredacre.grid.data.models.Category
import sg.hundredacre.grid.data.models.Product
import sg.hundredacre.grid.data.models.ProductModifier

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories ORDER BY sortOrder ASC")
    fun getAllCategories(): Flow<List<Category>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(categories: List<Category>)

    @Delete
    suspend fun delete(category: Category)
}

@Dao
interface ProductDao {
    @Query("SELECT * FROM products WHERE isActive = 1 ORDER BY name ASC")
    fun getAllProducts(): Flow<List<Product>>

    @Query("SELECT * FROM products WHERE categoryId = :categoryId AND isActive = 1 ORDER BY name ASC")
    fun getProductsByCategory(categoryId: Long): Flow<List<Product>>

    @Query("SELECT * FROM products WHERE id = :productId")
    suspend fun getProductById(productId: Long): Product?

    @Query("SELECT * FROM product_modifiers WHERE productId = :productId")
    fun getModifiersForProduct(productId: Long): Flow<List<ProductModifier>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(products: List<Product>)

    @Update
    suspend fun update(product: Product)
}

@Dao
interface CartDao {
    @Query("SELECT * FROM cart_items")
    fun getCartItems(): Flow<List<sg.hundredacre.grid.data.models.CartItem>>

    @Query("SELECT * FROM cart_items")
    suspend fun getCartItemsList(): List<sg.hundredacre.grid.data.models.CartItem>

    @Query("SELECT COUNT(*) FROM cart_items")
    fun getCartItemCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(cartItem: sg.hundredacre.grid.data.models.CartItem)

    @Delete
    suspend fun delete(cartItem: sg.hundredacre.grid.data.models.CartItem)

    @Query("DELETE FROM cart_items")
    suspend fun clearCart()

    @Query("SELECT SUM((unitPrice + modifierPriceAdjustment) * quantity) FROM cart_items")
    fun getCartTotal(): Flow<Double?>
}

@Dao
interface OrderDao {
    @Query("SELECT * FROM orders ORDER BY createdAt DESC")
    fun getAllOrders(): Flow<List<sg.hundredacre.grid.data.models.Order>>

    @Insert
    suspend fun insertOrder(order: sg.hundredacre.grid.data.models.Order): Long

    @Insert
    suspend fun insertOrderItems(items: List<sg.hundredacre.grid.data.models.OrderItem>)

    @Query("SELECT * FROM order_items WHERE orderId = :orderId")
    fun getOrderItems(orderId: Long): Flow<List<sg.hundredacre.grid.data.models.OrderItem>>
}