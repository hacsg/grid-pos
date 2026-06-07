package sg.hundredacre.grid.payments

import android.content.Context
import android.hardware.usb.UsbManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.InputStream
import java.io.OutputStream

/**
 * Connection type for a wired terminal.
 */
enum class WiredConnectionType {
    USB,
    BLUETOOTH
}

/**
 * Protocol command / response format for KPay/HitPay wired terminals.
 *
 * POS app sends:  { "action": "pay", "amount": 1530, "currency": "SGD" }
 * Terminal sends: { "status": "success", "reference": "txn_123", "method": "card" }
 */
private const val TAG = "WiredTerminalAdapter"

/**
 * Payment adapter for USB/Bluetooth connected terminals (KPay, HitPay).
 *
 * CURRENTLY A SIMULATED PLACEHOLDER — returns success after a 2-second delay.
 *
 * Real implementation structure (ready for when actual API docs arrive):
 * - USB:  Use [UsbManager] to enumerate devices, claim interface, and
 *         communicate via [UsbDeviceConnection] bulk transfers.
 * - BT:   Use [android.bluetooth.BluetoothSocket] to send/receive JSON commands.
 *
 * @param providerLabel Human-readable name shown in settings (e.g. "KPay (wired)").
 * @param connectionType How the terminal is connected (USB or Bluetooth).
 */
class WiredTerminalAdapter(
    private val providerLabel: String,
    private val connectionType: WiredConnectionType = WiredConnectionType.USB
) : PaymentAdapter {

    override val providerName: String get() = providerLabel

    private val scope = CoroutineScope(Dispatchers.IO + Job())

    private val _adapterState = MutableStateFlow<PaymentState>(PaymentState.Idle)
    val adapterState = _adapterState.asStateFlow()

    // ------------------------------------------------------------------
    // Real implementation fields (unused in simulated mode)
    // ------------------------------------------------------------------
    private var usbManager: UsbManager? = null
    private var btInputStream: InputStream? = null
    private var btOutputStream: OutputStream? = null
    private var connected = false

    override fun initialize(context: Context): Boolean {
        Log.i(TAG, "[SIMULATED] Initializing $providerLabel ($connectionType)")

        if (connectionType == WiredConnectionType.USB) {
            usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
            // Real impl: enumerate usbManager.deviceList, find vendor ID matching KPay/HitPay,
            // request permission, claim interface, start bulk transfer listener
        }

        // Simulated: mark connected after a short delay
        scope.launch {
            delay(500)
            connected = true
            _adapterState.value = PaymentState.Ready
            Log.i(TAG, "[SIMULATED] $providerLabel ready")
        }

        return true
    }

    override fun collectPayment(amountCents: Long, currency: String): Flow<PaymentState> {
        scope.launch {
            _adapterState.value = PaymentState.Collecting
            Log.i(TAG, "[SIMULATED] Collecting payment: ${amountCents} $currency")

            // Simulated 2-second payment delay
            delay(2000)

            if (!isActive) return@launch

            // Simulated success
            _adapterState.value = PaymentState.Success(
                reference = "wired_${System.currentTimeMillis()}",
                method = when (connectionType) {
                    WiredConnectionType.USB -> "card"
                    WiredConnectionType.BLUETOOTH -> "paynow_qr"
                }
            )
            Log.i(TAG, "[SIMULATED] Payment succeeded")
        }

        return _adapterState.asStateFlow()
    }

    override fun cancelPayment() {
        scope.launch {
            Log.i(TAG, "[SIMULATED] Cancelling payment")
            _adapterState.value = PaymentState.Idle
        }
    }

    override fun disconnect() {
        scope.launch {
            Log.i(TAG, "[SIMULATED] Disconnecting $providerLabel")
            connected = false

            // Real impl:
            //   usbConnection?.releaseInterface()
            //   usbConnection?.close()
            //   btSocket?.close()

            _adapterState.value = PaymentState.Idle
        }
    }

    override fun isConnected(): Boolean = connected

    // ------------------------------------------------------------------
    // Placeholder structures for real implementation
    // ------------------------------------------------------------------

    /**
     * Send a payment command to the terminal over USB or Bluetooth.
     *
     * Real implementation outline:
     * ```
     * val command = """
     *   { "action": "pay", "amount": $amountCents, "currency": "$currency" }
     * """.trimIndent()
     * when (connectionType) {
     *     WiredConnectionType.USB -> {
     *         usbConnection?.bulkTransfer(endpointOut, command.toByteArray(), ...)
     *         // Read response via bulkTransfer on endpointIn
     *     }
     *     WiredConnectionType.BLUETOOTH -> {
     *         btOutputStream?.write(command.toByteArray())
     *         // Read response from btInputStream
     *     }
     * }
     * ```
     */
    @Suppress("unused")
    private suspend fun sendPaymentCommand(amountCents: Long, currency: String) {
        val command = """{"action":"pay","amount":$amountCents,"currency":"$currency"}"""
        Log.d(TAG, "Sending command: $command")
        // Real impl goes here when API docs are available
    }

    /**
     * Read and parse the terminal's response.
     *
     * Expected response format:
     * ```
     * { "status": "success", "reference": "txn_xxx", "method": "card" }
     * { "status": "failed",  "error": "Insufficient funds" }
     * ```
     */
    @Suppress("unused")
    private fun receiveResponse(): String? {
        // Real impl: read from input stream / USB bulk transfer, parse JSON
        return null
    }

    /**
     * Clean up resources when the adapter is no longer needed.
     */
    fun cleanup() {
        disconnect()
        scope.cancel()
    }
}