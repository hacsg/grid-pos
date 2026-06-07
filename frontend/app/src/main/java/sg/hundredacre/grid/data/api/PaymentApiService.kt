package sg.hundredacre.grid.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

data class ConnectionTokenRequest(
    val testMode: Boolean = false
)

data class ConnectionTokenResponse(
    val client_secret: String
)

data class CreatePaymentIntentRequest(
    val amount: Long,
    val currency: String = "SGD"
)

data class CreatePaymentIntentResponse(
    val client_secret: String,
    val payment_intent_id: String
)

data class CapturePaymentRequest(
    val payment_intent_id: String
)

data class CapturePaymentResponse(
    val status: String,
    val payment_intent_id: String
)

interface PaymentApiService {

    @POST("api/payments/connection-token")
    suspend fun getConnectionToken(
        @Body request: ConnectionTokenRequest = ConnectionTokenRequest()
    ): Response<ConnectionTokenResponse>

    @POST("api/payments/create-intent")
    suspend fun createPaymentIntent(
        @Body request: CreatePaymentIntentRequest
    ): Response<CreatePaymentIntentResponse>

    @POST("api/payments/capture")
    suspend fun capturePaymentIntent(
        @Body request: CapturePaymentRequest
    ): Response<CapturePaymentResponse>
}