package sg.hundredacre.grid.data.api

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class CustomerData(
    val id: String,
    val name: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val tier: String? = null,
    @SerializedName("referral_code") val referralCode: String? = null,
    @SerializedName("lifetime_moments") val lifetimeMoments: Int? = null,
    val rewards: List<LoyaltyReward>? = null,
    val vouchers: List<LoyaltyVoucher>? = null
)

data class LoyaltyReward(
    val id: String,
    val name: String? = null,
    val title: String? = null,
    val description: String? = null,
    @SerializedName("moments_required") val momentsRequired: Int? = null,
    val available: Boolean? = null
)

data class LoyaltyVoucher(
    val id: String,
    val code: String? = null,
    val title: String? = null,
    val description: String? = null,
    val value: Double? = null,
    val available: Boolean? = null
)

data class LoyaltySignupRequest(
    val phone: String,
    val email: String? = null,
    val name: String? = null,
    val birthday: String? = null,
    @SerializedName("referred_by_code") val referredByCode: String? = null
)

data class LoyaltyRedemptionResponse(
    val id: String? = null,
    val status: String? = null,
    val message: String? = null,
    val customer: CustomerData? = null
)

interface LoyaltyApiService {
    @GET("api/loyalty/lookup")
    suspend fun lookupCustomer(
        @Query("phone") phone: String? = null,
        @Query("referral_code") referralCode: String? = null
    ): Response<CustomerData>

    @POST("api/loyalty/signup")
    suspend fun signupCustomer(@Body request: LoyaltySignupRequest): Response<CustomerData>

    @POST("api/loyalty/redeem-voucher/{voucher_id}")
    suspend fun redeemVoucher(
        @Path("voucher_id") voucherId: String
    ): Response<LoyaltyRedemptionResponse>

    @POST("api/loyalty/redeem-reward/{reward_id}")
    suspend fun redeemReward(
        @Path("reward_id") rewardId: String
    ): Response<LoyaltyRedemptionResponse>
}
