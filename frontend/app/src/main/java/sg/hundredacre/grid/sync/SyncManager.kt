package sg.hundredacre.grid.sync

import android.content.Context
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import sg.hundredacre.grid.data.local.OrderSyncDao
import sg.hundredacre.grid.data.local.OrderSyncEntity
import sg.hundredacre.grid.data.local.SyncStatus
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Orchestrates the offline-first order sync lifecycle.
 *
 * Responsibilities:
 * - Tracks new orders locally and enqueues background sync via [SyncWorker]
 * - Exposes [syncState] as a [Flow] for the UI [ConnectionIndicator]
 * - Provides helpers for manual re-sync and diagnostics
 *
 * Conflict resolution policy (enforced by the sync flow, not this manager):
 * - **Server wins** for products / catalog (data is fetched on reconnect)
 * - **Client wins** for new orders (local copy is authoritative; server is append-only)
 */
@Singleton
class SyncManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val orderSyncDao: OrderSyncDao
) {

    // ── Connection state (to be wired to a real ConnectivityManager) ──
    private val _isOnline = MutableStateFlow(true)

    /** True when the device has network connectivity. */
    val isOnline: StateFlow<Boolean> = _isOnline

    /** Number of orders currently in PENDING or FAILED status. */
    val pendingCount: Flow<Int> = orderSyncDao.countBySyncStatus(SyncStatus.PENDING)

    /** Pre-combined UI state — drives [ConnectionIndicator]. */
    val syncState: Flow<SyncState> = combine(
        orderSyncDao.countBySyncStatus(SyncStatus.PENDING),
        isOnline
    ) { pending, online ->
        when {
            !online && pending > 0 -> SyncState.OfflinePending(pending)
            !online                 -> SyncState.Disconnected
            pending > 0             -> SyncState.Syncing(pending)
            else                    -> SyncState.Connected
        }
    }

    // ── Public API ──

    /**
     * Call after an order is inserted into Room. Inserts a sync tracker row
     * and enqueues a [SyncWorker] job.
     */
    suspend fun trackNewOrder(orderId: Long) {
        orderSyncDao.upsert(
            OrderSyncEntity(
                orderId = orderId,
                syncStatus = SyncStatus.PENDING
            )
        )
        enqueueSync()
    }

    /** Enqueue a one-shot sync attempt. Idempotent — collapses into one job. */
    fun enqueueSync() {
        SyncWorker.enqueue(context)
    }

    /** Update online/offline state from an external connectivity observer. */
    fun setOnline(online: Boolean) {
        _isOnline.value = online
        if (online) enqueueSync()
    }

    // ── Convenience queries ──

    /** Observe current pending/failed sync entities (for diagnostics/debug). */
    fun observePendingSyncEntities(): Flow<List<OrderSyncEntity>> =
        orderSyncDao.observeOrdersBySyncStatus(SyncStatus.PENDING)

    fun observeFailedSyncEntities(): Flow<List<OrderSyncEntity>> =
        orderSyncDao.observeOrdersBySyncStatus(SyncStatus.FAILED)

    /** Manually retry all failed orders. */
    suspend fun retryFailed() {
        val failed = orderSyncDao.getOrdersBySyncStatus(SyncStatus.FAILED)
        failed.forEach { entity ->
            orderSyncDao.updateSyncStatus(
                orderId = entity.orderId,
                status = SyncStatus.PENDING,
                retryCount = 0,
                lastError = null
            )
        }
        if (failed.isNotEmpty()) enqueueSync()
    }

    /** Clear all sync tracking records (e.g. after full re-sync from server). */
    suspend fun clearSyncHistory() {
        orderSyncDao.deleteAllByStatus(SyncStatus.SYNCED)
    }
}

/**
 * UI-ready representation of the current sync + network state.
 *
 * @see SyncManager.syncState
 * @see ConnectionIndicator
 */
sealed interface SyncState {
    /** Online, nothing pending — green dot. */
    data object Connected : SyncState

    /** Online, X orders still syncing — yellow dot. */
    data class Syncing(val pendingCount: Int) : SyncState

    /** Offline, X orders waiting — red dot + banner count. */
    data class OfflinePending(val pendingCount: Int) : SyncState

    /** Offline, nothing pending — red dot, no banner. */
    data object Disconnected : SyncState
}