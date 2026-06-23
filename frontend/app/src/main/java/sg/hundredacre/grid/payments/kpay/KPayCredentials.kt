package sg.hundredacre.grid.payments.kpay

import sg.hundredacre.grid.BuildConfig

/**
 * Credentials and LAN configuration for KPay POS integration.
 */
data class KPayCredentials(
    val appId: String = BuildConfig.KPAY_APP_ID,
    val appSecret: String = BuildConfig.KPAY_APP_SECRET,
    val managerPassword: String = "123456",
    val terminalIp: String = BuildConfig.KPAY_TERMINAL_IP,
    val callbackPort: Int = BuildConfig.KPAY_CALLBACK_PORT
) {
    companion object {
        /**
         * Staging credentials for WiFi/POS mode.
         */
        val STAGING = KPayCredentials()
    }
}
