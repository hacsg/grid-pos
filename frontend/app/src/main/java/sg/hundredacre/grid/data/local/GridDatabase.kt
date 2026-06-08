package sg.hundredacre.grid.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import sg.hundredacre.grid.data.models.CartItem
import sg.hundredacre.grid.data.models.Category
import sg.hundredacre.grid.data.models.Order
import sg.hundredacre.grid.data.models.OrderItem
import sg.hundredacre.grid.data.models.Product
import sg.hundredacre.grid.data.models.ProductModifier
import sg.hundredacre.grid.data.models.ShiftRecord

@Database(
    entities = [
        Category::class,
        Product::class,
        ProductModifier::class,
        CartItem::class,
        Order::class,
        OrderItem::class,
        ShiftRecord::class,
        OrderSyncEntity::class
    ],
    version = 3,
    exportSchema = true
)
abstract class GridDatabase : RoomDatabase() {
    abstract fun categoryDao(): CategoryDao
    abstract fun productDao(): ProductDao
    abstract fun cartDao(): CartDao
    abstract fun orderDao(): OrderDao
    abstract fun shiftDao(): ShiftDao
    abstract fun orderSyncDao(): OrderSyncDao
}