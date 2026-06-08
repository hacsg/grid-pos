package sg.hundredacre.grid.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * DAO for the [OrderSyncEntity] table that tracks per-order sync status.
 *
 * Sync-aware helpers:
 * - [getPendingOrdersForSync] returns orders eligible for retry (pending + retryCount < 5)
 * - [countBySyncStatus] drives the UI connection indicator / offline banner
 */
@Dao
interface OrderSyncDao {

    // ── Read ──

    @Query("SELECT * FROM order_sync WHERE syncStatus = :status ORDER BY createdAt ASC")
    suspend fun getOrdersBySyncStatus(status: String): List<OrderSyncEntity>

    @Query("SELECT * FROM order_sync WHERE syncStatus = :status ORDER BY createdAt ASC")
    fun observeOrdersBySyncStatus(status: String): Flow<List<OrderSyncEntity>>

    @Query("SELECT COUNT(*) FROM order_sync WHERE syncStatus = :status")
    fun countBySyncStatus(status: String): Flow<Int>

    /**
     * Returns pending orders that haven't exhausted the max retry limit (5).
     * Ordered by fewest retries first, then oldest first.
     */
    @Query(
        """
        SELECT * FROM order_sync
        WHERE syncStatus = :status AND retryCount < :maxRetries
        ORDER BY retryCount ASC, createdAt ASC
        """
    )
    suspend fun getPendingOrdersForSync(
        status: String = SyncStatus.PENDING,
        maxRetries: Int = 5
    ): List<OrderSyncEntity>

    // ── Write ──

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(syncEntity: OrderSyncEntity)

    @Query(
        """
        UPDATE order_sync
        SET syncStatus = :status, retryCount = :retryCount, lastError = :lastError
        WHERE orderId = :orderId
        """
    )
    suspend fun updateSyncStatus(
        orderId: Long,
        status: String,
        retryCount: Int,
        lastError: String?
    )

    @Query("DELETE FROM order_sync WHERE orderId = :orderId")
    suspend fun delete(orderId: Long)

    @Query("DELETE FROM order_sync WHERE syncStatus = :status")
    suspend fun deleteAllByStatus(status: String)

    /** Mark all pending/failed records as synced (e.g. after full reconciliation). */
    @Query("UPDATE order_sync SET syncStatus = 'synced' WHERE syncStatus IN ('pending', 'failed')")
    suspend fun markAllSynced()
}