package sg.hundredacre.grid.ui.screens.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import sg.hundredacre.grid.payments.PaymentProvider
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val selectedProvider by viewModel.selectedProvider.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Settings",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            // Payment provider section
            Text(
                "Payment Provider",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = GridTextPrimary
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                "Select which payment terminal to use for card/contactless transactions.",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 13.sp,
                color = GridTextSecondary
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Radio buttons for each provider
            PaymentProvider.entries.forEach { provider ->
                val isSelected = provider == selectedProvider
                Card(
                    onClick = { viewModel.selectProvider(provider) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    shape = CardDefaults.shape,
                    colors = CardDefaults.cardColors(
                        containerColor = if (isSelected) {
                            GridPrimary.copy(alpha = 0.08f)
                        } else {
                            GridSurface
                        }
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(
                            selected = isSelected,
                            onClick = { viewModel.selectProvider(provider) },
                            colors = RadioButtonDefaults.colors(
                                selectedColor = GridPrimary
                            )
                        )
                        Column(modifier = Modifier.padding(start = 8.dp)) {
                            Text(
                                provider.displayName,
                                fontFamily = InterFontFamily,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                fontSize = 15.sp,
                                color = GridTextPrimary
                            )
                            Text(
                                descriptionFor(provider),
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Normal,
                                fontSize = 12.sp,
                                color = GridTextSecondary
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Info card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = GridSurface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "About Payment Providers",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = GridTextPrimary
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = when (selectedProvider) {
                            PaymentProvider.STRIPE_TAP_TO_PAY ->
                                "Stripe Tap to Pay uses NFC on this device to accept contactless " +
                                        "payments. No additional hardware required."
                            PaymentProvider.KPAY_WIRED ->
                                "KPay wired terminal connects via USB. The terminal processes " +
                                        "card and contactless payments independently."
                            PaymentProvider.HITPAY_WIRED ->
                                "HitPay wired terminal connects via Bluetooth. The terminal " +
                                        "processes card, PayNow QR, and contactless payments."
                        },
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 13.sp,
                        color = GridTextSecondary
                    )
                }
            }
        }
    }
}

private fun descriptionFor(provider: PaymentProvider): String = when (provider) {
    PaymentProvider.STRIPE_TAP_TO_PAY -> "NFC Tap to Pay on Android — no extra hardware"
    PaymentProvider.KPAY_WIRED -> "USB connected terminal — card & contactless"
    PaymentProvider.HITPAY_WIRED -> "Bluetooth connected terminal — card, QR & contactless"
}