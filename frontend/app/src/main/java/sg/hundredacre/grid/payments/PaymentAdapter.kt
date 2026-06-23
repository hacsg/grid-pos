package sg.hundredacre.grid.payments

import android.content.Context
import kotlinx.coroutines.flow.Flow

/**
 * Generic state for a payment adapter's lifecycle.
 * Separated from the UI-facing [UiPaymentState] to allow the adapter layer
 * to communicate provider-agnostic progress without leaking terminal-specific details.
 */
sealed class PaymentState {
    /** Adapter initialized, no payment in progress. */
    object Idle : PaymentState()

    /** Adapter is connected and ready to accept payment requests. */
    object Ready : PaymentState()

    /** Payment collection is in progress (e.g. waiting for NFC tap / card read). */
    object Collecting : PaymentState()

    /** Payment has been collected and is being confirmed/processed. */
    object Processing : PaymentState()

    /** Payment succeeded. */
    data class Success(val reference: String, val method: String) : PaymentState()

    /** Payment failed. [retryable] indicates whether the operation can be retried. */
    data class Error(val message: String, val retryable: Boolean) : PaymentState()
}

/**
 * Abstraction for payment providers in Grid POS.
 *
 * Implementations wrap a concrete terminal SDK (Stripe Tap to Pay, KPay wired, HitPay wired, etc.)
 * and expose a uniform [Flow]-based API so the rest of the app never depends on a specific provider.
 */
interface PaymentAdapter {
    /** Human-readable name shown in settings & logs. */
    val providerName: String

    /**
     * Initialize the adapter. Called once from the Application or injection scope.
     * @param context Android application context.
     * @return true if initialization succeeded, false otherwise.
     */
    fun initialize(context: Context): Boolean

    /**
     * Collect a payment for the given amount and return a Flow of [PaymentState]
     * reflecting the lifecycle of the operation.
     *
     * @param amountCents Amount in cents (e.g. S$15.30 = 1530L).
     * @param currency ISO 4217 currency code (default: SGD).
     * @return Flow that emits [PaymentState] updates from [PaymentState.Collecting]
     *         through to [PaymentState.Success] or [PaymentState.Error].
     */
    fun collectPayment(amountCents: Long, currency: String = "SGD"): Flow<PaymentState>

    /**
     * Cancel an in-progress payment collection.
     */
    fun cancelPayment()

    /**
     * Disconnect from the terminal and release resources.
     */
    fun disconnect()

    /**
     * Check whether the adapter is currently connected to a terminal/reader.
     */
    fun isConnected(): Boolean

    /**
     * Refund a previous transaction.
     *
     * @param transactionRef The original transaction reference (transactionNo or outTradeNo).
     * @param amountCents Amount to refund in cents.
     */
    suspend fun refund(transactionRef: String, amountCents: Long): Flow<PaymentState>

    /**
     * Void/Cancel a previous transaction.
     *
     * @param transactionRef The original transaction reference.
     */
    suspend fun void(transactionRef: String): Flow<PaymentState>
}