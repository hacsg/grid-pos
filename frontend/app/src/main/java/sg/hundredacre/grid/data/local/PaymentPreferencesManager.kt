package sg.hundredacre.grid.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import sg.hundredacre.grid.payments.PaymentProvider
import javax.inject.Inject
import javax.inject.Singleton

/** Single DataStore instance for app preferences. */
private val Context.paymentDataStore: DataStore<Preferences> by preferencesDataStore(name = "grid_pos_preferences")

/**
 * Manages user preferences persisted via Jetpack DataStore.
 *
 * Currently stores the selected [PaymentProvider] so the choice survives app restarts.
 */
@Singleton
class PaymentPreferencesManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private val KEY_PAYMENT_PROVIDER = stringPreferencesKey("payment_provider")
    }

    /** Observe the currently selected provider as a Flow. */
    val paymentProviderFlow: Flow<PaymentProvider> =
        context.paymentDataStore.data.map { prefs ->
            val name = prefs[KEY_PAYMENT_PROVIDER]
            if (name != null) PaymentProvider.fromName(name) else PaymentProvider.DEFAULT
        }

    /**
     * Persist the chosen payment provider.
     */
    suspend fun setPaymentProvider(provider: PaymentProvider) {
        context.paymentDataStore.edit { prefs ->
            prefs[KEY_PAYMENT_PROVIDER] = provider.name
        }
    }
}