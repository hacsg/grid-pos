package sg.hundredacre.grid.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import sg.hundredacre.grid.data.api.OrderApiService
import sg.hundredacre.grid.data.api.OrderRequest
import sg.hundredacre.grid.data.local.OrderDao
import sg.hundredacre.grid.data.local.OrderSyncDao
import sg.hundredacre.grid.data.local.SyncStatus
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker that pushes pending local orders to the backend API.
 *
 * Sync lifecycle per order:
 * 1. Worker fetches all PENDING orders where retryCount < 5
 * 2. For each order, loads the full [Order] + [OrderItem] data from Room
 * 3. Sends via POST /api/orders
 * 4. On success → marks SYNCED
 * 5. On failure → increments retryCount; if >= 5 marks FAILED, otherwise stays PENDING
 *
 * Exponential backoff is configured via [BackoffPolicy.EXPONENTIAL] on enqueue.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val orderSyncDao: OrderSyncDao,
    private val orderDao: OrderDao,
    private val orderApiService: OrderApiService
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        const val UNIQUE_WORK_NAME = "order_sync"
        const val KEY_RESULT = "sync_result"
        const val RESULT_SUCCESS = "success"
        const val RESULT_PARTIAL = "partial"
        const val RESULT_FAILED = "failed"

        /**
         * Enqueue a one-shot sync job. Uses [ExistingWorkPolicy.REPLACE] so that
         * rapid order creation collapses into a single work item.
         */
        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag("order_sync")
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    UNIQUE_WORK_NAME,
                    ExistingWorkPolicy.REPLACE,
                    request
                )
        }
    }

    override suspend fun doWork(): Result {
        val pendingOrders = orderSyncDao.getPendingOrdersForSync()
        if (pendingOrders.isEmpty()) {
            return Result.success(workDataOf(KEY_RESULT to RESULT_SUCCESS))
        }

        var anyFailure = false

        for (syncEntity in pendingOrders) {
            try {
                val order = orderDao.getOrderById(syncEntity.orderId)
                    ?: run {
                        // Order was deleted locally; remove sync tracker and skip
                        orderSyncDao.delete(syncEntity.orderId)
                        continue
                    }

                val items = orderDao.getOrderItemsList(syncEntity.orderId)
                val request = OrderRequest.from(order, items)

                val response = orderApiService.createOrder(request)

                if (response.isSuccessful) {
                    orderSyncDao.updateSyncStatus(
                        orderId = syncEntity.orderId,
                        status = SyncStatus.SYNCED,
                        retryCount = 0,
                        lastError = null
                    )
                } else {
                    val errorMsg = "HTTP ${response.code()}: ${response.errorBody()?.string() ?: "unknown"}"
                    throw SyncException(errorMsg)
                }
            } catch (e: Exception) {
                val newRetryCount = syncEntity.retryCount + 1
                if (newRetryCount >= 5) {
                    orderSyncDao.updateSyncStatus(
                        orderId = syncEntity.orderId,
                        status = SyncStatus.FAILED,
                        retryCount = newRetryCount,
                        lastError = e.message
                    )
                } else {
                    orderSyncDao.updateSyncStatus(
                        orderId = syncEntity.orderId,
                        status = SyncStatus.PENDING,
                        retryCount = newRetryCount,
                        lastError = e.message
                    )
                }
                anyFailure = true
            }
        }

        return if (anyFailure) {
            Result.retry()
        } else {
            Result.success(workDataOf(KEY_RESULT to RESULT_SUCCESS))
        }
    }
}

/** Internal exception type for sync failures. */
class SyncException(message: String, cause: Throwable? = null) : Exception(message, cause)