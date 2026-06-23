package sg.hundredacre.grid.payments.kpay

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import sg.hundredacre.grid.payments.PaymentAdapter
import sg.hundredacre.grid.payments.PaymentState
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.UUID
import kotlin.math.max

private const val TAG = "KPayTerminalAdapter"
private const val CALLBACK_TIMEOUT_MS = 65_000L
private const val QUERY_FALLBACK_TIMEOUT_MS = 15_000L
private const val POLL_INTERVAL_MS = 1500L
private const val MIN_REQUEST_INTERVAL_MS = 850L

/**
 * Real KPay LAN Terminal adapter for WiFi/POS mode.
 * Communicates with KPayPOS over the terminal's LAN IP.
 */
class KPayTerminalAdapter(
    private val credentials: KPayCredentials = KPayCredentials.STAGING
) : PaymentAdapter {

    override val providerName: String = "KPay (wired)"

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val _adapterState = MutableStateFlow<PaymentState>(PaymentState.Idle)
    private val apiClient = KPayApiClient(credentials)
    private val callbackServer = KPayCallbackServer(credentials.callbackPort)

    private var connected = false
    private var currentOutTradeNo: String? = null
    private var lastRequestTime = 0L

    override fun initialize(context: Context): Boolean {
        Log.i(TAG, "Initializing KPayTerminalAdapter (WiFi/POS LAN)")

        scope.launch {
            try {
                // Sign in first
                val signInResp = apiClient.signIn()
                if (signInResp.code != 10000 || signInResp.data == null) {
                    _adapterState.value = PaymentState.Error(
                        message = "KPay sign-in failed: ${signInResp.msg ?: signInResp.code}",
                        retryable = true
                    )
                    return@launch
                }

                // Start callback listener
                callbackServer.start()

                connected = true
                _adapterState.value = PaymentState.Ready
                Log.i(TAG, "KPayTerminalAdapter ready (signed in)")
            } catch (e: Exception) {
                Log.e(TAG, "KPay initialization failed", e)
                _adapterState.value = PaymentState.Error(
                    message = "KPay init error: ${e.message}",
                    retryable = true
                )
            }
        }

        return true
    }

    override fun collectPayment(amountCents: Long, currency: String): Flow<PaymentState> {
        val outTradeNo = generateOutTradeNo()
        currentOutTradeNo = outTradeNo

        scope.launch {
            _adapterState.value = PaymentState.Collecting
            Log.i(TAG, "Starting KPay sales: outTradeNo=$outTradeNo amount=$amountCents")

            rateLimitWait()

            val salesResp = try {
                apiClient.sales(
                    outTradeNo = outTradeNo,
                    amountCents = amountCents,
                    paymentType = 1, // default to card
                    callbackUrl = paymentCallbackUrl()
                )
            } catch (e: Exception) {
                Log.e(TAG, "sales() call failed", e)
                _adapterState.value = PaymentState.Error(
                    message = "Failed to start payment: ${e.message}",
                    retryable = true
                )
                return@launch
            }

            if (salesResp.code != 10000) {
                val retryable = salesResp.code != 40004
                _adapterState.value = PaymentState.Error(
                    message = salesResp.msg ?: "Payment start failed (code ${salesResp.code})",
                    retryable = retryable
                )
                return@launch
            }

            // Sales accepted — wait for callback or poll
            _adapterState.value = PaymentState.Processing

            val result = waitForPaymentResult(outTradeNo)

            when (result) {
                is PaymentResult.Success -> {
                    val methodName = mapPayMethod(result.payMethod)
                    val ref = result.transactionNo ?: result.outTradeNo ?: outTradeNo
                    _adapterState.value = PaymentState.Success(
                        reference = ref,
                        method = methodName
                    )
                    Log.i(TAG, "KPay payment SUCCESS: $ref ($methodName)")
                }
                is PaymentResult.Failed -> {
                    _adapterState.value = PaymentState.Error(
                        message = result.message,
                        retryable = result.retryable
                    )
                    Log.i(TAG, "KPay payment failed: ${result.message}")
                }
                is PaymentResult.Timeout -> {
                    _adapterState.value = PaymentState.Error(
                        message = "Payment timed out",
                        retryable = true
                    )
                }
                is PaymentResult.Cancelled -> {
                    _adapterState.value = PaymentState.Error(
                        message = "Payment cancelled",
                        retryable = false
                    )
                }
            }
        }

        return _adapterState.asStateFlow()
    }

    private suspend fun waitForPaymentResult(outTradeNo: String): PaymentResult {
        // 1. Listen to callback flow with timeout
        val callbackJob = kotlinx.coroutines.CompletableDeferred<PaymentResult?>()

        val collectorJob = scope.launch {
            try {
                withTimeoutOrNull(CALLBACK_TIMEOUT_MS) {
                    callbackServer.callbackFlow.collect { event ->
                        if (event is KPayCallbackServer.KPayCallbackEvent.PaymentResult) {
                            if (event.outTradeNo == outTradeNo || event.outTradeNo.isNullOrBlank()) {
                                val mapped = mapPayResultToPaymentResult(event)
                                if (mapped != null) {
                                    callbackJob.complete(mapped)
                                    return@collect
                                }
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // ignore
            }
            if (!callbackJob.isCompleted) {
                callbackJob.complete(null)
            }
        }

        val cbResult = withTimeoutOrNull(CALLBACK_TIMEOUT_MS) {
            callbackJob.await()
        }
        collectorJob.cancel()

        if (cbResult != null) {
            return cbResult
        }

        // 2. No callback — poll via query (respecting rate limit)
        Log.i(TAG, "No callback received, falling back to query for $outTradeNo")

        var lastQueryResult: PaymentResult? = null
        val deadline = System.currentTimeMillis() + QUERY_FALLBACK_TIMEOUT_MS

        while (System.currentTimeMillis() < deadline && scope.isActive) {
            rateLimitWait()

            val queryResp = try {
                apiClient.query(outTradeNo)
            } catch (e: Exception) {
                Log.w(TAG, "Query failed", e)
                delay(POLL_INTERVAL_MS)
                continue
            }

            if (queryResp.code == 10000 && queryResp.data != null) {
                val data = queryResp.data
                val payResult = data.payResult ?: 1

                val mapped = when (payResult) {
                    2 -> PaymentResult.Success(
                        outTradeNo = data.outTradeNo,
                        transactionNo = data.transactionNo,
                        payMethod = data.payMethod
                    )
                    3 -> PaymentResult.Failed("Payment failed (query)", retryable = true)
                    -1 -> PaymentResult.Timeout
                    else -> null // still pending
                }

                if (mapped != null) {
                    lastQueryResult = mapped
                    break
                }
            } else if (queryResp.code == 40004) {
                // keys expired — attempt re-sign and continue
                Log.w(TAG, "Query got 40004, attempting re-sign-in")
                try { apiClient.signIn() } catch (_: Exception) {}
            }

            delay(POLL_INTERVAL_MS)
        }

        return lastQueryResult ?: PaymentResult.Timeout
    }

    private fun mapPayResultToPaymentResult(event: KPayCallbackServer.KPayCallbackEvent.PaymentResult): PaymentResult? {
        return when (event.payResult) {
            2 -> PaymentResult.Success(
                outTradeNo = event.outTradeNo,
                transactionNo = event.transactionNo,
                payMethod = event.payMethod
            )
            3 -> PaymentResult.Failed("Payment declined/failed", retryable = true)
            -1 -> PaymentResult.Timeout
            1 -> null
            else -> PaymentResult.Failed("Unknown payResult: ${event.payResult}", retryable = true)
        }
    }

    override fun cancelPayment() {
        scope.launch {
            val tradeNo = currentOutTradeNo
            if (tradeNo != null && apiClient.isSignedIn) {
                try {
                    // Send a cancel request with a fresh outTradeNo for the cancel operation
                    val cancelTradeNo = generateOutTradeNo("CNL")
                    rateLimitWait()
                    apiClient.cancel(
                        outTradeNo = cancelTradeNo,
                        originOutTradeNo = tradeNo,
                        callbackUrl = paymentCallbackUrl()
                    )
                    Log.i(TAG, "Cancel request sent for $tradeNo")
                } catch (e: Exception) {
                    Log.w(TAG, "Cancel request failed", e)
                }
            }
            _adapterState.value = PaymentState.Error("Payment cancelled by user", retryable = false)
            currentOutTradeNo = null
        }
    }

    override fun disconnect() {
        scope.launch {
            try {
                callbackServer.stop()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping callback server", e)
            }
            connected = false
            currentOutTradeNo = null
            _adapterState.value = PaymentState.Idle
            Log.i(TAG, "KPayTerminalAdapter disconnected")
        }
    }

    override fun isConnected(): Boolean = connected && apiClient.isSignedIn

    override suspend fun refund(transactionRef: String, amountCents: Long): Flow<PaymentState> {
        scope.launch {
            _adapterState.value = PaymentState.Processing

            if (!apiClient.isSignedIn) {
                val sign = apiClient.signIn()
                if (sign.code != 10000) {
                    _adapterState.value = PaymentState.Error("Not signed in for refund", retryable = true)
                    return@launch
                }
            }

            rateLimitWait()
            val refundTradeNo = generateOutTradeNo("REF")
            val amountStr = String.format("%012d", amountCents)

            val resp = try {
                apiClient.refund(
                    outTradeNo = refundTradeNo,
                    refundType = 1,
                    transactionNo = transactionRef, // works for QR; for card caller should pass refNo
                    refundAmount = amountStr,
                    callbackUrl = paymentCallbackUrl()
                )
            } catch (e: Exception) {
                _adapterState.value = PaymentState.Error("Refund request error: ${e.message}", retryable = true)
                return@launch
            }

            if (resp.code == 10000) {
                // Wait for refund callback / query result similar to sales
                val result = waitForPaymentResult(refundTradeNo)
                when (result) {
                    is PaymentResult.Success -> {
                        _adapterState.value = PaymentState.Success(
                            reference = result.transactionNo ?: refundTradeNo,
                            method = "refund"
                        )
                    }
                    is PaymentResult.Failed -> {
                        _adapterState.value = PaymentState.Error(result.message, result.retryable)
                    }
                    else -> {
                        _adapterState.value = PaymentState.Error("Refund timed out or unknown", retryable = true)
                    }
                }
            } else {
                _adapterState.value = PaymentState.Error(
                    "Refund rejected: ${resp.msg ?: resp.code}",
                    retryable = resp.code != 40004
                )
            }
        }
        return _adapterState.asStateFlow()
    }

    override suspend fun void(transactionRef: String): Flow<PaymentState> {
        scope.launch {
            _adapterState.value = PaymentState.Processing

            if (!apiClient.isSignedIn) {
                val sign = apiClient.signIn()
                if (sign.code != 10000) {
                    _adapterState.value = PaymentState.Error("Not signed in for void", retryable = true)
                    return@launch
                }
            }

            rateLimitWait()
            val cancelTradeNo = generateOutTradeNo("VOD")

            val resp = try {
                apiClient.cancel(
                    outTradeNo = cancelTradeNo,
                    originOutTradeNo = transactionRef,
                    callbackUrl = paymentCallbackUrl()
                )
            } catch (e: Exception) {
                _adapterState.value = PaymentState.Error("Void request error: ${e.message}", retryable = true)
                return@launch
            }

            if (resp.code == 10000) {
                // Voids usually complete fast
                delay(800)
                _adapterState.value = PaymentState.Success(
                    reference = transactionRef,
                    method = "void"
                )
            } else {
                _adapterState.value = PaymentState.Error(
                    "Void rejected: ${resp.msg ?: resp.code}",
                    retryable = true
                )
            }
        }
        return _adapterState.asStateFlow()
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private fun generateOutTradeNo(prefix: String = "GP"): String {
        val ts = System.currentTimeMillis()
        val rand = UUID.randomUUID().toString().replace("-", "").take(8).uppercase()
        return "$prefix$ts$rand".take(32)
    }

    private suspend fun rateLimitWait() {
        val now = System.currentTimeMillis()
        val delta = now - lastRequestTime
        if (delta < MIN_REQUEST_INTERVAL_MS) {
            delay(max(0, MIN_REQUEST_INTERVAL_MS - delta))
        }
        lastRequestTime = System.currentTimeMillis()
    }

    private fun mapPayMethod(method: Int?): String = when (method) {
        1 -> "visa"
        2 -> "mastercard"
        3 -> "unionpay"
        4 -> "wechat"
        5 -> "alipay"
        10 -> "paynow"
        else -> "card"
    }

    private fun paymentCallbackUrl(): String {
        return "http://${detectLanHost()}:${credentials.callbackPort}/kpay/payment/callback"
    }

    private fun detectLanHost(): String {
        return try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                if (!networkInterface.isUp || networkInterface.isLoopback || networkInterface.isVirtual) {
                    continue
                }

                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val address = addresses.nextElement()
                    if (address is Inet4Address && !address.isLoopbackAddress) {
                        return address.hostAddress
                    }
                }
            }
            "127.0.0.1"
        } catch (e: Exception) {
            Log.w(TAG, "Failed to detect LAN IP for KPay callback", e)
            "127.0.0.1"
        }
    }

    private sealed class PaymentResult {
        data class Success(
            val outTradeNo: String?,
            val transactionNo: String?,
            val payMethod: Int?
        ) : PaymentResult()

        data class Failed(val message: String, val retryable: Boolean = true) : PaymentResult()
        object Timeout : PaymentResult()
        object Cancelled : PaymentResult()
    }

    /**
     * Cleanup for tests / long lived usage.
     */
    fun cleanup() {
        try { callbackServer.stop() } catch (_: Exception) {}
        scope.cancel()
    }
}
