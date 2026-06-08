package sg.hundredacre.grid.ui.loyalty

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import sg.hundredacre.grid.data.api.CustomerData
import sg.hundredacre.grid.data.api.LoyaltyReward
import sg.hundredacre.grid.data.api.LoyaltyVoucher
import sg.hundredacre.grid.scanner.BarcodeScannerScreen
import sg.hundredacre.grid.ui.components.GridPrimaryButton
import sg.hundredacre.grid.ui.components.GridSecondaryButton
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorder
import sg.hundredacre.grid.ui.theme.GridDisabledBg
import sg.hundredacre.grid.ui.theme.GridDisabledText
import sg.hundredacre.grid.ui.theme.GridError
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridWarning
import sg.hundredacre.grid.ui.theme.InterFontFamily

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoyaltyBottomSheet(
    isVisible: Boolean,
    onDismiss: () -> Unit,
    onCustomerSelected: (CustomerData?) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: OrderFlowViewModel = hiltViewModel()
) {
    if (!isVisible) return

    var showScanner by remember { mutableStateOf(false) }
    var phone by remember { mutableStateOf("") }
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    if (showScanner) {
        BarcodeScannerScreen(
            onScanSuccess = { value ->
                showScanner = false
                if (value.any { it.isLetter() }) {
                    viewModel.lookupLoyalty(referralCode = value)
                } else {
                    phone = value
                    viewModel.lookupLoyalty(phone = value)
                }
            },
            onClose = { showScanner = false },
            modifier = Modifier.fillMaxSize()
        )
        return
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = GridBackground,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        tonalElevation = 0.dp,
        dragHandle = null,
        modifier = modifier
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 720.dp)
                .padding(horizontal = 20.dp, vertical = 14.dp)
        ) {
            SheetHeader(onDismiss = onDismiss)
            Spacer(modifier = Modifier.height(18.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(
                    onClick = { showScanner = true },
                    modifier = Modifier.height(56.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.QrCodeScanner,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.size(8.dp))
                    Text("Scan QR/Barcode")
                }

                OutlinedTextField(
                    value = phone,
                    onValueChange = {
                        if (it.all { c -> c.isDigit() || c == '+' || c == '-' || c == ' ' }) {
                            phone = it
                        }
                    },
                    modifier = Modifier.weight(1f),
                    label = { Text("Enter Phone") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Phone,
                            contentDescription = null
                        )
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )

                Button(
                    onClick = { viewModel.lookupLoyalty(phone = phone) },
                    modifier = Modifier.height(56.dp),
                    enabled = phone.isNotBlank() && !state.isLoading,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GridPrimary,
                        contentColor = GridBackground,
                        disabledContainerColor = GridDisabledBg,
                        disabledContentColor = GridDisabledText
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Lookup loyalty customer"
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            if (state.isLoading) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 14.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(
                        color = GridPrimary,
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.size(10.dp))
                    Text(
                        text = "Checking loyalty",
                        color = GridTextSecondary,
                        fontFamily = InterFontFamily
                    )
                }
            }

            state.errorMessage?.let {
                StatusMessage(message = it, color = GridError)
                Spacer(modifier = Modifier.height(10.dp))
            }

            state.redemptionMessage?.let {
                StatusMessage(message = it, color = GridPrimary)
                Spacer(modifier = Modifier.height(10.dp))
            }

            state.customer?.let { customer ->
                CustomerCard(customer = customer)
                Spacer(modifier = Modifier.height(14.dp))
                RewardsAndVouchers(
                    customer = customer,
                    onRedeemVoucher = viewModel::redeemVoucher,
                    onRedeemReward = viewModel::redeemReward
                )
                Spacer(modifier = Modifier.height(14.dp))
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                GridSecondaryButton(
                    text = "Skip",
                    onClick = {
                        viewModel.clearLoyalty()
                        onCustomerSelected(null)
                        onDismiss()
                    },
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                )
                GridPrimaryButton(
                    text = "Continue",
                    onClick = {
                        onCustomerSelected(state.customer)
                        onDismiss()
                    },
                    enabled = state.customer != null,
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}

@Composable
private fun SheetHeader(onDismiss: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = GridPrimary.copy(alpha = 0.1f),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Stars,
                    contentDescription = null,
                    tint = GridPrimary,
                    modifier = Modifier
                        .padding(9.dp)
                        .size(22.dp)
                )
            }
            Text(
                text = "Plotholders Loyalty",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = GridTextPrimary
            )
        }
        IconButton(onClick = onDismiss) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "Close loyalty",
                tint = GridTextSecondary
            )
        }
    }
}

@Composable
fun CustomerCard(customer: CustomerData, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(GridSurface, RoundedCornerShape(8.dp))
            .border(1.dp, GridBorder, RoundedCornerShape(8.dp))
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = null,
                    tint = GridPrimary,
                    modifier = Modifier.size(28.dp)
                )
                Column {
                    Text(
                        text = customer.name ?: "Loyalty Customer",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = GridTextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = customer.phone ?: customer.email ?: customer.id,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = GridTextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            TierBadge(tier = customer.tier ?: "member")
        }

        Spacer(modifier = Modifier.height(14.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            StatBlock(
                label = "Lifetime Moments",
                value = "${customer.lifetimeMoments ?: 0}"
            )
            customer.referralCode?.let {
                StatBlock(label = "Referral Code", value = it)
            }
        }
    }
}

@Composable
private fun RewardsAndVouchers(
    customer: CustomerData,
    onRedeemVoucher: (String) -> Unit,
    onRedeemReward: (String) -> Unit
) {
    val vouchers = customer.vouchers.orEmpty()
    val rewards = customer.rewards.orEmpty()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 260.dp)
    ) {
        Text(
            text = "Available Vouchers",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            color = GridTextSecondary
        )
        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            if (vouchers.isEmpty() && rewards.isEmpty()) {
                item {
                    EmptyBenefitRow()
                }
            }
            items(vouchers, key = { it.id }) { voucher ->
                VoucherRow(voucher = voucher, onRedeem = { onRedeemVoucher(voucher.id) })
            }
            if (vouchers.isNotEmpty() && rewards.isNotEmpty()) {
                item { HorizontalDivider(color = GridBorder) }
            }
            if (rewards.isNotEmpty()) {
                item {
                    Text(
                        text = "Available Rewards",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = GridTextSecondary,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
            items(rewards, key = { it.id }) { reward ->
                RewardRow(reward = reward, onRedeem = { onRedeemReward(reward.id) })
            }
        }
    }
}

@Composable
private fun VoucherRow(voucher: LoyaltyVoucher, onRedeem: () -> Unit) {
    BenefitRow(
        iconColor = GridPrimary,
        icon = Icons.Default.LocalOffer,
        title = voucher.title ?: voucher.code ?: "Voucher",
        description = voucher.description ?: voucher.value?.let { "S$${String.format("%.2f", it)} value" },
        enabled = voucher.available != false,
        onRedeem = onRedeem
    )
}

@Composable
private fun RewardRow(reward: LoyaltyReward, onRedeem: () -> Unit) {
    BenefitRow(
        iconColor = GridWarning,
        icon = Icons.Default.CardGiftcard,
        title = reward.title ?: reward.name ?: "Reward",
        description = reward.description ?: reward.momentsRequired?.let { "$it moments required" },
        enabled = reward.available != false,
        onRedeem = onRedeem
    )
}

@Composable
private fun BenefitRow(
    iconColor: Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String?,
    enabled: Boolean,
    onRedeem: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(GridBackground, RoundedCornerShape(8.dp))
            .border(1.dp, GridBorder, RoundedCornerShape(8.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconColor,
            modifier = Modifier.size(24.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = GridTextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (!description.isNullOrBlank()) {
                Text(
                    text = description,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = GridTextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        TextButton(
            onClick = onRedeem,
            enabled = enabled,
            colors = ButtonDefaults.textButtonColors(
                contentColor = GridPrimary,
                disabledContentColor = GridDisabledText
            )
        ) {
            Text("Redeem")
        }
    }
}

@Composable
private fun EmptyBenefitRow() {
    Text(
        text = "No rewards or vouchers available.",
        fontFamily = InterFontFamily,
        fontSize = 13.sp,
        color = GridTextSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .background(GridSurface, RoundedCornerShape(8.dp))
            .padding(14.dp)
    )
}

@Composable
fun TierBadge(tier: String, modifier: Modifier = Modifier) {
    val normalizedTier = tier.lowercase()
    val color = when (normalizedTier) {
        "platinum" -> Color(0xFF6D5BD0)
        "gold" -> Color(0xFFC58B13)
        "silver" -> Color(0xFF7C8798)
        "bronze" -> Color(0xFF9A6A3A)
        else -> GridPrimary
    }

    Surface(
        color = color.copy(alpha = 0.14f),
        shape = RoundedCornerShape(999.dp),
        modifier = modifier
    ) {
        Text(
            text = normalizedTier.replaceFirstChar { it.titlecase() },
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            color = color,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
        )
    }
}

@Composable
private fun StatBlock(label: String, value: String) {
    Column {
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = GridTextSecondary
        )
        Text(
            text = value,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            color = GridTextPrimary
        )
    }
}

@Composable
private fun StatusMessage(message: String, color: Color) {
    Text(
        text = message,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        color = color,
        modifier = Modifier
            .fillMaxWidth()
            .background(color.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
            .padding(10.dp)
    )
}
