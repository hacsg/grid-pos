package sg.hundredacre.grid.payments

import sg.hundredacre.grid.payments.kpay.KPayCredentials
import sg.hundredacre.grid.payments.kpay.KPayTerminalAdapter

/**
 * Supported payment providers in Grid POS.
 *
 * - [STRIPE_TAP_TO_PAY]:  Stripe Terminal SDK — NFC Tap to Pay on Android.
 * - [KPAY_WIRED]:         KPay POS LAN (2-in-1 mode) on http://127.0.0.1:18080.
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
 * [KPayTerminalAdapter] is created for KPAY_WIRED with real LAN API client.
 * Other wired providers still use the placeholder [WiredTerminalAdapter].
 */
class PaymentAdapterFactory @javax.inject.Inject constructor(
    private val stripePaymentAdapter: StripePaymentAdapter,
    private val kpayCredentials: KPayCredentials
) {
    /**
     * Return the [PaymentAdapter] matching the given [provider].
     */
    fun create(provider: PaymentProvider): PaymentAdapter {
        return when (provider) {
            PaymentProvider.STRIPE_TAP_TO_PAY -> stripePaymentAdapter
            PaymentProvider.KPAY_WIRED -> KPayTerminalAdapter(credentials = kpayCredentials)
            PaymentProvider.HITPAY_WIRED -> WiredTerminalAdapter(
                providerLabel = provider.displayName,
                connectionType = WiredConnectionType.BLUETOOTH
            )
        }
    }
}