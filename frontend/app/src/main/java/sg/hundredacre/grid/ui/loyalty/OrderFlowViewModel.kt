package sg.hundredacre.grid.ui.loyalty

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import sg.hundredacre.grid.data.api.CustomerData
import sg.hundredacre.grid.data.api.LoyaltyApiService
import sg.hundredacre.grid.data.api.LoyaltyRedemptionResponse
import javax.inject.Inject

data class LoyaltyFlowState(
    val isLoading: Boolean = false,
    val customer: CustomerData? = null,
    val errorMessage: String? = null,
    val redemptionMessage: String? = null
)

@HiltViewModel
class OrderFlowViewModel @Inject constructor(
    private val loyaltyApiService: LoyaltyApiService
) : ViewModel() {

    private val _loyaltyState = MutableLiveData<CustomerData?>()
    val loyaltyState: LiveData<CustomerData?> = _loyaltyState

    private val _uiState = MutableStateFlow(LoyaltyFlowState())
    val uiState: StateFlow<LoyaltyFlowState> = _uiState.asStateFlow()

    fun lookupLoyalty(phone: String? = null, referralCode: String? = null) {
        val normalizedPhone = phone?.trim()?.takeIf { it.isNotEmpty() }
        val normalizedReferralCode = referralCode?.trim()?.takeIf { it.isNotEmpty() }
        if ((normalizedPhone == null) == (normalizedReferralCode == null)) {
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                errorMessage = "Enter a phone number or scan a referral code."
            )
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                errorMessage = null,
                redemptionMessage = null
            )

            try {
                val response = loyaltyApiService.lookupCustomer(
                    phone = normalizedPhone,
                    referralCode = normalizedReferralCode
                )
                if (response.isSuccessful) {
                    val customer = response.body()
                    _loyaltyState.value = customer
                    _uiState.value = LoyaltyFlowState(customer = customer)
                } else {
                    _loyaltyState.value = null
                    _uiState.value = LoyaltyFlowState(
                        errorMessage = if (response.code() == 404) {
                            "No loyalty customer found."
                        } else {
                            "Lookup failed: HTTP ${response.code()}"
                        }
                    )
                }
            } catch (e: Exception) {
                _loyaltyState.value = null
                _uiState.value = LoyaltyFlowState(
                    errorMessage = e.localizedMessage ?: "Lookup failed."
                )
            }
        }
    }

    fun redeemVoucher(voucherId: String) {
        viewModelScope.launch {
            redeem(
                action = { loyaltyApiService.redeemVoucher(voucherId) },
                fallbackMessage = "Voucher redeemed."
            )
        }
    }

    fun redeemReward(rewardId: String) {
        viewModelScope.launch {
            redeem(
                action = { loyaltyApiService.redeemReward(rewardId) },
                fallbackMessage = "Reward redeemed."
            )
        }
    }

    fun clearLoyalty() {
        _loyaltyState.value = null
        _uiState.value = LoyaltyFlowState()
    }

    private suspend fun redeem(
        action: suspend () -> retrofit2.Response<LoyaltyRedemptionResponse>,
        fallbackMessage: String
    ) {
        val existingCustomer = _uiState.value.customer
        _uiState.value = _uiState.value.copy(
            isLoading = true,
            errorMessage = null,
            redemptionMessage = null
        )

        try {
            val response = action()
            if (response.isSuccessful) {
                val body = response.body()
                val updatedCustomer = body?.customer ?: existingCustomer
                _loyaltyState.value = updatedCustomer
                _uiState.value = LoyaltyFlowState(
                    customer = updatedCustomer,
                    redemptionMessage = body?.message ?: fallbackMessage
                )
            } else {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = "Redemption failed: HTTP ${response.code()}"
                )
            }
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                errorMessage = e.localizedMessage ?: "Redemption failed."
            )
        }
    }
}
