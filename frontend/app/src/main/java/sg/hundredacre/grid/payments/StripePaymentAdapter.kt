package sg.hundredacre.grid.payments

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import sg.hundredacre.grid.data.api.CreatePaymentIntentRequest
import sg.hundredacre.grid.data.api.PaymentApiService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Payment adapter wrapping the existing [StripeTerminalManager].
 *
 * Maps Stripe-specific states ([TerminalState]) and operations into the
 * generic [PaymentState] flow consumed by the rest of the app.
 */
@Singleton
class StripePaymentAdapter @Inject constructor(
    private val stripeTerminalManager: StripeTerminalManager,
    private val paymentApiService: PaymentApiService
) : PaymentAdapter {

    override val providerName: String = "Stripe Tap to Pay"

    private val scope = CoroutineScope(Dispatchers.Main + kotlinx.coroutines.SupervisorJob())

    private val _adapterState = MutableStateFlow<PaymentState>(PaymentState.Idle)
    val adapterState = _adapterState.asStateFlow()

    override fun initialize(context: Context): Boolean {
        scope.launch {
            try {
                stripeTerminalManager.initialize()
            } catch (e: Exception) {
                _adapterState.value = PaymentState.Error(
                    message = "Stripe init failed: ${e.message}",
                    retryable = true
                )
            }
        }
        return true // Init is async; actual result comes via the state flow
    }

    override fun collectPayment(amountCents: Long, currency: String): Flow<PaymentState> {
        scope.launch {
            _adapterState.value = PaymentState.Collecting

            val result = stripeTerminalManager.collectPayment(
                amountCents = amountCents,
                createIntent = {
                    val response = paymentApiService.createPaymentIntent(
                        CreatePaymentIntentRequest(
                            amount = amountCents,
                            currency = currency
                        )
                    )
                    if (!response.isSuccessful) {
                        throw Exception(
                            "Failed to create PaymentIntent: ${response.code()} ${response.message()}"
                        )
                    }
                    response.body()!!
                }
            )

            when (result) {
                is PaymentResult.Success -> {
                    capturePaymentIntent(result.paymentIntentId)
                    _adapterState.value = PaymentState.Success(
                        reference = result.paymentIntentId,
                        method = "stripe_tap_to_pay"
                    )
                }
                is PaymentResult.Failure -> {
                    val retryable = when {
                        result.errorMessage.contains("cancelled", ignoreCase = true) -> false
                        result.errorMessage.contains("timed out", ignoreCase = true) -> true
                        else -> result.exception?.errorCode?.name != "CANCELED"
                    }
                    _adapterState.value = PaymentState.Error(
                        message = result.errorMessage,
                        retryable = retryable
                    )
                }
            }
        }

        return _adapterState.asStateFlow()
    }

    override fun cancelPayment() {
        scope.launch {
            stripeTerminalManager.cancelPayment()
            _adapterState.value = PaymentState.Idle
        }
    }

    override fun disconnect() {
        scope.launch {
            stripeTerminalManager.disconnect()
            _adapterState.value = PaymentState.Idle
        }
    }

    override fun isConnected(): Boolean {
        return stripeTerminalManager.terminalState.value is TerminalState.Ready
    }

    /**
     * Mirror the Stripe Terminal's internal state as generic [PaymentState] values
     * so consumers can observe it without depending on Stripe types.
     */
    fun observeTerminalState(): Flow<PaymentState> {
        return stripeTerminalManager.terminalState.map { terminalState ->
            when (terminalState) {
                is TerminalState.Uninitialized -> PaymentState.Idle
                is TerminalState.Initialized -> PaymentState.Idle
                is TerminalState.Ready -> PaymentState.Ready
                is TerminalState.Collecting -> PaymentState.Collecting
                is TerminalState.Processing -> PaymentState.Processing
                is TerminalState.Success -> _adapterState.value // Already handled
                is TerminalState.Error -> PaymentState.Error(
                    message = terminalState.message,
                    retryable = true
                )
                is TerminalState.Disconnected -> PaymentState.Idle
                is TerminalState.LowBattery -> PaymentState.Error(
                    message = "Reader battery is low",
                    retryable = true
                )
                is TerminalState.ReaderMessage -> PaymentState.Collecting
                is TerminalState.DisplayMessage -> PaymentState.Collecting
            }
        }
    }

    /**
     * Capture (settle) a previously authorized PaymentIntent on the backend.
     * Non-fatal if it fails — the payment is already confirmed via the Terminal SDK.
     */
    private suspend fun capturePaymentIntent(paymentIntentId: String) {
        try {
            paymentApiService.capturePaymentIntent(
                request = sg.hundredacre.grid.data.api.CapturePaymentRequest(
                    payment_intent_id = paymentIntentId
                )
            )
        } catch (e: Exception) {
            android.util.Log.w("StripePaymentAdapter", "Capture failed (non-fatal): ${e.message}")
        }
    }

    /**
     * Clean up the internal coroutine scope when the adapter is no longer needed.
     */
    fun cleanup() {
        scope.cancel()
    }
}