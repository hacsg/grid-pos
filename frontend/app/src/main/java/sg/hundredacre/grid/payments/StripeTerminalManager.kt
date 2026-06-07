package sg.hundredacre.grid.payments

import android.app.Application
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.TerminalException
import com.stripe.stripeterminal.callable.Callback
import com.stripe.stripeterminal.callable.DiscoveryListener
import com.stripe.stripeterminal.callable.PaymentIntentCallback
import com.stripe.stripeterminal.callable.ReaderCallback
import com.stripe.stripeterminal.callable.ReaderDisplayCallback
import com.stripe.stripeterminal.model.external.ConnectionStatus
import com.stripe.stripeterminal.model.external.DiscoveryConfiguration
import com.stripe.stripeterminal.model.external.PaymentIntent
import com.stripe.stripeterminal.model.external.PaymentIntentParameters
import com.stripe.stripeterminal.model.external.Reader
import com.stripe.stripeterminal.model.external.ReaderDisplayMessage
import com.stripe.stripeterminal.model.external.TapToPayDiscoveryConfiguration
import com.stripe.stripeterminal.model.external.TerminalStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import sg.hundredacre.grid.BuildConfig
import sg.hundredacre.grid.data.api.CreatePaymentIntentResponse
import sg.hundredacre.grid.data.api.PaymentApiService
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Result of a Stripe Terminal payment operation.
 */
sealed class PaymentResult {
    data class Success(val paymentIntentId: String, val status: String) : PaymentResult()
    data class Failure(val errorMessage: String, val exception: TerminalException? = null) : PaymentResult()
}

/**
 * Connection token provider that fetches tokens from the app's backend.
 */
class GridConnectionTokenProvider @Inject constructor(
    private val paymentApiService: PaymentApiService
) : com.stripe.stripeterminal.connectiontoken.ConnectionTokenProvider {

    override suspend fun fetchConnectionToken(): String {
        val response = paymentApiService.getConnectionToken(
            testMode = BuildConfig.STRIPE_TEST_MODE
        )
        if (!response.isSuccessful) {
            throw TerminalException(
                TerminalException.TerminalErrorCode.REQUEST_ERROR,
                "Failed to fetch connection token: ${response.code()}"
            )
        }
        return response.body()?.client_secret
            ?: throw TerminalException(
                TerminalException.TerminalErrorCode.REQUEST_ERROR,
                "Connection token response missing client_secret"
            )
    }
}

/**
 * Manages the Stripe Terminal SDK lifecycle and payment operations.
 * Handles connection token fetching, reader discovery, payment collection,
 * and payment confirmation for Tap to Pay on Android.
 */
@Singleton
class StripeTerminalManager @Inject constructor(
    private val application: Application,
    private val connectionTokenProvider: GridConnectionTokenProvider
) {
    private val terminalListener = object : com.stripe.stripeterminal.model.external.TerminalListener {
        override fun onUnexpectedReaderDisconnect(disconnectedReader: Reader) {
            _terminalState.value = TerminalState.Disconnected(
                "Reader disconnected unexpectedly: ${disconnectedReader.label}"
            )
        }

        override fun onReportAvailableUpdate(update: String) {
            // SDK update available — log or ignore
        }

        override fun onReportLowBatteryWarning() {
            _terminalState.value = TerminalState.LowBattery
        }

        override fun onReportReaderEvent(event: com.stripe.stripeterminal.model.external.ReaderEvent) {
            // Reader events (card inserted, removed, etc.)
        }

        override fun onReportReaderMessage(message: String) {
            _terminalState.value = TerminalState.ReaderMessage(message)
        }

        override fun onReportReaderDisplayMessage(displayMessage: ReaderDisplayMessage) {
            _terminalState.value = TerminalState.DisplayMessage(
                displayMessage.toString()
            )
        }
    }

    private val _terminalState = kotlinx.coroutines.flow.MutableStateFlow<TerminalState>(TerminalState.Uninitialized)
    val terminalState: kotlinx.coroutines.flow.StateFlow<TerminalState> = _terminalState

    private var connectedReader: Reader? = null

    /**
     * Initialize the Stripe Terminal SDK. Must be called once from Application.onCreate().
     */
    suspend fun initialize() = withContext(Dispatchers.Main) {
        if (Terminal.isInitialized()) {
            _terminalState.value = TerminalState.Ready
            return@withContext
        }
        try {
            Terminal.initTerminal(
                application,
                connectionTokenProvider,
                terminalListener
            )
            _terminalState.value = TerminalState.Initialized
            // Connect automatically if using Tap to Pay (simulated or real)
            connectForTapToPay()
        } catch (e: TerminalException) {
            _terminalState.value = TerminalState.Error(
                "Failed to initialize Terminal: ${e.message}"
            )
            throw e
        }
    }

    /**
     * Discover and connect to a Tap to Pay reader (simulated in test mode, real NFC in production).
     */
    private suspend fun connectForTapToPay(): Boolean = suspendCancellableCoroutine { continuation ->
        val config: DiscoveryConfiguration = TapToPayDiscoveryConfiguration(
            isSimulated = BuildConfig.STRIPE_TEST_MODE
        )

        Terminal.getInstance().discoverReaders(
            config = config,
            discoveryListener = object : DiscoveryListener {
                override fun onUpdateDiscoveredReaders(readers: MutableList<Reader>) {
                    if (readers.isNotEmpty()) {
                        // Found a reader — connect to the first one
                        val reader = readers.first()
                        Terminal.getInstance().connectToReader(
                            reader = reader,
                            callback = object : ReaderCallback {
                                override fun onSuccess(connectedReader: Reader) {
                                    this@StripeTerminalManager.connectedReader = connectedReader
                                    _terminalState.value = TerminalState.Ready
                                    continuation.resume(true) { /* cancelled */ }
                                }

                                override fun onFailure(e: TerminalException) {
                                    _terminalState.value = TerminalState.Error(
                                        "Failed to connect reader: ${e.message}"
                                    )
                                    continuation.resume(false) { /* cancelled */ }
                                }
                            }
                        )
                    }
                }
            },
            callback = object : Callback {
                override fun onSuccess() {
                    // Discovery started — wait for discovery listener
                }

                override fun onFailure(e: TerminalException) {
                    _terminalState.value = TerminalState.Error(
                        "Reader discovery failed: ${e.message}"
                    )
                    continuation.resume(false) { /* cancelled */ }
                }
            }
        )
    }

    /**
     * Collect a payment via NFC tap and confirm it.
     *
     * Flow:
     * 1. Create PaymentIntent via backend API
     * 2. Retrieve the PaymentIntent in the Terminal SDK
     * 3. Collect payment method (NFC tap)
     * 4. Confirm the PaymentIntent
     *
     * @param amountCents Amount in cents (e.g., S$15.30 = 1530L)
     * @param createIntent Suspended function that creates a PaymentIntent on the backend
     * @return PaymentResult indicating success or failure
     */
    suspend fun collectPayment(
        amountCents: Long,
        createIntent: suspend () -> CreatePaymentIntentResponse
    ): PaymentResult = withContext(Dispatchers.Main) {
        try {
            // 1. Create PaymentIntent on backend
            _terminalState.value = TerminalState.Collecting("Creating payment intent...")
            val intentResponse = createIntent()

            // 2. Retrieve PaymentIntent in Terminal SDK
            val paymentIntent = suspendCancellableCoroutine<PaymentIntent> { continuation ->
                Terminal.getInstance().retrievePaymentIntent(
                    clientSecret = intentResponse.client_secret,
                    callback = object : PaymentIntentCallback {
                        override fun onSuccess(paymentIntent: PaymentIntent) {
                            continuation.resume(paymentIntent) { /* cancelled */ }
                        }

                        override fun onFailure(e: TerminalException) {
                            continuation.resumeWithException(e)
                        }
                    }
                )
            }

            // 3. Set reader display to show amount
            _terminalState.value = TerminalState.Collecting("Tap your card or phone to pay")
            try {
                suspendCancellableCoroutine<Unit> { continuation ->
                    Terminal.getInstance().setReaderDisplay(
                        readerDisplay = object : com.stripe.stripeterminal.model.external.ReaderDisplay {
                            override val displayedReaderMessage: ReaderDisplayMessage?
                                get() = ReaderDisplayMessage.CHECK_AMOUNT
                        },
                        callback = object : ReaderDisplayCallback {
                            override fun onSuccess() {
                                continuation.resume(Unit) { /* cancelled */ }
                            }

                            override fun onFailure(e: TerminalException) {
                                continuation.resume(Unit) { /* ignore display failure */ }
                            }
                        }
                    )
                }
            } catch (_: Exception) {
                // Reader display is optional — continue
            }

            // 4. Collect payment method (NFC tap)
            _terminalState.value = TerminalState.Collecting("Waiting for NFC tap...")
            val collectedIntent = suspendCancellableCoroutine<PaymentIntent> { continuation ->
                Terminal.getInstance().collectPaymentMethod(
                    paymentIntent = paymentIntent,
                    callback = object : PaymentIntentCallback {
                        override fun onSuccess(collectedIntent: PaymentIntent) {
                            continuation.resume(collectedIntent) { /* cancelled */ }
                        }

                        override fun onFailure(e: TerminalException) {
                            continuation.resumeWithException(e)
                        }
                    }
                )
            }

            // 5. Confirm the PaymentIntent
            _terminalState.value = TerminalState.Processing
            val confirmedIntent = suspendCancellableCoroutine<PaymentIntent> { continuation ->
                Terminal.getInstance().confirmPaymentIntent(
                    paymentIntent = collectedIntent,
                    callback = object : PaymentIntentCallback {
                        override fun onSuccess(confirmed: PaymentIntent) {
                            continuation.resume(confirmed) { /* cancelled */ }
                        }

                        override fun onFailure(e: TerminalException) {
                            continuation.resumeWithException(e)
                        }
                    }
                )
            }

            // 6. Clear reader display
            try {
                Terminal.getInstance().clearReaderDisplay(
                    object : Callback {
                        override fun onSuccess() {}
                        override fun onFailure(e: TerminalException) {}
                    }
                )
            } catch (_: Exception) {
                // Non-critical
            }

            _terminalState.value = TerminalState.Success
            PaymentResult.Success(
                paymentIntentId = confirmedIntent.id ?: intentResponse.payment_intent_id,
                status = confirmedIntent.status?.name ?: "succeeded"
            )
        } catch (e: TerminalException) {
            val msg = when (e.errorCode) {
                TerminalException.TerminalErrorCode.CANCELED -> "Payment was cancelled"
                TerminalException.TerminalErrorCode.TIMEOUT -> "Payment timed out"
                TerminalException.TerminalErrorCode.INVALID_PARAMETER -> "Invalid payment parameters"
                else -> e.message ?: "Payment failed"
            }
            _terminalState.value = TerminalState.Error(msg)
            PaymentResult.Failure(msg, e)
        } catch (e: Exception) {
            val msg = e.message ?: "An unexpected error occurred"
            _terminalState.value = TerminalState.Error(msg)
            PaymentResult.Failure(msg)
        }
    }

    /**
     * Cancel an in-progress payment collection.
     */
    suspend fun cancelPayment() = withContext(Dispatchers.Main) {
        try {
            Terminal.getInstance().cancelCollectPaymentMethod(
                object : Callback {
                    override fun onSuccess() {
                        _terminalState.value = TerminalState.Ready
                    }

                    override fun onFailure(e: TerminalException) {
                        _terminalState.value = TerminalState.Error(
                            "Failed to cancel: ${e.message}"
                        )
                    }
                }
            )
        } catch (e: Exception) {
            _terminalState.value = TerminalState.Ready
        }
    }

    /**
     * Disconnect the reader and clean up resources.
     */
    suspend fun disconnect() = withContext(Dispatchers.Main) {
        try {
            connectedReader?.let {
                Terminal.getInstance().disconnectReader(
                    object : Callback {
                        override fun onSuccess() {
                            connectedReader = null
                            _terminalState.value = TerminalState.Disconnected("Disconnected by user")
                        }

                        override fun onFailure(e: TerminalException) {
                            // Force disconnect
                            connectedReader = null
                            _terminalState.value = TerminalState.Disconnected("Disconnected (forced)")
                        }
                    }
                )
            }
        } catch (_: Exception) {
            connectedReader = null
            _terminalState.value = TerminalState.Disconnected("Disconnected (forced)")
        }
    }
}

/**
 * Represents the state of the Stripe Terminal connection and operations.
 */
sealed class TerminalState {
    object Uninitialized : TerminalState()
    object Initialized : TerminalState()
    object Ready : TerminalState()
    data class Collecting(val message: String) : TerminalState()
    object Processing : TerminalState()
    object Success : TerminalState()
    data class Error(val message: String) : TerminalState()
    data class Disconnected(val reason: String) : TerminalState()
    object LowBattery : TerminalState()
    data class ReaderMessage(val message: String) : TerminalState()
    data class DisplayMessage(val message: String) : TerminalState()
}