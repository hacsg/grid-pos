package sg.hundredacre.grid.ui.screens.shift

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.data.models.ShiftRecord
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorderMedium
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridWarning
import sg.hundredacre.grid.ui.theme.InterFontFamily
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

// ──────────────────────────────────────────────
// FORMATTING HELPERS
// ──────────────────────────────────────────────

private val dateTimeFormat = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.getDefault())
private val dateFormat = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())
private val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

private fun formatDuration(minutes: Int): String {
    val hours = TimeUnit.MINUTES.toHours(minutes.toLong())
    val mins = minutes % 60
    return if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
}

private fun formatDurationFromMillis(startMillis: Long): String {
    val elapsed = System.currentTimeMillis() - startMillis
    val minutes = TimeUnit.MILLISECONDS.toMinutes(elapsed)
    return formatDuration(minutes.toInt())
}

// ──────────────────────────────────────────────
// CLOCK IN CONFIRMATION (shown after login)
// ──────────────────────────────────────────────

@Composable
fun ClockInConfirmation(
    staffName: String,
    clockInTime: Long,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(16.dp),
        containerColor = GridBackground,
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.Schedule,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = GridPrimary
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Clocked In!",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = GridTextPrimary
                )
            }
        },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = staffName,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = GridPrimary
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = dateTimeFormat.format(Date(clockInTime)),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 14.sp,
                    color = GridTextSecondary
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(
                    text = "Got it",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = GridPrimary
                )
            }
        }
    )
}

// ──────────────────────────────────────────────
// CLOCK OUT CONFIRMATION DIALOG
// ──────────────────────────────────────────────

@Composable
fun ClockOutDialog(
    shiftDuration: String,
    ordersProcessed: Int,
    totalSales: Double,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(16.dp),
        containerColor = GridBackground,
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = GridWarning
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Clock Out?",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = GridTextPrimary
                )
            }
        },
        text = {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Duration
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Shift Duration",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        text = shiftDuration,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = GridTextPrimary
                    )
                }
                // Orders processed
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Orders Processed",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        text = "$ordersProcessed",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = GridTextPrimary
                    )
                }
                // Total sales
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Total Sales",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        text = "$${String.format("%.2f", totalSales)}",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = GridPrimary
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(
                    text = "Clock Out",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = GridWarning
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(
                    text = "Cancel",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 16.sp,
                    color = GridTextSecondary
                )
            }
        }
    )
}

// ──────────────────────────────────────────────
// SHIFT SECTION CARD (used in Settings)
// ──────────────────────────────────────────────

@Composable
fun ShiftSectionCard(
    isClockedIn: Boolean,
    shiftDuration: String,
    onToggleClock: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isClockedIn) GridSuccess.copy(alpha = 0.08f) else GridSurface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = "Shift",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = GridTextPrimary
                    )
                    if (isClockedIn) {
                        Text(
                            text = "Shift: $shiftDuration",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 13.sp,
                            color = GridPrimary
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = if (isClockedIn) "Clocked In" else "Off Duty",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = if (isClockedIn) GridSuccess else GridTextSecondary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Switch(
                        checked = isClockedIn,
                        onCheckedChange = { onToggleClock() },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = GridBackground,
                            checkedTrackColor = GridSuccess,
                            uncheckedThumbColor = GridBackground,
                            uncheckedTrackColor = GridBorderMedium
                        )
                    )
                }
            }
        }
    }
}

// ──────────────────────────────────────────────
// SHIFT HISTORY LIST
// ──────────────────────────────────────────────

@Composable
fun ShiftHistorySection(
    shifts: List<ShiftRecord>,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        // Section header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(bottom = 8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.History,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = GridTextSecondary
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = "Shift History",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = GridTextPrimary
            )
        }

        if (shifts.isEmpty()) {
            Text(
                text = "No shifts recorded yet.",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 13.sp,
                color = GridTextSecondary,
                modifier = Modifier.padding(vertical = 16.dp)
            )
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(shifts) { shift ->
                    ShiftHistoryRow(shift = shift)
                }
            }
        }
    }
}

@Composable
private fun ShiftHistoryRow(shift: ShiftRecord) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = GridSurface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Date & times
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = dateFormat.format(Date(shift.clockIn)),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = GridTextPrimary
                )
                Spacer(modifier = Modifier.height(2.dp))
                val clockInStr = timeFormat.format(Date(shift.clockIn))
                val clockOutStr = shift.clockOut?.let { timeFormat.format(Date(it)) } ?: "Active"
                Text(
                    text = "$clockInStr — $clockOutStr",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 12.sp,
                    color = GridTextSecondary
                )
            }
            // Duration & sales
            Column(horizontalAlignment = Alignment.End) {
                if (shift.durationMinutes != null) {
                    Text(
                        text = formatDuration(shift.durationMinutes),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 13.sp,
                        color = GridPrimary
                    )
                }
                if (shift.totalSales != null && shift.totalSales > 0) {
                    Text(
                        text = "$${String.format("%.2f", shift.totalSales)}",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        color = GridTextSecondary
                    )
                }
            }
        }
    }
}

// ──────────────────────────────────────────────
// SHIFT MANAGEMENT SCREEN (full page, for future nav)
// ──────────────────────────────────────────────

@Composable
fun ShiftManagementScreen(
    isClockedIn: Boolean,
    shiftDuration: String,
    shifts: List<ShiftRecord>,
    onToggleClock: () -> Unit,
    onBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        ShiftSectionCard(
            isClockedIn = isClockedIn,
            shiftDuration = shiftDuration,
            onToggleClock = onToggleClock
        )

        Spacer(modifier = Modifier.height(24.dp))
        HorizontalDivider(color = GridBorderMedium.copy(alpha = 0.5f))
        Spacer(modifier = Modifier.height(16.dp))

        ShiftHistorySection(shifts = shifts)
    }
}