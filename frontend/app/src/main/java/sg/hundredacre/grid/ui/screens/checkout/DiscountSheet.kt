package sg.hundredacre.grid.ui.screens.checkout

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Discount
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorder
import sg.hundredacre.grid.ui.theme.GridBorderMedium
import sg.hundredacre.grid.ui.theme.GridDisabledBg
import sg.hundredacre.grid.ui.theme.GridDisabledText
import sg.hundredacre.grid.ui.theme.GridError
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryDark
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.InterFontFamily

// ────────────────────────────────────────────────────────────────
// Discount result data class
// ────────────────────────────────────────────────────────────────
data class DiscountResult(
    val discountAmount: Double,    // absolute S$ discount
    val discountLabel: String,     // human-readable label e.g. "10% off", "S$2 off"
    val reason: String             // e.g. "Staff discount"
)

// ────────────────────────────────────────────────────────────────
// Discount Bottom Sheet
// ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiscountSheet(
    isVisible: Boolean,
    subtotal: Double,
    onDismiss: () -> Unit,
    onApplyDiscount: (DiscountResult) -> Unit
) {
    if (!isVisible) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // ── State ──
    var discountType by remember { mutableStateOf("percentage") } // "percentage" | "fixed"
    var presetPercent by remember { mutableStateOf<Int?>(null) }  // 10 or 15
    var presetFixed by remember { mutableStateOf<Double?>(null) }  // 2.0 or 5.0
    var customPercent by remember { mutableStateOf("") }
    var customFixed by remember { mutableStateOf("") }
    var selectedReason by remember { mutableStateOf("Staff discount") }
    var expandedReason by remember { mutableStateOf(false) }
    var showPinDialog by remember { mutableStateOf(false) }
    var pinInput by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf(false) }
    var discountApplied by remember { mutableStateOf(false) }

    val selectedPreset = presetPercent ?: presetFixed

    // Compute the effective discount %
    val discountPercent = when {
        discountType == "percentage" && presetPercent != null -> presetPercent.toDouble()
        discountType == "percentage" && customPercent.isNotBlank() -> customPercent.toDoubleOrNull() ?: 0.0
        discountType == "fixed" && presetFixed != null -> (presetFixed / subtotal) * 100
        discountType == "fixed" && customFixed.isNotBlank() -> {
            val fixedAmt = customFixed.toDoubleOrNull() ?: 0.0
            if (subtotal > 0) (fixedAmt / subtotal) * 100 else 0.0
        }
        else -> 0.0
    }

    val requiresPin = discountPercent > 20

    // Compute the actual dollar discount
    val discountAmount = when (discountType) {
        "percentage" -> {
            val pct = when {
                presetPercent != null -> presetPercent.toDouble()
                customPercent.toDoubleOrNull() != null -> customPercent.toDouble()
                else -> 0.0
            }
            subtotal * (pct / 100.0)
        }
        "fixed" -> {
            when {
                presetFixed != null -> presetFixed
                customFixed.toDoubleOrNull() != null -> customFixed.toDouble()
                else -> 0.0
            }
        }
        else -> 0.0
    }

    val newTotal = subtotal - discountAmount

    // Build label
    val discountLabel = when {
        discountType == "percentage" && presetPercent != null -> "${presetPercent}% off"
        discountType == "percentage" && customPercent.isNotBlank() -> "${customPercent}% off"
        discountType == "fixed" && presetFixed != null -> "S$${String.format("%.0f", presetFixed)} off"
        discountType == "fixed" && customFixed.isNotBlank() -> "S$${String.format("%.2f", customFixed.toDoubleOrNull() ?: 0.0)} off"
        else -> ""
    }

    // Quick preset buttons
    val presets = listOf(
        PresetButton("10%", "percentage", 10, null),
        PresetButton("15%", "percentage", 15, null),
        PresetButton("S\$2 off", "fixed", null, 2.0),
        PresetButton("S\$5 off", "fixed", null, 5.0),
    )

    // Reason options
    val reasonOptions = listOf("Staff discount", "Birthday", "Manager comp")

    fun clearPresets() {
        presetPercent = null
        presetFixed = null
    }

    fun handleApply() {
        if (requiresPin) {
            showPinDialog = true
        } else {
            onApplyDiscount(
                DiscountResult(
                    discountAmount = discountAmount,
                    discountLabel = discountLabel,
                    reason = selectedReason
                )
            )
            discountApplied = true
        }
    }

    fun handlePinConfirm() {
        // Simple PIN check — in production this would validate against stored manager PIN
        if (pinInput == "1234") {
            showPinDialog = false
            pinError = false
            onApplyDiscount(
                DiscountResult(
                    discountAmount = discountAmount,
                    discountLabel = discountLabel,
                    reason = selectedReason
                )
            )
            discountApplied = true
        } else {
            pinError = true
        }
    }

    ModalBottomSheet(
        onDismissRequest = {
            if (!discountApplied) onDismiss()
            else {
                discountApplied = false
                onDismiss()
            }
        },
        sheetState = sheetState,
        containerColor = GridBackground,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        tonalElevation = 0.dp,
        dragHandle = null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 0.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
            ) {
                // ── Header ──
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(GridPrimary.copy(alpha = 0.1f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Discount,
                                contentDescription = null,
                                tint = GridPrimary,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                        Text(
                            text = "Apply Discount",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            color = GridTextPrimary
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(GridSurface)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = {
                                    if (!discountApplied) onDismiss()
                                    else {
                                        discountApplied = false
                                        onDismiss()
                                    }
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Close",
                            tint = GridTextSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                // ── Current Total Display ──
                CurrentTotalBar(
                    subtotal = subtotal,
                    discountAmount = discountAmount,
                    newTotal = newTotal,
                    discountLabel = discountLabel
                )

                Spacer(modifier = Modifier.height(20.dp))

                // ── Preset Discount Buttons ──
                Text(
                    text = "Quick Discounts",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = GridTextSecondary,
                    modifier = Modifier.padding(bottom = 10.dp)
                )

                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    presets.forEach { preset ->
                        val isSelected = when {
                            discountType == "percentage" && preset.type == "percentage" -> presetPercent == preset.percentValue
                            discountType == "fixed" && preset.type == "fixed" -> presetFixed == preset.fixedValue
                            else -> false
                        }
                        PresetChip(
                            label = preset.label,
                            isSelected = isSelected,
                            onClick = {
                                clearPresets()
                                discountType = preset.type
                                if (preset.type == "percentage") {
                                    presetPercent = preset.percentValue
                                    presetFixed = null
                                } else {
                                    presetFixed = preset.fixedValue
                                    presetPercent = null
                                }
                                customPercent = ""
                                customFixed = ""
                                discountApplied = false
                            }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                // ── Custom Amount Input ──
                Text(
                    text = "Custom Amount",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = GridTextSecondary,
                    modifier = Modifier.padding(bottom = 10.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Percentage input
                    OutlinedTextField(
                        value = customPercent,
                        onValueChange = {
                            if (it.all { c -> c.isDigit() || c == '.' } && it.count { c -> c == '.' } <= 1) {
                                customPercent = it
                                if (it.isNotEmpty()) {
                                    clearPresets()
                                    discountType = "percentage"
                                    discountApplied = false
                                }
                            }
                        },
                        label = { Text("% off") },
                        placeholder = { Text("e.g. 20") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(
                            fontFamily = InterFontFamily,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = GridTextPrimary
                        )
                    )

                    // Fixed amount input
                    OutlinedTextField(
                        value = customFixed,
                        onValueChange = {
                            if (it.all { c -> c.isDigit() || c == '.' } && it.count { c -> c == '.' } <= 1) {
                                customFixed = it
                                if (it.isNotEmpty()) {
                                    clearPresets()
                                    discountType = "fixed"
                                    discountApplied = false
                                }
                            }
                        },
                        label = { Text("S\$ off") },
                        placeholder = { Text("e.g. 3.50") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(
                            fontFamily = InterFontFamily,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = GridTextPrimary
                        )
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                // ── Discount Reason ──
                Text(
                    text = "Reason",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = GridTextSecondary,
                    modifier = Modifier.padding(bottom = 10.dp)
                )

                ReasonSelector(
                    options = reasonOptions,
                    selectedReason = selectedReason,
                    expanded = expandedReason,
                    onExpandedChange = { expandedReason = it },
                    onReasonSelected = { selectedReason = it; expandedReason = false }
                )

                Spacer(modifier = Modifier.height(24.dp))
            }

            // ── Pinned bottom: discount warning + Apply button ──
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp)
            ) {
                HorizontalDivider(color = GridBorder, thickness = 1.dp)
                Spacer(modifier = Modifier.height(16.dp))

                // Manager approval warning
                AnimatedVisibility(
                    visible = requiresPin && discountAmount > 0,
                    enter = fadeIn(),
                    exit = fadeOut()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(GridWarning.copy(alpha = 0.1f), RoundedCornerShape(10.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.VerifiedUser,
                            contentDescription = null,
                            tint = GridWarning,
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = "Discount over 20% requires manager approval",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = GridTextPrimary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Apply button
                Button(
                    onClick = { handleApply() },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    enabled = discountAmount > 0 && !discountApplied,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GridPrimary,
                        contentColor = GridBackground,
                        disabledContainerColor = GridDisabledBg,
                        disabledContentColor = GridDisabledText
                    )
                ) {
                    if (discountApplied) {
                        Text(
                            text = "Discount Applied ✓",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp
                        )
                    } else {
                        Text(
                            text = if (requiresPin) "Apply Discount (Manager PIN Required)" else "Apply Discount",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 16.sp
                        )
                    }
                }
            }
        }
    }

    // ── Manager PIN Dialog ──
    if (showPinDialog) {
        AlertDialog(
            onDismissRequest = {
                showPinDialog = false
                pinError = false
                pinInput = ""
            },
            containerColor = GridBackground,
            shape = RoundedCornerShape(20.dp),
            icon = {
                Icon(
                    imageVector = Icons.Default.VerifiedUser,
                    contentDescription = null,
                    tint = GridPrimary,
                    modifier = Modifier.size(36.dp)
                )
            },
            title = {
                Text(
                    text = "Manager PIN Required",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = GridTextPrimary
                )
            },
            text = {
                Column {
                    Text(
                        text = "Enter manager PIN to approve ${discountLabel} discount (S$${String.format("%.2f", discountAmount)})",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    OutlinedTextField(
                        value = pinInput,
                        onValueChange = {
                            if (it.length <= 6 && it.all { c -> c.isDigit() }) {
                                pinInput = it
                                pinError = false
                            }
                        },
                        label = { Text("Manager PIN") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        isError = pinError,
                        supportingText = if (pinError) {
                            { Text("Invalid PIN. Try 1234.") }
                        } else null,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(
                            fontFamily = InterFontFamily,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = GridTextPrimary,
                            textAlign = TextAlign.Center
                        )
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { handlePinConfirm() },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GridPrimary,
                        contentColor = GridBackground
                    )
                ) {
                    Text(
                        text = "Confirm",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showPinDialog = false
                    pinError = false
                    pinInput = ""
                }) {
                    Text(
                        text = "Cancel",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        color = GridTextSecondary
                    )
                }
            }
        )
    }
}

// ────────────────────────────────────────────────────────────────
// Current Total Bar (shows before/after discount)
// ────────────────────────────────────────────────────────────────

@Composable
private fun CurrentTotalBar(
    subtotal: Double,
    discountAmount: Double,
    newTotal: Double,
    discountLabel: String
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(GridSurface, RoundedCornerShape(14.dp))
            .padding(16.dp)
    ) {
        // Current subtotal
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Subtotal",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                color = GridTextSecondary
            )
            Text(
                text = "S$${String.format("%.2f", subtotal)}",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = GridTextPrimary
            )
        }

        // Discount line (if any)
        if (discountAmount > 0) {
            Spacer(modifier = Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Discount ($discountLabel)",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = GridSuccess
                )
                Text(
                    text = "-S$${String.format("%.2f", discountAmount)}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = GridSuccess
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        HorizontalDivider(color = GridBorder, thickness = 1.dp)
        Spacer(modifier = Modifier.height(8.dp))

        // New total
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (discountAmount > 0) "New Total" else "Total",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = GridTextPrimary
            )
            Text(
                text = "S$${String.format("%.2f", newTotal)}",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                color = if (discountAmount > 0) GridPrimary else GridTextPrimary
            )
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Preset Chip Button
// ────────────────────────────────────────────────────────────────

@Composable
private fun PresetChip(
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val bgColor = if (isSelected) GridPrimary else GridSurface
    val textColor = if (isSelected) GridBackground else GridTextPrimary
    val borderColor = if (isSelected) GridPrimary else GridBorderMedium

    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(bgColor)
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick
            )
            .padding(horizontal = 20.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
            fontSize = 15.sp,
            color = textColor
        )
    }
}

// ────────────────────────────────────────────────────────────────
// Reason Dropdown Selector
// ────────────────────────────────────────────────────────────────

@Composable
private fun ReasonSelector(
    options: List<String>,
    selectedReason: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onReasonSelected: (String) -> Unit
) {
    Column {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(GridSurface)
                .border(1.dp, GridBorder, RoundedCornerShape(12.dp))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { onExpandedChange(!expanded) }
                )
                .padding(horizontal = 16.dp, vertical = 16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = selectedReason,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = GridTextPrimary
                )
                Text(
                    text = if (expanded) "▲" else "▼",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = GridTextSecondary
                )
            }
        }

        AnimatedVisibility(visible = expanded) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(GridSurface)
                    .border(1.dp, GridBorder, RoundedCornerShape(12.dp))
            ) {
                options.forEachIndexed { index, option ->
                    val isLast = index == options.lastIndex
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = { onReasonSelected(option) }
                            )
                            .padding(horizontal = 16.dp, vertical = 14.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = option,
                                fontFamily = InterFontFamily,
                                fontWeight = if (option == selectedReason) FontWeight.SemiBold else FontWeight.Normal,
                                fontSize = 15.sp,
                                color = if (option == selectedReason) GridPrimary else GridTextPrimary
                            )
                            if (option == selectedReason) {
                                Text(
                                    text = "✓",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = GridPrimary
                                )
                            }
                        }
                    }
                    if (!isLast) {
                        HorizontalDivider(color = GridBorder, thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Helper data
// ────────────────────────────────────────────────────────────────

private val GridWarning = Color(0xFFD4A017)

private data class PresetButton(
    val label: String,
    val type: String,    // "percentage" or "fixed"
    val percentValue: Int?,
    val fixedValue: Double?
)