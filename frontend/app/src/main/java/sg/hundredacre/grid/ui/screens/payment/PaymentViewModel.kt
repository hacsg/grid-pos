package sg.hundredacre.grid.ui.screens.payment

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import sg.hundredacre.grid.payments.PaymentRepository
import sg.hundredacre.grid.payments.PaymentState
import sg.hundredacre.grid.payments.StripeTerminalManager
import sg.hundredacre.grid.payments.TerminalState
import sg.hundredacre.grid.printing.PrintRepository
import javax.inject.Inject

/**
 * States for the receipt printing flow after payment success.
 */
sealed class PrintState {
    data object Idle : PrintState()
    data object Printing : PrintState()
    data object Success : PrintState()
    data class Failed(val errorMessage: String) : PrintState()
    data object NotAvailable : PrintState()
}

@HiltViewModel
class PaymentViewModel @Inject constructor(
    private val paymentRepository: PaymentRepository,
    private val stripeTerminalManager: StripeTerminalManager,
    private val printRepository: PrintRepository
) : ViewModel() {

    companion object {
        private const val TAG = "PaymentViewModel"
        private const val AUTO_ADVANCE_DELAY_MS = 5000L
    }

    val paymentState: StateFlow<PaymentState> = paymentRepository.paymentState
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = PaymentState.Idle
        )

    val terminalState: StateFlow<TerminalState> = stripeTerminalManager.terminalState
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = TerminalState.Uninitialized
        )

    private val _printState = MutableStateFlow<PrintState>(PrintState.Idle)
    val printState: StateFlow<PrintState> = _printState.asStateFlow()

    init {
        // Initialize Stripe Terminal SDK on first launch
        viewModelScope.launch {
            try {
                stripeTerminalManager.initialize()
            } catch (e: Exception) {
                Log.e(TAG, "Terminal init failed", e)
            }
        }
    }

    /**
     * Start processing a payment for the given amount.
     *
     * @param amountCents Amount in cents (SGD). E.g. S$15.30 = 1530L.
     */
    fun startPayment(amountCents: Long) {
        viewModelScope.launch {
            paymentRepository.processPayment(amountCents)
        }
    }

    /**
     * Cancel the current payment flow.
     */
    fun cancelPayment() {
        viewModelScope.launch {
            paymentRepository.cancelPayment()
            _printState.value = PrintState.Idle
        }
    }

    /**
     * Reset payment state back to idle.
     */
    fun resetState() {
        paymentRepository.resetState()
        _printState.value = PrintState.Idle
    }

    /**
     * Called by the UI when PaymentState.Success is displayed.
     * Triggers receipt printing, then auto-advances after completion.
     *
     * @param onAdvance Callback to navigate to the next screen (new order / menu).
     */
    fun onPaymentSuccess(onAdvance: () -> Unit) {
        viewModelScope.launch {
            // Check printer availability
            if (!printRepository.isPrinterAvailable()) {
                Log.w(TAG, "Sunmi printer not available — completing without receipt")
                _printState.value = PrintState.NotAvailable
                delay(2000)
                onAdvance()
                return@launch
            }

            // Attempt to print
            _printState.value = PrintState.Printing
            try {
                val success = printRepository.printTestReceipt()
                if (success) {
                    _printState.value = PrintState.Success
                    Log.i(TAG, "Receipt printed successfully")
                } else {
                    _printState.value = PrintState.Failed("Print failed — check printer")
                    Log.e(TAG, "Failed to print receipt")
                    return@launch // Don't auto-advance, let user retry or skip
                }
            } catch (e: Exception) {
                _printState.value = PrintState.Failed(
                    "Print error: ${e.localizedMessage ?: "Unknown"}"
                )
                Log.e(TAG, "Exception printing receipt", e)
                return@launch // Don't auto-advance, let user retry or skip
            }

            // Auto-advance after successful print
            delay(AUTO_ADVANCE_DELAY_MS)
            onAdvance()
        }
    }

    /**
     * Retry printing after a failure.
     */
    fun retryPrint(onAdvance: () -> Unit) {
        viewModelScope.launch {
            _printState.value = PrintState.Printing
            try {
                val success = printRepository.printTestReceipt()
                _printState.value = if (success) {
                    PrintState.Success
                } else {
                    PrintState.Failed("Print failed — check printer")
                }
            } catch (e: Exception) {
                _printState.value = PrintState.Failed(
                    "Print error: ${e.localizedMessage ?: "Unknown"}"
                )
            }
        }
    }

    /**
     * Skip printing and advance to new order.
     */
    fun skipPrintAndAdvance(onAdvance: () -> Unit) {
        _printState.value = PrintState.Idle
        onAdvance()
    }

    override fun onCleared() {
        super.onCleared()
        printRepository.cleanup()
    }
}