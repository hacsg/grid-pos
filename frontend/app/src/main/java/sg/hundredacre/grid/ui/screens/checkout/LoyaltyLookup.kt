package sg.hundredacre.grid.ui.screens.checkout

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CardMembership
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorder
import sg.hundredacre.grid.ui.theme.GridBorderMedium
import sg.hundredacre.grid.ui.theme.GridDisabledBg
import sg.hundredacre.grid.ui.theme.GridDisabledText
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryDark
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.InterFontFamily

// ────────────────────────────────────────────────────────────────
// Loyalty member data
// ────────────────────────────────────────────────────────────────
data class LoyaltyMember(
    val name: String,
    val pointsBalance: Int,
    val tier: String,         // "Bronze", "Silver", "Gold", "Platinum"
    val phoneNumber: String
)

data class LoyaltyRedemptionResult(
    val redeemedPoints: Int,
    val discountAmount: Double,
    val remainingPoints: Int,
    val pointsEarnedThisVisit: Int
)

// ────────────────────────────────────────────────────────────────
// Loyalty Lookup Bottom Sheet
// ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoyaltyLookupSheet(
    isVisible: Boolean,
    subtotal: Double,
    onDismiss: () -> Unit,
    onRedeem: (LoyaltyRedemptionResult) -> Unit
) {
    if (!isVisible) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // ── State ──
    var phoneNumber by remember { mutableStateOf("") }
    var hasSearched by remember { mutableStateOf(false) }
    var foundMember by remember { mutableStateOf<LoyaltyMember?>(null) }
    var showSuccess by remember { mutableStateOf(false) }
    var redeemEnabled by remember { mutableStateOf(false) }
    var pointsToRedeem by remember { mutableIntStateOf(0) }
    var finalRemainingPoints by remember { mutableIntStateOf(0) }
    var pointsEarned by remember { mutableIntStateOf(0) }
    var finalDiscountAmount by remember { mutableDoubleStateOf(0.0) }

    // Simulated member lookup
    fun lookupMember(phone: String) {
        hasSearched = true
        // In production, this would call an API
        val cleaned = phone.filter { it.isDigit() }
        if (cleaned.length >= 8) {
            foundMember = LoyaltyMember(
                name = "Sarah Lim",
                pointsBalance = 1280,
                tier = "Gold",
                phoneNumber = cleaned
            )
        } else {
            foundMember = null
        }
    }

    fun handleToggle(enabled: Boolean) {
        redeemEnabled = enabled
        // Simulate: 100 points = S$5 off, max 500 points (S$25)
        val availablePoints = foundMember?.pointsBalance ?: 0
        pointsToRedeem = if (enabled) minOf(availablePoints, 500) else 0
        finalDiscountAmount = if (enabled) (pointsToRedeem / 100.0) * 5.0 else 0.0
        finalRemainingPoints = if (enabled) availablePoints - pointsToRedeem else availablePoints
        pointsEarned = (subtotal / 10).toInt() // 1 point per S$10 spent
    }

    fun handleRedeem() {
        showSuccess = true
        onRedeem(
            LoyaltyRedemptionResult(
                redeemedPoints = pointsToRedeem,
                discountAmount = finalDiscountAmount,
                remainingPoints = finalRemainingPoints,
                pointsEarnedThisVisit = pointsEarned
            )
        )
    }

    ModalBottomSheet(
        onDismissRequest = {
            if (!showSuccess) onDismiss()
            else {
                showSuccess = false
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
                                imageVector = Icons.Default.CardMembership,
                                contentDescription = null,
                                tint = GridPrimary,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                        Text(
                            text = "Loyalty Lookup",
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
                                    if (!showSuccess) onDismiss()
                                    else {
                                        showSuccess = false
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

                if (!showSuccess) {
                    // ── Search Section ──
                    if (foundMember == null) {
                        Text(
                            text = "Find Member",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = GridTextSecondary,
                            modifier = Modifier.padding(bottom = 10.dp)
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = phoneNumber,
                                onValueChange = {
                                    if (it.all { c -> c.isDigit() || c == '+' || c == '-' || c == ' ' }) {
                                        phoneNumber = it
                                        hasSearched = false
                                        foundMember = null
                                    }
                                },
                                label = { Text("Phone number") },
                                placeholder = { Text("+65 9123 4567") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                                textStyle = androidx.compose.ui.text.TextStyle(
                                    fontFamily = InterFontFamily,
                                    fontSize = 16.sp,
                                    color = GridTextPrimary
                                )
                            )

                            // Search button
                            Button(
                                onClick = { lookupMember(phoneNumber) },
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.height(56.dp),
                                enabled = phoneNumber.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GridPrimary,
                                    contentColor = GridBackground,
                                    disabledContainerColor = GridDisabledBg,
                                    disabledContentColor = GridDisabledText
                                )
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Search,
                                    contentDescription = "Search",
                                    modifier = Modifier.size(22.dp)
                                )
                            }

                            // QR scan button
                            OutlinedButton(
                                onClick = { /* TODO: launch QR scanner */ },
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.height(56.dp),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = GridPrimary
                                ),
                                border = ButtonDefaults.outlinedButtonBorder(
                                    width = 1.dp,
                                    color = GridBorderMedium
                                )
                            ) {
                                Icon(
                                    imageVector = Icons.Default.CameraAlt,
                                    contentDescription = "Scan QR",
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }

                        // No result message
                        if (hasSearched && foundMember == null) {
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = "No member found with this number. Try again or scan a QR code.",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Normal,
                                fontSize = 14.sp,
                                color = GridTextSecondary,
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }

                    // ── Member Card ──
                    AnimatedVisibility(
                        visible = foundMember != null,
                        enter = fadeIn() + slideInVertically { it / 2 },
                        exit = fadeOut() + slideOutVertically { it / 2 }
                    ) {
                        foundMember?.let { member ->
                            Spacer(modifier = Modifier.height(20.dp))
                            MemberCard(member = member)

                            Spacer(modifier = Modifier.height(20.dp))

                            // ── Points Redemption Section ──
                            Text(
                                text = "Redeem Points",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp,
                                color = GridTextSecondary,
                                modifier = Modifier.padding(bottom = 4.dp)
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Redeem points for discount?",
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 15.sp,
                                        color = GridTextPrimary
                                    )
                                    if (redeemEnabled) {
                                        Text(
                                            text = "$pointsToRedeem pts → S$${String.format("%.2f", finalDiscountAmount)} off",
                                            fontFamily = InterFontFamily,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 14.sp,
                                            color = GridPrimary
                                        )
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            text = "${member.pointsBalance} pts available (max 500 pts per order)",
                                            fontFamily = InterFontFamily,
                                            fontWeight = FontWeight.Normal,
                                            fontSize = 12.sp,
                                            color = GridTextSecondary
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(12.dp))
                                Switch(
                                    checked = redeemEnabled,
                                    onCheckedChange = { handleToggle(it) },
                                    colors = SwitchDefaults.colors(
                                        checkedThumbColor = GridBackground,
                                        checkedTrackColor = GridPrimary,
                                        uncheckedThumbColor = GridTextSecondary,
                                        uncheckedTrackColor = GridBorder,
                                    )
                                )
                            }

                            Spacer(modifier = Modifier.height(24.dp))

                            // ── Apply Button ──
                            Button(
                                onClick = { handleRedeem() },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(56.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GridPrimary,
                                    contentColor = GridBackground,
                                    disabledContainerColor = GridDisabledBg,
                                    disabledContentColor = GridDisabledText
                                )
                            ) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Star,
                                        contentDescription = null,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Text(
                                        text = if (redeemEnabled) "Apply Redemption" else "Continue without Redemption",
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 16.sp
                                    )
                                }
                            }
                        }
                    }
                }

                // ── Success Screen ──
                if (showSuccess) {
                    SuccessScreen(
                        redeemedPoints = pointsToRedeem,
                        discountAmount = finalDiscountAmount,
                        remainingPoints = finalRemainingPoints,
                        pointsEarned = pointsEarned,
                        onDone = {
                            showSuccess = false
                            onDismiss()
                        }
                    )
                }
            }

            // Bottom padding
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Member Card (premium loyalty card UI)
// ────────────────────────────────────────────────────────────────

@Composable
private fun MemberCard(member: LoyaltyMember) {
    val tierColors = when (member.tier) {
        "Platinum" -> listOf(Color(0xFF667EEA), Color(0xFF764BA2))
        "Gold" -> listOf(Color(0xFFF2994A), Color(0xFFF2C94C))
        "Silver" -> listOf(Color(0xFFB8C6DB), Color(0xFFF5F7FA))
        else -> listOf(Color(0xFFCD7F32), Color(0xFFE6B17E)) // Bronze
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(
                Brush.horizontalGradient(tierColors)
            )
            .padding(20.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top row: name + tier badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = member.name,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp,
                        color = Color.White
                    )
                    Text(
                        text = member.phoneNumber,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.8f)
                    )
                }

                // Tier badge
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color.White.copy(alpha = 0.25f))
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Stars,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = member.tier,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp,
                            color = Color.White
                        )
                    }
                }
            }

            // Bottom row: points balance
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Column {
                    Text(
                        text = "Points Balance",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                    Text(
                        text = "${member.pointsBalance} pts",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 26.sp,
                        color = Color.White
                    )
                }

                Text(
                    text = "Hundred Acre Creamery",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 11.sp,
                    color = Color.White.copy(alpha = 0.6f)
                )
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Success Screen (post-redemption)
// ────────────────────────────────────────────────────────────────

@Composable
private fun SuccessScreen(
    redeemedPoints: Int,
    discountAmount: Double,
    remainingPoints: Int,
    pointsEarned: Int,
    onDone: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        // Success icon
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(GridPrimary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = null,
                tint = GridPrimary,
                modifier = Modifier.size(40.dp)
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Redemption Complete!",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Summary card
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(GridSurface, RoundedCornerShape(14.dp))
                .padding(20.dp)
        ) {
            if (redeemedPoints > 0) {
                SummaryRow(
                    label = "Points Redeemed",
                    value = "$redeemedPoints pts",
                    valueColor = GridPrimary
                )
                Spacer(modifier = Modifier.height(10.dp))
                SummaryRow(
                    label = "Discount Applied",
                    value = "-S$${String.format("%.2f", discountAmount)}",
                    valueColor = GridSuccess
                )
                Spacer(modifier = Modifier.height(10.dp))
                SummaryRow(
                    label = "Remaining Points",
                    value = "$remainingPoints pts",
                    valueColor = GridTextPrimary
                )
                Spacer(modifier = Modifier.height(10.dp))
                HorizontalDivider(color = GridBorder, thickness = 1.dp)
                Spacer(modifier = Modifier.height(10.dp))
            }

            SummaryRow(
                label = "Points Earned This Visit",
                value = "+$pointsEarned pts",
                valueColor = GridSuccess
            )
        }

        Spacer(modifier = Modifier.height(28.dp))

        Button(
            onClick = onDone,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = GridPrimary,
                contentColor = GridBackground
            )
        ) {
            Text(
                text = "Done",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp
            )
        }
    }
}

@Composable
private fun SummaryRow(
    label: String,
    value: String,
    valueColor: Color
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )
        Text(
            text = value,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            color = valueColor
        )
    }
}