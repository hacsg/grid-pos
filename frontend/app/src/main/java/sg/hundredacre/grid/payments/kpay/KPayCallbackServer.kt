package sg.hundredacre.grid.payments.kpay

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException

private const val TAG = "KPayCallbackServer"
private const val CALLBACK_BIND_HOST = "0.0.0.0"
private const val PAYMENT_PATH = "/kpay/payment/callback"
private const val FORWARD_PATH = "/kpay/forward/callback"
private const val ACTION_PATH = "/kpay/action/callback"
private const val MAX_HEADER_BYTES = 16 * 1024
private const val MAX_BODY_BYTES = 64 * 1024

private val CALLBACK_PATHS = setOf(PAYMENT_PATH, FORWARD_PATH, ACTION_PATH)

/**
 * Lightweight local callback server for KPay WiFi/POS mode.
 * Listens on all local interfaces so the KPayPOS terminal can reach it over LAN.
 *
 * Emits received payment results via [callbackFlow].
 */
class KPayCallbackServer(
    private val port: Int = KPayCredentials.STAGING.callbackPort
) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val gson = Gson()

    @Volatile
    private var server: ServerSocket? = null
    @Volatile
    private var started = false
    private var serverThread: Thread? = null

    private val _callbackFlow = MutableSharedFlow<KPayCallbackEvent>(extraBufferCapacity = 8)
    val callbackFlow: SharedFlow<KPayCallbackEvent> = _callbackFlow.asSharedFlow()

    /**
     * Start the HTTP server if not already running.
     * Safe to call multiple times.
     */
    fun start() {
        if (started) return

        try {
            val socket = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(CALLBACK_BIND_HOST, port))
            }

            server = socket
            started = true
            serverThread = Thread({ acceptLoop(socket) }, "kpay-callback").apply {
                isDaemon = true
                start()
            }
            Log.i(TAG, "KPay callback server started on $CALLBACK_BIND_HOST:$port")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start callback server", e)
            started = false
            server = null
        }
    }

    /**
     * Stop the server and release resources.
     */
    fun stop() {
        started = false
        try {
            server?.close()
            Log.i(TAG, "KPay callback server stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping callback server", e)
        } finally {
            server = null
            serverThread = null
        }
    }

    fun isRunning(): Boolean = started && server?.isClosed == false

    private fun acceptLoop(serverSocket: ServerSocket) {
        try {
            while (started && !serverSocket.isClosed) {
                try {
                    handleClient(serverSocket.accept())
                } catch (e: SocketException) {
                    if (started) {
                        Log.w(TAG, "Callback socket error", e)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Callback accept error", e)
                }
            }
        } finally {
            if (server === serverSocket) {
                started = false
                server = null
            }
        }
    }

    private fun handleClient(socket: Socket) {
        socket.use {
            try {
                socket.soTimeout = 5_000
                val request = readHttpRequest(socket)

                when {
                    request == null -> {
                        writeResponse(socket, 400, null)
                    }
                    request.method != "POST" -> {
                        writeResponse(socket, 405, null)
                    }
                    request.path !in CALLBACK_PATHS -> {
                        writeResponse(socket, 404, null)
                    }
                    else -> {
                        Log.d(TAG, "Received callback on ${request.path}: ${request.body}")
                        val event = parseCallback(request.body, request.path)

                        // Acknowledge quickly so KPayPOS does not retry.
                        writeResponse(socket, 200, """{"code":10000}""")

                        if (event != null) {
                            scope.launch {
                                _callbackFlow.emit(event)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error handling callback", e)
                try {
                    writeResponse(socket, 500, null)
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun readHttpRequest(socket: Socket): HttpRequest? {
        val input = socket.getInputStream()
        val headerBytes = readHeaderBytes(input) ?: return null
        val headerText = String(headerBytes, Charsets.ISO_8859_1)
        val lines = headerText.split("\r\n")
        val requestParts = lines.firstOrNull()?.split(" ", limit = 3).orEmpty()
        val method = requestParts.getOrNull(0) ?: return null
        val target = requestParts.getOrNull(1) ?: return null
        val contentLength = lines
            .firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
            ?.substringAfter(':')
            ?.trim()
            ?.toIntOrNull()
            ?: 0

        if (contentLength > MAX_BODY_BYTES) {
            throw IllegalArgumentException("Callback body too large")
        }

        val bodyBytes = readBody(input, contentLength)
        return HttpRequest(
            method = method,
            path = normalizePath(target),
            body = String(bodyBytes, Charsets.UTF_8)
        )
    }

    private fun readHeaderBytes(input: java.io.InputStream): ByteArray? {
        val output = ByteArrayOutputStream()
        val marker = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte(), '\r'.code.toByte(), '\n'.code.toByte())
        var matched = 0

        while (output.size() < MAX_HEADER_BYTES) {
            val next = input.read()
            if (next == -1) return null

            val byte = next.toByte()
            output.write(next)
            matched = when {
                byte == marker[matched] -> matched + 1
                byte == marker[0] -> 1
                else -> 0
            }
            if (matched == marker.size) {
                return output.toByteArray()
            }
        }

        throw IllegalArgumentException("Callback headers too large")
    }

    private fun readBody(input: java.io.InputStream, contentLength: Int): ByteArray {
        val body = ByteArray(contentLength)
        var offset = 0
        while (offset < contentLength) {
            val read = input.read(body, offset, contentLength - offset)
            if (read == -1) break
            offset += read
        }
        return if (offset == contentLength) body else body.copyOf(offset)
    }

    private fun normalizePath(target: String): String {
        val pathWithQuery = if (target.startsWith("http://") || target.startsWith("https://")) {
            "/${target.substringAfter("://").substringAfter("/", "")}"
        } else {
            target
        }
        return pathWithQuery.substringBefore('?')
    }

    private fun writeResponse(socket: Socket, statusCode: Int, body: String?) {
        val responseBody = body?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val headers = buildString {
            append("HTTP/1.1 ").append(statusCode).append(' ').append(statusText(statusCode)).append("\r\n")
            append("Content-Type: application/json\r\n")
            append("Content-Length: ").append(responseBody.size).append("\r\n")
            append("Connection: close\r\n")
            append("\r\n")
        }.toByteArray(Charsets.ISO_8859_1)

        val output = socket.getOutputStream()
        output.write(headers)
        if (responseBody.isNotEmpty()) {
            output.write(responseBody)
        }
        output.flush()
    }

    private fun statusText(statusCode: Int): String {
        return when (statusCode) {
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            else -> "Internal Server Error"
        }
    }

    private fun parseCallback(body: String, path: String): KPayCallbackEvent? {
        return try {
            val json = gson.fromJson(body, JsonObject::class.java) ?: return null

            when (path) {
                PAYMENT_PATH, FORWARD_PATH -> {
                    KPayCallbackEvent.PaymentResult(
                        outTradeNo = json.stringOrNull("outTradeNo")
                            ?: json.stringOrNull("outTradeNO"),
                        transactionNo = json.stringOrNull("transactionNo"),
                        payAmount = json.stringOrNull("payAmount"),
                        payCurrency = json.stringOrNull("payCurrency") ?: "702",
                        payMethod = json.intOrNull("payMethod"),
                        transactionType = json.intOrNull("transactionType"),
                        payResult = json.intOrNull("payResult"),
                        raw = body
                    )
                }
                ACTION_PATH -> {
                    KPayCallbackEvent.Action(
                        action = json.stringOrNull("action"),
                        status = json.stringOrNull("status"),
                        raw = body
                    )
                }
                else -> KPayCallbackEvent.Raw(path, body)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse callback body", e)
            KPayCallbackEvent.Raw(path, body)
        }
    }

    private fun JsonObject.stringOrNull(name: String): String? {
        val value = get(name) ?: return null
        return if (value.isJsonNull) null else value.asString
    }

    private fun JsonObject.intOrNull(name: String): Int? {
        val value = get(name) ?: return null
        return if (value.isJsonNull) null else value.asInt
    }

    private data class HttpRequest(
        val method: String,
        val path: String,
        val body: String
    )

    sealed class KPayCallbackEvent {
        data class PaymentResult(
            val outTradeNo: String?,
            val transactionNo: String?,
            val payAmount: String?,
            val payCurrency: String?,
            val payMethod: Int?,
            val transactionType: Int?,
            val payResult: Int?,   // 2=success, 3=failed, 1=pending, -1=timeout
            val raw: String
        ) : KPayCallbackEvent()

        data class Action(
            val action: String?,
            val status: String?,
            val raw: String
        ) : KPayCallbackEvent()

        data class Raw(
            val path: String,
            val raw: String
        ) : KPayCallbackEvent()
    }
}
