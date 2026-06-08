package sg.hundredacre.grid.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import sg.hundredacre.grid.data.api.ShiftApiService
import sg.hundredacre.grid.data.local.ShiftDao
import sg.hundredacre.grid.data.local.PaymentPreferencesManager
import sg.hundredacre.grid.data.models.ShiftRecord
import sg.hundredacre.grid.payments.PaymentProvider
import sg.hundredacre.grid.payments.PaymentRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import javax.inject.Inject

data class ShiftUiState(
    val isClockedIn: Boolean = false,
    val activeShiftId: String? = null,
    val clockInTime: Long? = null,
    val shiftDuration: String = "",
    val ordersProcessed: Int = 0,
    val totalSales: Double = 0.0,
    val showClockInConfirmation: Boolean = false,
    val showClockOutDialog: Boolean = false,
    val staffName: String = "",
    val staffId: String = "default",
    val shifts: List<ShiftRecord> = emptyList(),
    val isRefreshing: Boolean = false
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val paymentPreferencesManager: PaymentPreferencesManager,
    private val paymentRepository: PaymentRepository,
    private val shiftApiService: ShiftApiService,
    private val shiftDao: ShiftDao
) : ViewModel() {

    /** Currently selected payment provider. */
    val selectedProvider: StateFlow<PaymentProvider> =
        paymentPreferencesManager.paymentProviderFlow
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = PaymentProvider.DEFAULT
            )

    private val _shiftState = MutableStateFlow(ShiftUiState())
    val shiftState: StateFlow<ShiftUiState> = _shiftState.asStateFlow()

    init {
        loadShiftState()
        // Tick every 30 seconds to update duration display
        viewModelScope.launch {
            while (true) {
                delay(30_000L)
                updateDuration()
            }
        }
    }

    /** Switch the active payment provider. */
    fun selectProvider(provider: PaymentProvider) {
        viewModelScope.launch {
            paymentRepository.setProvider(provider)
            paymentPreferencesManager.setPaymentProvider(provider)
        }
    }

    // ──────────────────────────────────────────
    // Shift Management
    // ──────────────────────────────────────────

    fun setStaffInfo(staffId: String, staffName: String) {
        _shiftState.value = _shiftState.value.copy(
            staffId = staffId,
            staffName = staffName
        )
    }

    private fun loadShiftState() {
        viewModelScope.launch {
            // Load local shift records
            shiftDao.getAllShifts().collect { shifts ->
                _shiftState.value = _shiftState.value.copy(shifts = shifts)
            }
        }

        viewModelScope.launch {
            // Check for active shift locally
            val active = shiftDao.getActiveShift()
            if (active != null) {
                _shiftState.value = _shiftState.value.copy(
                    isClockedIn = true,
                    activeShiftId = active.shiftId,
                    clockInTime = active.clockIn
                )
                updateDuration()
            }
        }
    }

    private fun updateDuration() {
        val state = _shiftState.value
        if (state.isClockedIn && state.clockInTime != null) {
            val elapsed = System.currentTimeMillis() - state.clockInTime
            val minutes = TimeUnit.MILLISECONDS.toMinutes(elapsed)
            val hours = TimeUnit.MILLISECONDS.toHours(elapsed)
            val remainingMinutes = minutes % 60
            val duration = if (hours > 0) "${hours}h ${remainingMinutes}m" else "${remainingMinutes}m"
            _shiftState.value = state.copy(shiftDuration = duration)
        }
    }

    fun clockIn() {
        viewModelScope.launch {
            val state = _shiftState.value
            try {
                val response = shiftApiService.clockIn(state.staffId)
                if (response.isSuccessful) {
                    val body = response.body()!!
                    val clockInMillis = parseIso8601(body.clock_in)

                    val record = ShiftRecord(
                        shiftId = body.shift_id,
                        staffId = body.staff_id,
                        clockIn = clockInMillis
                    )
                    shiftDao.upsert(record)

                    _shiftState.value = _shiftState.value.copy(
                        isClockedIn = true,
                        activeShiftId = body.shift_id,
                        clockInTime = clockInMillis,
                        showClockInConfirmation = true
                    )
                    updateDuration()
                }
            } catch (e: Exception) {
                // If API fails, still allow local clock-in for offline resilience
                val clockInMillis = System.currentTimeMillis()
                val localId = "local_$clockInMillis"
                val record = ShiftRecord(
                    shiftId = localId,
                    staffId = state.staffId,
                    clockIn = clockInMillis
                )
                shiftDao.upsert(record)
                _shiftState.value = _shiftState.value.copy(
                    isClockedIn = true,
                    activeShiftId = localId,
                    clockInTime = clockInMillis,
                    showClockInConfirmation = true
                )
                updateDuration()
            }
        }
    }

    fun dismissClockInConfirmation() {
        _shiftState.value = _shiftState.value.copy(showClockInConfirmation = false)
    }

    fun requestClockOut() {
        val state = _shiftState.value
        if (!state.isClockedIn) return

        viewModelScope.launch {
            // Fetch current shift stats from API for the dialog
            var ordersCount = 0
            var salesTotal = 0.0

            try {
                val currentResp = shiftApiService.getCurrentShift(state.staffId)
                if (currentResp.isSuccessful) {
                    val body = currentResp.body()
                    if (body != null && body.is_clocked_in) {
                        ordersCount = body.orders_processed ?: 0
                        salesTotal = body.total_sales?.toDoubleOrNull() ?: 0.0
                    }
                }
            } catch (_: Exception) { }

            _shiftState.value = _shiftState.value.copy(
                showClockOutDialog = true,
                ordersProcessed = ordersCount,
                totalSales = salesTotal
            )
        }
    }

    fun dismissClockOutDialog() {
        _shiftState.value = _shiftState.value.copy(showClockOutDialog = false)
    }

    fun confirmClockOut() {
        viewModelScope.launch {
            val state = _shiftState.value
            try {
                val response = shiftApiService.clockOut(state.staffId)
                if (response.isSuccessful) {
                    val body = response.body()!!
                    val clockOutMillis = parseIso8601(body.clock_out)

                    val record = ShiftRecord(
                        shiftId = body.shift_id,
                        staffId = body.staff_id,
                        clockIn = parseIso8601(body.clock_in),
                        clockOut = clockOutMillis,
                        durationMinutes = body.duration_minutes,
                        ordersProcessed = body.orders_processed,
                        totalSales = body.total_sales.toDoubleOrNull() ?: 0.0
                    )
                    shiftDao.upsert(record)
                }
            } catch (_: Exception) { }

            // Also update local active shift
            val activeShift = shiftDao.getActiveShift()
            if (activeShift != null) {
                val clockOutMillis = System.currentTimeMillis()
                val duration = if (activeShift.clockIn > 0) {
                    ((clockOutMillis - activeShift.clockIn) / 60000).toInt()
                } else 0

                val completed = activeShift.copy(
                    clockOut = clockOutMillis,
                    durationMinutes = duration,
                    ordersProcessed = _shiftState.value.ordersProcessed,
                    totalSales = _shiftState.value.totalSales
                )
                shiftDao.upsert(completed)
            }

            _shiftState.value = _shiftState.value.copy(
                isClockedIn = false,
                activeShiftId = null,
                clockInTime = null,
                shiftDuration = "",
                showClockOutDialog = false
            )
        }
    }

    private fun parseIso8601(isoString: String): Long {
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
            sdf.parse(isoString.take(19))?.time ?: System.currentTimeMillis()
        } catch (_: Exception) {
            System.currentTimeMillis()
        }
    }
}