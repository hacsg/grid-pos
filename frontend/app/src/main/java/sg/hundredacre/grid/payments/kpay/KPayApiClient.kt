package sg.hundredacre.grid.payments.kpay

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher

private const val TAG = "KPayApiClient"
private const val SUCCESS_CODE = 10000
private const val ERROR_INVALID_KEY = 40004 // keys expired after settlement, need re-signin

/**
 * Top level response wrapper for KPay APIs.
 */
data class KPayResponse<T>(
    val code: Int,
    val data: T? = null,
    val msg: String? = null
)

/** Sign-in response data. */
data class KPaySignInData(
    val platformPublicKey: String,
    val appPrivateKey: String
)

/** Sales / payment response (data usually empty on immediate ack). */
data class KPaySalesData(
    val outTradeNo: String? = null
)

/** Query response data. */
data class KPayQueryData(
    val outTradeNo: String? = null,
    val transactionNo: String? = null,
    val payAmount: String? = null,
    val payCurrency: String? = null,
    val payMethod: Int? = null,        // 1=Visa,2=MC,3=UnionPay,4=WeChat,5=Alipay,10=PayNow
    val transactionType: Int? = null,  // 1=Consumption,2=Return,6=Cancel
    val payResult: Int? = null,        // -1=timeout, 1=pending, 2=success, 3=failed
    val payTime: String? = null
)

/** Generic data for cancel / refund / settlement responses (often minimal). */
data class KPaySimpleData(
    val outTradeNo: String? = null,
    val transactionNo: String? = null
)

/**
 * KPay POS LAN API client for WiFi/POS mode.
 * Handles signing, key management, and all core endpoints.
 */
class KPayApiClient(
    private val credentials: KPayCredentials = KPayCredentials.STAGING
) {
    private val baseUrl: String by lazy {
        "http://${credentials.terminalIp.trim()}:18080"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(75, TimeUnit.SECONDS)   // sales can take up to 65s+
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val gson = com.google.gson.Gson()

    // In-memory working keys from sign-in
    @Volatile
    private var platformPublicKey: String? = null
    @Volatile
    private var appPrivateKey: String? = null

    val isSignedIn: Boolean
        get() = appPrivateKey != null && platformPublicKey != null

    /**
     * Perform sign-in. Must be called before signed operations.
     * Keys are stored internally for subsequent calls.
     */
    suspend fun signIn(): KPayResponse<KPaySignInData> = withContext(Dispatchers.IO) {
        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val body = mapOf(
            "appId" to credentials.appId,
            "appSecret" to credentials.appSecret
        )
        val json = gson.toJson(body)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/sign")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .build()

        try {
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string().orEmpty()
            val raw = parseResponse<Any>(responseBody)

            val data = if (raw.code == SUCCESS_CODE && raw.data != null) {
                val map = raw.data as? Map<*, *> ?: emptyMap<Any, Any>()
                val signData = KPaySignInData(
                    platformPublicKey = map["platformPublicKey"] as? String ?: "",
                    appPrivateKey = map["appPrivateKey"] as? String ?: ""
                )
                if (signData.platformPublicKey.isNotBlank() && signData.appPrivateKey.isNotBlank()) {
                    platformPublicKey = signData.platformPublicKey
                    appPrivateKey = signData.appPrivateKey
                    Log.i(TAG, "Sign-in successful. Keys stored.")
                }
                signData
            } else {
                Log.e(TAG, "Sign-in failed: code=${raw.code} msg=${raw.msg}")
                null
            }
            KPayResponse(code = raw.code, data = data, msg = raw.msg)
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in exception", e)
            KPayResponse(code = -1, msg = e.message)
        }
    }

    /**
     * Initiate a sales / payment transaction.
     */
    suspend fun sales(
        outTradeNo: String,
        amountCents: Long,
        paymentType: Long = 1, // 1=card, 3=QR reverse, 13=PayNow forward, 14=Alipay, 15=WeChat
        callbackUrl: String? = null,
        memberCode: String? = null,
        includeReceipt: Boolean = false,
        qrCodeContent: String? = null
    ): KPayResponse<KPaySalesData> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val bodyMap = mutableMapOf<String, Any>(
            "outTradeNo" to outTradeNo,
            "payAmount" to formatAmount(amountCents),
            "payCurrency" to "702", // SGD
            "paymentType" to paymentType
        )
        callbackUrl?.let { bodyMap["callbackUrl"] = it }
        memberCode?.let { bodyMap["memberCode"] = it }
        bodyMap["includeReceipt"] = includeReceipt
        qrCodeContent?.let { bodyMap["qrCodeContent"] = it }

        val json = gson.toJson(bodyMap)
        val signature = buildAndSign("POST", "/v2/pos/sales", timestamp, nonce, json)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/sales")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        executeSignedRequest<KPaySalesData>(request, json)
    }

    /**
     * Query a transaction by outTradeNo.
     */
    suspend fun query(outTradeNo: String): KPayResponse<KPayQueryData> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()
        val path = "/v2/pos/query?outTradeNo=$outTradeNo"
        val signature = buildAndSign("GET", path, timestamp, nonce, bodyJson = null)

        val request = Request.Builder()
            .url("$baseUrl$path")
            .get()
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        val rawResp = executeSignedRequest<Any>(request, bodyForSig = "")
        mapToQueryResponse(rawResp, outTradeNo)
    }

    private fun mapToQueryResponse(raw: KPayResponse<Any>, fallbackOutTradeNo: String): KPayResponse<KPayQueryData> {
        if (raw.code != SUCCESS_CODE || raw.data == null) {
            @Suppress("UNCHECKED_CAST")
            return KPayResponse(code = raw.code, msg = raw.msg) as KPayResponse<KPayQueryData>
        }
        return try {
            val map = raw.data as? Map<*, *> ?: emptyMap<Any, Any>()
            val data = KPayQueryData(
                outTradeNo = (map["outTradeNo"] ?: map["outTradeNO"] ?: fallbackOutTradeNo) as? String,
                transactionNo = map["transactionNo"] as? String,
                payAmount = map["payAmount"] as? String,
                payCurrency = map["payCurrency"] as? String,
                payMethod = (map["payMethod"] as? Number)?.toInt(),
                transactionType = (map["transactionType"] as? Number)?.toInt(),
                payResult = (map["payResult"] as? Number)?.toInt(),
                payTime = map["payTime"] as? String
            )
            KPayResponse(code = raw.code, data = data, msg = raw.msg)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to map query data, returning raw", e)
            @Suppress("UNCHECKED_CAST")
            KPayResponse(code = raw.code, data = null, msg = raw.msg) as KPayResponse<KPayQueryData>
        }
    }

    /**
     * Cancel / void a transaction.
     * managerPassword must be RSA-encrypted using platformPublicKey.
     */
    suspend fun cancel(
        outTradeNo: String,
        originOutTradeNo: String,
        callbackUrl: String? = null,
        includeReceipt: Boolean = false
    ): KPayResponse<KPaySimpleData> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val platformKey = platformPublicKey ?: return@withContext KPayResponse(code = -1, msg = "No platform key")
        val encryptedPwd = rsaEncryptWithPublicKey(credentials.managerPassword, platformKey)

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val bodyMap = mutableMapOf<String, Any>(
            "outTradeNo" to outTradeNo,
            "originOutTradeNo" to originOutTradeNo,
            "managerPassword" to encryptedPwd
        )
        callbackUrl?.let { bodyMap["callbackUrl"] = it }
        bodyMap["includeReceipt"] = includeReceipt

        val json = gson.toJson(bodyMap)
        val signature = buildAndSign("POST", "/v2/pos/sales/cancel", timestamp, nonce, json)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/sales/cancel")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        executeSignedRequest<KPaySimpleData>(request, json)
    }

    /**
     * Refund a transaction.
     */
    suspend fun refund(
        outTradeNo: String,
        refundType: Int = 1, // 1=card, 2=QR
        refNo: String? = null,            // for card
        transactionNo: String? = null,    // for QR
        commitTime: String? = null,       // original tx time if required
        refundAmount: String,             // 12-digit padded
        callbackUrl: String? = null,
        includeReceipt: Boolean = false
    ): KPayResponse<KPaySimpleData> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val platformKey = platformPublicKey ?: return@withContext KPayResponse(code = -1, msg = "No platform key")
        val encryptedPwd = rsaEncryptWithPublicKey(credentials.managerPassword, platformKey)

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val bodyMap = mutableMapOf<String, Any>(
            "outTradeNo" to outTradeNo,
            "refundType" to refundType,
            "refundAmount" to refundAmount,
            "managerPassword" to encryptedPwd
        )
        refNo?.let { bodyMap["refNo"] = it }
        transactionNo?.let { bodyMap["transactionNo"] = it }
        commitTime?.let { bodyMap["commitTime"] = it }
        callbackUrl?.let { bodyMap["callbackUrl"] = it }
        bodyMap["includeReceipt"] = includeReceipt

        val json = gson.toJson(bodyMap)
        val signature = buildAndSign("POST", "/v2/pos/sales/refund", timestamp, nonce, json)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/sales/refund")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        executeSignedRequest<KPaySimpleData>(request, json)
    }

    /**
     * Perform settlement. After this, keys become invalid and sign-in is required again.
     */
    suspend fun settlement(
        settlementReceipt: Boolean = true,
        detailsReceipt: Boolean = true,
        autoSignIn: Boolean = false
    ): KPayResponse<KPaySimpleData> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val bodyMap = mapOf(
            "settlementReceipt" to settlementReceipt,
            "detailsReceipt" to detailsReceipt,
            "autoSignIn" to autoSignIn
        )
        val json = gson.toJson(bodyMap)
        val signature = buildAndSign("POST", "/v2/pos/settlement", timestamp, nonce, json)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/settlement")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        val result = executeSignedRequest<KPaySimpleData>(request, json)
        // Keys are now invalid after settlement
        if (result.code == SUCCESS_CODE) {
            clearKeys()
        }
        result
    }

    /**
     * Print a custom receipt (steps-based).
     */
    suspend fun print(steps: List<Map<String, Any>>): KPayResponse<Any> = withContext(Dispatchers.IO) {
        ensureSignedIn()

        val timestamp = System.currentTimeMillis()
        val nonce = generateNonce()

        val bodyMap = mapOf("steps" to steps)
        val json = gson.toJson(bodyMap)
        val signature = buildAndSign("POST", "/v2/pos/print", timestamp, nonce, json)

        val request = Request.Builder()
            .url("$baseUrl/v2/pos/print")
            .post(json.toRequestBody("application/json; charset=utf-8".toMediaType()))
            .addHeader("appId", credentials.appId)
            .addHeader("timestamp", timestamp.toString())
            .addHeader("nonceStr", nonce)
            .addHeader("signature", signature)
            .build()

        executeSignedRequest<Any>(request, json)
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    private suspend fun <T> executeSignedRequest(
        request: Request,
        bodyForSig: String
    ): KPayResponse<T> {
        return try {
            val httpResponse = client.newCall(request).execute()
            val bodyStr = httpResponse.body?.string().orEmpty()
            val parsed = parseResponse<T>(bodyStr)

            if (parsed.code == ERROR_INVALID_KEY) {
                Log.w(TAG, "Received 40004 (invalid/expired key) — clearing keys for re-signin")
                clearKeys()
            }
            @Suppress("UNCHECKED_CAST")
            parsed as KPayResponse<T>
        } catch (e: Exception) {
            Log.e(TAG, "Request failed: ${request.url}", e)
            @Suppress("UNCHECKED_CAST")
            KPayResponse(code = -1, msg = e.message) as KPayResponse<T>
        }
    }

    private fun <T> parseResponse(body: String): KPayResponse<T> {
        return try {
            val jsonElement = com.google.gson.JsonParser.parseString(body)
            if (!jsonElement.isJsonObject) {
                @Suppress("UNCHECKED_CAST")
                return KPayResponse(code = -1, msg = "Bad response") as KPayResponse<T>
            }
            val obj = jsonElement.asJsonObject
            val code = obj.get("code")?.asInt ?: -1
            val msg = obj.get("msg")?.asString
            val dataEl = obj.get("data")

            // For sign-in / cases where we want typed data, we deserialize below at call sites when needed.
            // Here we keep loose and rely on callers using query with care.
            @Suppress("UNCHECKED_CAST")
            val data = if (dataEl != null && dataEl.isJsonObject) {
                gson.fromJson(dataEl, Any::class.java) as? T
            } else null

            KPayResponse(code = code, data = data, msg = msg)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse response: $body", e)
            @Suppress("UNCHECKED_CAST")
            KPayResponse(code = -1, msg = e.message) as KPayResponse<T>
        }
    }

    private fun ensureSignedIn() {
        if (!isSignedIn) {
            throw IllegalStateException("KPayApiClient not signed in. Call signIn() first.")
        }
    }

    private fun clearKeys() {
        platformPublicKey = null
        appPrivateKey = null
    }

    /**
     * Build the 5-line signature base string and sign it.
     */
    private fun buildAndSign(
        method: String,
        path: String,
        timestamp: Long,
        nonce: String,
        bodyJson: String?
    ): String {
        val privatePem = appPrivateKey ?: error("No appPrivateKey for signing")
        val privateKey = parsePrivateKey(privatePem)

        // POST/PUT: 5 lines (including body). GET: 4 lines (no body line).
        val toSign = buildString {
            append(method).append('\n')
            append(path).append('\n')
            append(timestamp).append('\n')
            append(nonce).append('\n')
            if (bodyJson != null) {
                append(bodyJson).append('\n')
            }
        }

        val signature = Signature.getInstance("SHA256withRSA")
        signature.initSign(privateKey)
        signature.update(toSign.toByteArray(Charsets.UTF_8))
        val sigBytes = signature.sign()
        return Base64.getEncoder().encodeToString(sigBytes)
    }

    private fun parsePrivateKey(pem: String): PrivateKey {
        val cleaned = normalizePem(pem)
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("\\s".toRegex(), "")
        val decoded = Base64.getDecoder().decode(cleaned)
        val spec = PKCS8EncodedKeySpec(decoded)
        return KeyFactory.getInstance("RSA").generatePrivate(spec)
    }

    private fun parsePublicKey(pem: String): PublicKey {
        val cleaned = normalizePem(pem)
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace("\\s".toRegex(), "")
        val decoded = Base64.getDecoder().decode(cleaned)
        val spec = X509EncodedKeySpec(decoded)
        return KeyFactory.getInstance("RSA").generatePublic(spec)
    }

    private fun normalizePem(pem: String): String {
        return pem
            .replace("\\u003d", "=")
            .replace("\\u003D", "=")
            .replace("\\n", "\n")
            .replace("\\r", "\r")
    }

    private fun rsaEncryptWithPublicKey(plainText: String, publicKeyPem: String): String {
        val pub = parsePublicKey(publicKeyPem)
        // Common for payment terminals: PKCS1 v1.5
        val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
        cipher.init(Cipher.ENCRYPT_MODE, pub)
        val encrypted = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(encrypted)
    }

    private fun formatAmount(amountCents: Long): String {
        return String.format("%012d", amountCents)
    }

    private fun generateNonce(): String {
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        val random = java.security.SecureRandom()
        return buildString(32) {
            repeat(32) {
                append(chars[random.nextInt(chars.length)])
            }
        }
    }

    /**
     * Force clear keys (e.g. after settlement or on error).
     */
    fun clearWorkingKeys() {
        clearKeys()
    }

    /**
     * Manually set keys (primarily for testing or recovery).
     */
    fun setWorkingKeys(appPriv: String, platformPub: String) {
        this.appPrivateKey = appPriv
        this.platformPublicKey = platformPub
    }
}
