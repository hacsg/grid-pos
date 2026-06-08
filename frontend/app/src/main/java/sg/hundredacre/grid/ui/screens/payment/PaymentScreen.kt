package sg.hundredacre.grid.ui.screens.payment

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.LocalPrintshop
import androidx.compose.material.icons.filled.Nfc
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import sg.hundredacre.grid.payments.UiPaymentState
import sg.hundredacre.grid.ui.components.GridPrimaryButton
import sg.hundredacre.grid.ui.components.GridSecondaryButton
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridError
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryDark
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily
import java.text.NumberFormat
import java.util.Locale

// Data class representing a single payment leg in a split payment
private data class PaymentLeg(
    val id: Int,
    var amountCents: Long = 0L,
    var method: PaymentMethod = PaymentMethod.CARD
)

private enum class PaymentMethod(val displayName: String) {
    CARD("Card"),
    PAYNOW("PayNow"),
    CASH("Cash")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentScreen(
    totalAmountCents: Long = 0L,
    onPaymentComplete: (paymentIntentId: String?) -> Unit,
    onNavigateBack: () -> Unit,
    viewModel: PaymentViewModel = hiltViewModel()
) {
    val paymentState by viewModel.paymentState.collectAsStateWithLifecycle()
    val printState by viewModel.printState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Payment",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp
                    )
                },
                navigationIcon = {
                    IconButton(onClick = {
                        if (paymentState is UiPaymentState.Collecting) {
                            viewModel.cancelPayment()
                        }
                        onNavigateBack()
                    }) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = GridTextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = GridBackground
                )
            )
        },
        containerColor = GridBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = paymentState) {
                is UiPaymentState.Idle -> {
                    PaymentIdleContent(
                        totalAmountCents = totalAmountCents,
                        onTapToPay = { viewModel.startPayment(totalAmountCents) },
                        onPayNow = { onPaymentComplete(null) },
                        onCash = { onPaymentComplete(null) },
                        onSplitPayment = { /* handled inside PaymentIdleContent via state */ }
                    )
                }

                is UiPaymentState.Collecting -> {
                    PaymentCollectingContent(
                        onCancel = { viewModel.cancelPayment() }
                    )
                }

                is UiPaymentState.Processing -> {
                    PaymentProcessingContent()
                }

                is UiPaymentState.Success -> {
                    PaymentSuccessContent(
                        amountCents = totalAmountCents,
                        paymentIntentId = state.paymentIntentId,
                        printState = printState,
                        onPrintTrigger = { viewModel.onPaymentSuccess { onPaymentComplete(state.paymentIntentId) } },
                        onPrintRetry = { viewModel.retryPrint { onPaymentComplete(state.paymentIntentId) } },
                        onPrintSkip = { viewModel.skipPrintAndAdvance { onPaymentComplete(state.paymentIntentId) } },
                        onDone = { onPaymentComplete(state.paymentIntentId) }
                    )
                }

                is UiPaymentState.Error -> {
                    PaymentErrorContent(
                        message = state.message,
                        onRetry = { viewModel.resetState() },
                        onCancel = onNavigateBack
                    )
                }
            }
        }
    }
}

@Composable
private fun PaymentIdleContent(
    totalAmountCents: Long,
    onTapToPay: () -> Unit,
    onPayNow: () -> Unit,
    onCash: () -> Unit,
    onSplitPayment: () -> Unit
) {
    val formattedAmount = remember(totalAmountCents) {
        formatSgd(totalAmountCents)
    }

    var showSplitScreen by remember { mutableStateOf(false) }

    if (showSplitScreen) {
        SplitPaymentContent(
            totalAmountCents = totalAmountCents,
            onConfirm = { legs ->
                // Process each leg — for now, complete the payment
                // In a full implementation, each leg would be processed individually
                onTapToPay()
            },
            onBack = { showSplitScreen = false }
        )
    } else {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
            // Total amount card — prominent display
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = GridSurface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "Total Amount",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        formattedAmount,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 42.sp,
                        color = GridPrimary,
                        textAlign = TextAlign.Center
                    )
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            // Payment methods section
            Text(
                "Select Payment Method",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = GridTextPrimary
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Tap to Pay — primary method
            TapToPayButton(onClick = onTapToPay)

            Spacer(modifier = Modifier.height(10.dp))

            // Alternative methods
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                PaymentMethodCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.QrCodeScanner,
                    label = "PayNow QR",
                    onClick = onPayNow
                )
                PaymentMethodCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.Payments,
                    label = "Cash",
                    onClick = onCash
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Split Payment button — full width, secondary style
            Card(
                onClick = { showSplitScreen = true },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = GridSurface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.CreditCard,
                        contentDescription = "Split Payment",
                        tint = GridPrimary,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Split Payment",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                        color = GridPrimary
                    )
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // NFC indicator
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Nfc,
                    contentDescription = "NFC",
                    tint = GridTextSecondary,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "NFC & Contactless enabled",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 12.sp,
                    color = GridTextSecondary
                )
            }
        }
    }
}

// ─── Split Payment UI ─────────────────────────────────────────────────────

@Composable
private fun SplitPaymentContent(
    totalAmountCents: Long,
    onConfirm: (List<PaymentLeg>) -> Unit,
    onBack: () -> Unit
) {
    val formattedTotal = remember(totalAmountCents) { formatSgd(totalAmountCents) }
    var legCounter = remember { mutableStateOf(0) }

    val legs = remember { mutableStateListOf<PaymentLeg>() }
    var showValidationError by remember { mutableStateOf(false) }

    // Initialize with two empty legs if none exist
    if (legs.isEmpty()) {
        legs.add(PaymentLeg(id = legCounter.value++, method = PaymentMethod.CARD))
        legs.add(PaymentLeg(id = legCounter.value++, method = PaymentMethod.PAYNOW))
    }

    // Calculate sums
    val allocatedCents = legs.sumOf { it.amountCents }
    val remainingCents = totalAmountCents - allocatedCents
    val isExact = remainingCents == 0L && legs.any { it.amountCents > 0L }
    val hasEmptyLegs = legs.any { it.amountCents <= 0L }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            // Header: total and balance
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = GridSurface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "Split Payment",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = GridTextPrimary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        formattedTotal,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 32.sp,
                        color = GridPrimary,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Remaining balance display
                    val remainingFormatted = formatSgd(remainingCents)
                    val remainingColor = when {
                        remainingCents > 0L -> GridPrimary
                        remainingCents < 0L -> GridError
                        else -> GridSuccess
                    }
                    Text(
                        "Remaining: $remainingFormatted",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 14.sp,
                        color = remainingColor
                    )

                    if (showValidationError && !isExact) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            "Legs must total exactly $formattedTotal",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 12.sp,
                            color = GridError
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Quick split options
            Text(
                "Quick Split",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = GridTextPrimary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                QuickSplitChip(
                    modifier = Modifier.weight(1f),
                    label = "50 / 50",
                    onClick = {
                        val half = totalAmountCents / 2
                        val remaining = totalAmountCents - half
                        legs.clear()
                        legs.add(PaymentLeg(id = legCounter.value++, amountCents = half, method = PaymentMethod.CARD))
                        legs.add(PaymentLeg(id = legCounter.value++, amountCents = remaining, method = PaymentMethod.PAYNOW))
                        showValidationError = false
                    }
                )
                QuickSplitChip(
                    modifier = Modifier.weight(1f),
                    label = "Add Leg",
                    onClick = {
                        legs.add(PaymentLeg(id = legCounter.value++, method = PaymentMethod.CARD))
                        showValidationError = false
                    }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Payment legs
            legs.forEachIndexed { index, leg ->
                SplitPaymentLeg(
                    leg = leg,
                    legIndex = index + 1,
                    canRemove = legs.size > 1,
                    onAmountChanged = { newCents ->
                        legs[index] = leg.copy(amountCents = newCents)
                        showValidationError = false
                    },
                    onMethodChanged = { newMethod ->
                        legs[index] = leg.copy(method = newMethod)
                    },
                    onRemove = {
                        if (legs.size > 1) {
                            legs.removeAt(index)
                            showValidationError = false
                        }
                    }
                )
                if (index < legs.size - 1) {
                    Spacer(modifier = Modifier.height(10.dp))
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Confirm button
            val remainingFormattedForButton = remember(remainingCents) {
                formatSgd(remainingCents.coerceAtLeast(0))
            }
            GridPrimaryButton(
                text = if (isExact) "Confirm Split Payment" else "Enter Remaining $remainingFormattedForButton",
                enabled = isExact && !hasEmptyLegs,
                onClick = {
                    if (isExact && !hasEmptyLegs) {
                        onConfirm(legs.toList())
                    } else {
                        showValidationError = true
                    }
                }
            )

            Spacer(modifier = Modifier.height(12.dp))

            GridSecondaryButton(
                text = "Back to Payment Methods",
                onClick = onBack
            )

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SplitPaymentLeg(
    leg: PaymentLeg,
    legIndex: Int,
    canRemove: Boolean,
    onAmountChanged: (Long) -> Unit,
    onMethodChanged: (PaymentMethod) -> Unit,
    onRemove: () -> Unit
) {
    // Local text state for the amount field (in dollars string)
    var amountText by remember(leg.id) {
        val dollars = leg.amountCents / 100.0
        mutableStateOf(if (leg.amountCents > 0L) String.format("%.2f", dollars) else "")
    }
    var methodExpanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = GridSurface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            // Leg header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Colored dot indicator
                val dotColor = when (leg.method) {
                    PaymentMethod.CARD -> GridPrimary
                    PaymentMethod.PAYNOW -> GridPrimaryDark
                    PaymentMethod.CASH -> GridPrimaryLight
                }
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(dotColor)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    "Leg $legIndex",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = GridTextPrimary,
                    modifier = Modifier.weight(1f)
                )
                // Remove leg button
                if (canRemove) {
                    IconButton(
                        onClick = onRemove,
                        modifier = Modifier.size(32.dp)
                    ) {
                        Text(
                            "✕",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 16.sp,
                            color = GridTextSecondary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Amount input row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "S\$",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = GridPrimary
                )
                Spacer(modifier = Modifier.width(8.dp))
                OutlinedTextField(
                    value = amountText,
                    onValueChange = { newValue ->
                        // Allow only digits and one decimal point
                        val filtered = newValue.filter { c -> c.isDigit() || c == '.' }
                        // Limit to two decimal places
                        val parts = filtered.split(".")
                        val valid = if (parts.size > 1) {
                            parts[0] + "." + parts[1].take(2)
                        } else {
                            filtered
                        }
                        amountText = valid

                        // Convert to cents
                        val cents = if (valid.isNotEmpty()) {
                            try {
                                val dollarValue = valid.toDouble()
                                (dollarValue * 100).toLong()
                            } catch (e: NumberFormatException) {
                                0L
                            }
                        } else {
                            0L
                        }
                        onAmountChanged(cents)
                    },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            "0.00",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 18.sp,
                            color = GridTextSecondary
                        )
                    },
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = GridTextPrimary,
                        textAlign = TextAlign.End
                    ),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    shape = RoundedCornerShape(8.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = GridPrimary,
                        unfocusedBorderColor = GridTextSecondary.copy(alpha = 0.3f),
                        cursorColor = GridPrimary
                    )
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Method selector
            Text(
                "Payment Method",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 12.sp,
                color = GridTextSecondary
            )
            Spacer(modifier = Modifier.height(4.dp))

            Box {
                Card(
                    onClick = { methodExpanded = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = GridBackground
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val methodIcon = when (leg.method) {
                            PaymentMethod.CARD -> Icons.Default.CreditCard
                            PaymentMethod.PAYNOW -> Icons.Default.QrCodeScanner
                            PaymentMethod.CASH -> Icons.Default.Payments
                        }
                        Icon(
                            imageVector = methodIcon,
                            contentDescription = leg.method.displayName,
                            tint = GridPrimary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            leg.method.displayName,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                            color = GridTextPrimary,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            "▾",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = GridTextSecondary
                        )
                    }
                }

                DropdownMenu(
                    expanded = methodExpanded,
                    onDismissRequest = { methodExpanded = false },
                    modifier = Modifier
                        .fillMaxWidth(0.7f)
                        .background(GridSurface)
                ) {
                    PaymentMethod.entries.forEach { method ->
                        DropdownMenuItem(
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    val icon = when (method) {
                                        PaymentMethod.CARD -> Icons.Default.CreditCard
                                        PaymentMethod.PAYNOW -> Icons.Default.QrCodeScanner
                                        PaymentMethod.CASH -> Icons.Default.Payments
                                    }
                                    Icon(
                                        imageVector = icon,
                                        contentDescription = method.displayName,
                                        tint = GridPrimary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Text(
                                        method.displayName,
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 14.sp,
                                        color = GridTextPrimary
                                    )
                                    if (method == leg.method) {
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            "✓",
                                            fontFamily = InterFontFamily,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 14.sp,
                                            color = GridPrimary
                                        )
                                    }
                                }
                            },
                            onClick = {
                                onMethodChanged(method)
                                methodExpanded = false
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickSplitChip(
    modifier: Modifier = Modifier,
    label: String,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(
            containerColor = GridPrimary.copy(alpha = 0.1f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = GridPrimary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp)
        )
    }
}

// ─── Existing composables (unchanged below) ────────────────────────────────

@Composable
private fun TapToPayButton(onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = GridPrimary),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.CreditCard,
                    contentDescription = "Tap to Pay",
                    tint = Color.White,
                    modifier = Modifier.size(28.dp)
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Tap to Pay",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = Color.White
                )
                Text(
                    "Contactless card, phone or watch",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.8f)
                )
            }
            Icon(
                imageVector = Icons.Default.Nfc,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(32.dp)
            )
        }
    }
}

@Composable
private fun PaymentCollectingContent(
    onCancel: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Pulsing NFC card animation
        Box(
            modifier = Modifier
                .size(140.dp)
                .scale(pulseScale)
                .clip(RoundedCornerShape(20.dp))
                .background(GridPrimary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(GridPrimaryLight)
                    .clickable(enabled = false) {},
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.Nfc,
                        contentDescription = "NFC",
                        tint = GridPrimaryDark,
                        modifier = Modifier.size(40.dp)
                    )
                    Text(
                        "TAP",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        color = GridPrimaryDark
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = "Tap your card or phone to the terminal",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 20.sp,
            color = GridTextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Hold your card or device near the reader",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(40.dp))

        TextButton(onClick = onCancel) {
            Text(
                "Cancel",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                color = GridError
            )
        }
    }
}

@Composable
private fun PaymentProcessingContent() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(72.dp),
            color = GridPrimary,
            strokeWidth = 6.dp
        )

        Spacer(modifier = Modifier.height(32.dp))

        Text(
            "Processing Payment...",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 20.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            "Please wait while we confirm your payment",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun PaymentSuccessContent(
    amountCents: Long,
    paymentIntentId: String,
    printState: PrintState,
    onPrintTrigger: () -> Unit,
    onPrintRetry: () -> Unit,
    onPrintSkip: () -> Unit,
    onDone: () -> Unit
) {
    val formattedAmount = remember(amountCents) {
        formatSgd(amountCents)
    }

    // Trigger printing when this screen appears
    LaunchedEffect(Unit) {
        if (printState == PrintState.Idle) {
            onPrintTrigger()
        }
    }

    // Render based on print state
    when (printState) {
        PrintState.Idle,
        PrintState.Printing -> {
            PrintProgressContent(formattedAmount, paymentIntentId)
        }
        PrintState.Success -> {
            PrintSuccessContent(formattedAmount, paymentIntentId, onDone)
        }
        is PrintState.Failed -> {
            PrintFailedContent(
                formattedAmount = formattedAmount,
                paymentIntentId = paymentIntentId,
                errorMessage = (printState as PrintState.Failed).errorMessage,
                onRetry = onPrintRetry,
                onSkip = onPrintSkip
            )
        }
        PrintState.NotAvailable -> {
            PrintNotAvailableContent(formattedAmount, paymentIntentId, onDone)
        }
    }
}

@Composable
private fun PrintProgressContent(formattedAmount: String, paymentIntentId: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Green checkmark circle
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(GridSuccess.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = "Payment Successful",
                tint = GridSuccess,
                modifier = Modifier.size(72.dp)
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            "Payment Successful",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = GridSuccess
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            formattedAmount,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 36.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            "Order #${paymentIntentId.takeLast(8).uppercase()}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Printing indicator
        CircularProgressIndicator(
            modifier = Modifier.size(28.dp),
            color = GridPrimary,
            strokeWidth = 3.dp
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            "Printing Receipt...",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(6.dp))

        Icon(
            imageVector = Icons.Default.LocalPrintshop,
            contentDescription = "Printing",
            tint = GridPrimary,
            modifier = Modifier.size(32.dp)
        )
    }
}

@Composable
private fun PrintSuccessContent(
    formattedAmount: String,
    paymentIntentId: String,
    onDone: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(GridSuccess.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = "Payment Successful",
                tint = GridSuccess,
                modifier = Modifier.size(72.dp)
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            "Payment Successful",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = GridSuccess
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            formattedAmount,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 36.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            "Order #${paymentIntentId.takeLast(8).uppercase()}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            "✓ Receipt printed",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridSuccess
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            "Starting new order...",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 13.sp,
            color = GridTextSecondary
        )
    }
}

@Composable
private fun PrintFailedContent(
    formattedAmount: String,
    paymentIntentId: String,
    errorMessage: String,
    onRetry: () -> Unit,
    onSkip: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Green checkmark (payment was still successful)
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(GridSuccess.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = "Payment Successful",
                tint = GridSuccess,
                modifier = Modifier.size(48.dp)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            "Payment Successful",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            color = GridSuccess
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Print failed warning
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(GridError.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Error,
                contentDescription = "Print Failed",
                tint = GridError,
                modifier = Modifier.size(28.dp)
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            "Receipt Print Failed",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            color = GridError
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            errorMessage,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(28.dp))

        GridPrimaryButton(
            text = "Reprint Receipt",
            onClick = onRetry
        )

        Spacer(modifier = Modifier.height(12.dp))

        GridSecondaryButton(
            text = "Continue Without Receipt",
            onClick = onSkip
        )
    }
}

@Composable
private fun PrintNotAvailableContent(
    formattedAmount: String,
    paymentIntentId: String,
    onDone: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(GridSuccess.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = "Payment Successful",
                tint = GridSuccess,
                modifier = Modifier.size(72.dp)
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            "Payment Successful",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = GridSuccess
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            formattedAmount,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 36.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            "Order #${paymentIntentId.takeLast(8).uppercase()}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = "No Printer",
            tint = Color(0xFFFFC107),
            modifier = Modifier.size(40.dp)
        )

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            "Printer not available",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            "Order completed without receipt",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 13.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(32.dp))

        GridPrimaryButton(
            text = "Done",
            onClick = onDone
        )
    }
}

@Composable
private fun PaymentErrorContent(
    message: String,
    onRetry: () -> Unit,
    onCancel: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Red X circle
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(GridError.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Error,
                contentDescription = "Payment Failed",
                tint = GridError,
                modifier = Modifier.size(72.dp)
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            "Payment Failed",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = GridError
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            message,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 15.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(32.dp))

        GridPrimaryButton(
            text = "Try Again",
            onClick = onRetry
        )

        Spacer(modifier = Modifier.height(12.dp))

        TextButton(onClick = onCancel) {
            Text(
                "Cancel Payment",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                color = GridTextSecondary
            )
        }
    }
}

@Composable
private fun PaymentMethodCard(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = GridSurface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = GridPrimary,
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = label,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = GridTextPrimary,
                textAlign = TextAlign.Center
            )
        }
    }
}

/**
 * Format a Long amount in cents to an SGD currency string.
 * E.g., 1530L → "S$15.30"
 */
internal fun formatSgd(cents: Long): String {
    val dollars = cents / 100.0
    val format = NumberFormat.getCurrencyInstance(Locale("en", "SG"))
    format.minimumFractionDigits = 2
    format.maximumFractionDigits = 2
    return format.format(dollars)
}