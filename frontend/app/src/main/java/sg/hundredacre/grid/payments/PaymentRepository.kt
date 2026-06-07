package sg.hundredacre.grid.payments

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import sg.hundredacre.grid.data.api.CreatePaymentIntentRequest
import sg.hundredacre.grid.data.api.PaymentApiService
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers

/**
 * UI-facing state for the payment flow.
 */
sealed class PaymentState {
    /** No payment in progress. Show payment options. */
    object Idle : PaymentState()

    /** Waiting for NFC tap or card read. */
    object Collecting : PaymentState()

    /** Payment collected, now processing/confirming. */
    object Processing : PaymentState()

    /** Payment succeeded. */
    data class Success(val paymentIntentId: String) : PaymentState()

    /** Payment failed. */
    data class Error(val message: String) : PaymentState()
}

/**
 * Repository that wraps [StripeTerminalManager] and provides a clean
 * [PaymentState] Flow for the UI layer.
 *
 * Injected via Hilt as a @Singleton.
 */
@Singleton
class PaymentRepository @Inject constructor(
    private val stripeTerminalManager: StripeTerminalManager,
    private val paymentApiService: PaymentApiService
) {
    private val _paymentState = MutableStateFlow<PaymentState>(PaymentState.Idle)
    val paymentState: StateFlow<PaymentState> = _paymentState.asStateFlow()

    /**
     * Expose the terminal's underlying connection state for monitoring.
     */
    val terminalState: StateFlow<TerminalState> = stripeTerminalManager.terminalState

    /**
     * Process a payment for the given amount.
     *
     * @param amountCents Amount in cents (SGD). E.g. S$15.30 = 1530L.
     * @return Flow of [PaymentState] reflecting the lifecycle of this payment.
     */
    suspend fun processPayment(amountCents: Long): Flow<PaymentState> {
        _paymentState.value = PaymentState.Collecting

        val result = stripeTerminalManager.collectPayment(
            amountCents = amountCents,
            createIntent = {
                val response = paymentApiService.createPaymentIntent(
                    CreatePaymentIntentRequest(
                        amount = amountCents,
                        currency = "SGD"
                    )
                )
                if (!response.isSuccessful) {
                    throw Exception("Failed to create PaymentIntent: ${response.code()} ${response.message()}")
                }
                response.body()!!
            }
        )

        when (result) {
            is PaymentResult.Success -> {
                // Optionally capture the payment intent on backend
                capturePaymentIntent(result.paymentIntentId)
                _paymentState.value = PaymentState.Success(result.paymentIntentId)
            }
            is PaymentResult.Failure -> {
                _paymentState.value = PaymentState.Error(result.errorMessage)
            }
        }

        return _paymentState.asStateFlow()
    }

    /**
     * Cancel an in-progress payment.
     */
    suspend fun cancelPayment() {
        stripeTerminalManager.cancelPayment()
        _paymentState.value = PaymentState.Idle
    }

    /**
     * Reset the payment state back to idle.
     */
    fun resetState() {
        _paymentState.value = PaymentState.Idle
    }

    /**
     * Capture (settle) a previously authorized PaymentIntent on the backend.
     */
    private suspend fun capturePaymentIntent(paymentIntentId: String) {
        try {
            paymentApiService.capturePaymentIntent(
                request = sg.hundredacre.grid.data.api.CapturePaymentRequest(
                    payment_intent_id = paymentIntentId
                )
            )
        } catch (e: Exception) {
            // Capture failure is non-fatal — the payment is already confirmed via Terminal
            android.util.Log.w("PaymentRepository", "Capture failed (non-fatal): ${e.message}")
        }
    }
}