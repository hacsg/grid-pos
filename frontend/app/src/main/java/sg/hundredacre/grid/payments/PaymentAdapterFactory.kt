package sg.hundredacre.grid.payments

/**
 * Supported payment providers in Grid POS.
 *
 * - [STRIPE_TAP_TO_PAY]:  Stripe Terminal SDK — NFC Tap to Pay on Android.
 * - [KPAY_WIRED]:         KPay wired terminal via USB or Bluetooth.
 * - [HITPAY_WIRED]:       HitPay wired terminal via USB or Bluetooth.
 */
enum class PaymentProvider(val displayName: String) {
    STRIPE_TAP_TO_PAY("Stripe Tap to Pay"),
    KPAY_WIRED("KPay (wired)"),
    HITPAY_WIRED("HitPay (wired)");

    companion object {
        /**
         * Default provider used when no user preference has been saved.
         * Kept as Stripe Tap to Pay for backward compatibility.
         */
        val DEFAULT: PaymentProvider = STRIPE_TAP_TO_PAY

        /**
         * Parse a provider from its stored string representation.
         * Falls back to [DEFAULT] if the name is unknown.
         */
        fun fromName(name: String): PaymentProvider {
            return entries.firstOrNull { it.name == name } ?: DEFAULT
        }
    }
}

/**
 * Factory that creates the appropriate [PaymentAdapter] for a given [PaymentProvider].
 *
 * [StripePaymentAdapter] is a Hilt singleton (wraps [StripeTerminalManager]).
 * [WiredTerminalAdapter] instances are created on demand with the correct label and
 * connection type — they are stateless placeholders until the real protocol is implemented.
 */
class PaymentAdapterFactory @javax.inject.Inject constructor(
    private val stripePaymentAdapter: StripePaymentAdapter
) {
    /**
     * Return the [PaymentAdapter] matching the given [provider].
     *
     * Stripe adapters are singletons shared across the app.
     * Wired terminal adapters are created fresh each time (they have no persistent state).
     */
    fun create(provider: PaymentProvider): PaymentAdapter {
        return when (provider) {
            PaymentProvider.STRIPE_TAP_TO_PAY -> stripePaymentAdapter
            PaymentProvider.KPAY_WIRED -> WiredTerminalAdapter(
                providerLabel = provider.displayName,
                connectionType = WiredConnectionType.USB
            )
            PaymentProvider.HITPAY_WIRED -> WiredTerminalAdapter(
                providerLabel = provider.displayName,
                connectionType = WiredConnectionType.BLUETOOTH
            )
        }
    }
}