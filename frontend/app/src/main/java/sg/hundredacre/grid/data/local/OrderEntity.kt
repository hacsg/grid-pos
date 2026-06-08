package sg.hundredacre.grid.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import sg.hundredacre.grid.data.models.Order

/**
 * Sync-tracking entity linked to the main [Order] table via foreign key.
 * CASCADE delete means removing an Order also removes its sync tracker row.
 */
@Entity(
    tableName = "order_sync",
    foreignKeys = [
        ForeignKey(
            entity = Order::class,
            parentColumns = ["id"],
            childColumns = ["orderId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index("orderId"),
        Index("syncStatus")
    ]
)
data class OrderSyncEntity(
    @PrimaryKey val orderId: Long,
    val syncStatus: String = SyncStatus.PENDING,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

/** Constants for [OrderSyncEntity.syncStatus] values. */
object SyncStatus {
    const val PENDING = "pending"
    const val SYNCED = "synced"
    const val FAILED = "failed"
}