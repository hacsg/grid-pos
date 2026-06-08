package sg.hundredacre.grid.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

// ──────────────────────────────────────────────
// Request / Response DTOs
// ──────────────────────────────────────────────

data class ClockInResponse(
    val shift_id: String,
    val staff_id: String,
    val clock_in: String,
    val message: String = ""
)

data class ClockOutResponse(
    val shift_id: String,
    val staff_id: String,
    val clock_in: String,
    val clock_out: String,
    val duration_minutes: Int,
    val orders_processed: Int,
    val total_sales: String,
    val message: String = ""
)

data class ShiftSummaryResponse(
    val is_clocked_in: Boolean,
    val shift_id: String? = null,
    val clock_in: String? = null,
    val duration_minutes: Int? = null,
    val orders_processed: Int? = 0,
    val total_sales: String? = "0.00"
)

data class ShiftHistoryItem(
    val id: String,
    val staff_id: String,
    val outlet_id: String,
    val clock_in: String,
    val clock_out: String? = null,
    val orders_processed: Int? = 0,
    val total_sales: String? = "0.00",
    val created_at: String? = null
)

// ──────────────────────────────────────────────
// API Service Interface
// ──────────────────────────────────────────────

interface ShiftApiService {

    @POST("api/staff/{staff_id}/clock-in")
    suspend fun clockIn(
        @Path("staff_id") staffId: String
    ): Response<ClockInResponse>

    @POST("api/staff/{staff_id}/clock-out")
    suspend fun clockOut(
        @Path("staff_id") staffId: String
    ): Response<ClockOutResponse>

    @GET("api/staff/{staff_id}/shifts/current")
    suspend fun getCurrentShift(
        @Path("staff_id") staffId: String
    ): Response<ShiftSummaryResponse>

    @GET("api/staff/{staff_id}/shifts")
    suspend fun getShiftHistory(
        @Path("staff_id") staffId: String,
        @Query("limit") limit: Int = 20
    ): Response<List<ShiftHistoryItem>>
}