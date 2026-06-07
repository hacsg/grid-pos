package sg.hundredacre.grid.payments

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import sg.hundredacre.grid.data.local.PaymentPreferencesManager
import javax.inject.Inject
import javax.inject.Singleton

/**
 * UI-facing state for the payment flow.
 */
sealed class UiPaymentState {
    /** No payment in progress. Show payment options. */
    object Idle : UiPaymentState()

    /** Waiting for NFC tap, card read, or wired terminal interaction. */
    object Collecting : UiPaymentState()

    /** Payment collected, now processing/confirming. */
    object Processing : UiPaymentState()

    /** Payment succeeded. */
    data class Success(val paymentIntentId: String) : UiPaymentState()

    /** Payment failed. */
    data class Error(val message: String) : UiPaymentState()
}

/**
 * Repository that wraps the active [PaymentAdapter] and provides a clean
 * [UiPaymentState] Flow for the UI layer.
 *
 * The adapter can be swapped at runtime via [setProvider], enabling the user
 * to switch between Stripe Tap to Pay and wired KPay/HitPay terminals without
 * changing the order flow.
 *
 * Injected via Hilt as a @Singleton.
 */
@Singleton
class PaymentRepository @Inject constructor(
    private val application: Application,
    private val paymentAdapterFactory: PaymentAdapterFactory,
    private val paymentPreferencesManager: PaymentPreferencesManager
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val _paymentState = MutableStateFlow<UiPaymentState>(UiPaymentState.Idle)
    val paymentState: StateFlow<UiPaymentState> = _paymentState.asStateFlow()

    /** The currently active payment adapter. */
    private var currentAdapter: PaymentAdapter = paymentAdapterFactory.create(PaymentProvider.DEFAULT)

    /**
     * Initialize by loading the saved provider preference and swapping to it.
     * Called from the ViewModel on first launch.
     */
    suspend fun initialize() {
        val savedProvider = paymentPreferencesManager.paymentProviderFlow.first()
        setProviderSilent(savedProvider)
    }

    /**
     * Swap the active payment adapter at runtime.
     * Disconnects the old adapter and initializes the new one.
     *
     * @param provider The [PaymentProvider] to switch to.
     */
    fun setProvider(provider: PaymentProvider) {
        scope.launch {
            setProviderSilent(provider)
        }
    }

    /**
     * Internal: swap adapters without launching a scope (safe to call from suspend).
     */
    private suspend fun setProviderSilent(provider: PaymentProvider) {
        currentAdapter.disconnect()
        currentAdapter = paymentAdapterFactory.create(provider)
        currentAdapter.initialize(application)
    }

    /**
     * Process a payment for the given amount using the currently active adapter.
     *
     * @param amountCents Amount in cents (SGD). E.g. S$15.30 = 1530L.
     * @return Flow of [UiPaymentState] reflecting the lifecycle of this payment.
     */
    suspend fun processPayment(amountCents: Long): Flow<UiPaymentState> {
        _paymentState.value = UiPaymentState.Collecting

        // Collect from the adapter's flow and map to UI state
        currentAdapter.collectPayment(amountCents)
            .map { adapterState ->
                when (adapterState) {
                    is PaymentState.Collecting -> UiPaymentState.Collecting
                    is PaymentState.Processing -> UiPaymentState.Processing
                    is PaymentState.Success -> UiPaymentState.Success(adapterState.reference)
                    is PaymentState.Error -> UiPaymentState.Error(adapterState.message)
                    else -> _paymentState.value // Idle / Ready — keep current state
                }
            }
            .collect { uiState ->
                _paymentState.value = uiState
            }

        return _paymentState.asStateFlow()
    }

    /**
     * Cancel an in-progress payment.
     */
    fun cancelPayment() {
        currentAdapter.cancelPayment()
        _paymentState.value = UiPaymentState.Idle
    }

    /**
     * Reset the payment state back to idle.
     */
    fun resetState() {
        _paymentState.value = UiPaymentState.Idle
    }

    /**
     * Check whether the active adapter is connected.
     */
    fun isConnected(): Boolean = currentAdapter.isConnected()

    /**
     * Get the name of the currently active payment provider.
     */
    fun activeProviderName(): String = currentAdapter.providerName
}