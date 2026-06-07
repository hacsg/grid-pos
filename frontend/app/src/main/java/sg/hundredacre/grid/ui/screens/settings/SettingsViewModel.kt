package sg.hundredacre.grid.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import sg.hundredacre.grid.data.local.PaymentPreferencesManager
import sg.hundredacre.grid.payments.PaymentProvider
import sg.hundredacre.grid.payments.PaymentRepository
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val paymentPreferencesManager: PaymentPreferencesManager,
    private val paymentRepository: PaymentRepository
) : ViewModel() {

    /** Currently selected payment provider. */
    val selectedProvider: StateFlow<PaymentProvider> =
        paymentPreferencesManager.paymentProviderFlow
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = PaymentProvider.DEFAULT
            )

    /**
     * Switch the active payment provider.
     * Persists the choice and updates the repository's adapter at runtime.
     */
    fun selectProvider(provider: PaymentProvider) {
        viewModelScope.launch {
            paymentRepository.setProvider(provider)
            paymentPreferencesManager.setPaymentProvider(provider)
        }
    }
}