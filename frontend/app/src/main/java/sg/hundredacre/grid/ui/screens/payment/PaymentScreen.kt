package sg.hundredacre.grid.ui.screens.payment

import androidx.compose.animation.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
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
                        onCash = { onPaymentComplete(null) }
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
    onCash: () -> Unit
) {
    val formattedAmount = remember(totalAmountCents) {
        formatSgd(totalAmountCents)
    }

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