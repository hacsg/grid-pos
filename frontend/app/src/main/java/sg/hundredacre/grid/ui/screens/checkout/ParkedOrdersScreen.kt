package sg.hundredacre.grid.ui.screens.checkout

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import sg.hundredacre.grid.ui.theme.GridWarning
import sg.hundredacre.grid.ui.theme.InterFontFamily
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ────────────────────────────────────────────────────────────────
// Parked Order data class
// ────────────────────────────────────────────────────────────────
data class ParkedOrder(
    val id: Long,
    val customerName: String?,
    val items: List<IsCartItem>,
    val total: Double,
    val itemCount: Int,
    val parkedAt: Long = System.currentTimeMillis()
)

data class IsCartItem(
    val name: String,
    val modifierDescription: String?,
    val unitPrice: Double,
    val quantity: Int
)

// ────────────────────────────────────────────────────────────────
// Park Order Dialog (bottom sheet / dialog to park current cart)
// ────────────────────────────────────────────────────────────────

@Composable
fun ParkOrderDialog(
    isVisible: Boolean,
    itemCount: Int,
    total: Double,
    onDismiss: () -> Unit,
    onPark: (String?) -> Unit
) {
    if (!isVisible) return

    var customerName by remember { mutableStateOf("") }
    var showNameInput by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(GridOverlay)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .width(400.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(GridBackground)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {} // consume click
                )
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Icon
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(GridPrimary.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.PauseCircle,
                    contentDescription = null,
                    tint = GridPrimary,
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Park Current Order",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = GridTextPrimary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "$itemCount item${if (itemCount != 1) "s" else ""} · S$${String.format("%.2f", total)}",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 15.sp,
                color = GridTextSecondary
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Order will auto-expire after 2 hours",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 12.sp,
                color = GridTextSecondary.copy(alpha = 0.7f)
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Optional customer name
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(GridSurface)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = { showNameInput = !showNameInput }
                    )
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (showNameInput && customerName.isNotBlank()) customerName
                    else "Add customer name (optional)",
                    fontFamily = InterFontFamily,
                    fontWeight = if (customerName.isNotBlank()) FontWeight.Medium else FontWeight.Normal,
                    fontSize = 15.sp,
                    color = if (customerName.isNotBlank()) GridTextPrimary else GridTextSecondary
                )
                Text(
                    text = if (showNameInput) "▲" else "▼",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = GridTextSecondary
                )
            }

            if (showNameInput) {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = customerName,
                    onValueChange = { customerName = it },
                    label = { Text("Customer name") },
                    placeholder = { Text("e.g. Sarah") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    textStyle = androidx.compose.ui.text.TextStyle(
                        fontFamily = InterFontFamily,
                        fontSize = 16.sp,
                        color = GridTextPrimary
                    )
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = onDismiss,
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GridSurface,
                        contentColor = GridTextPrimary
                    )
                ) {
                    Text(
                        text = "Cancel",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                }
                Button(
                    onClick = {
                        onPark(customerName.ifBlank { null })
                    },
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GridPrimary,
                        contentColor = GridBackground
                    )
                ) {
                    Text(
                        text = "Park Order",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp
                    )
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Parked Orders List Screen (full screen)
// ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ParkedOrdersScreen(
    parkedOrders: List<ParkedOrder>,
    onNavigateBack: () -> Unit,
    onRecallOrder: (ParkedOrder) -> Unit,
    onDeleteOrder: (Long) -> Unit
) {
    // Filter out expired orders (2 hours)
    val now = System.currentTimeMillis()
    val twoHoursMs = 2 * 60 * 60 * 1000L
    val activeOrders = parkedOrders.filter { (now - it.parkedAt) < twoHoursMs }
    val expiredOrders = parkedOrders.filter { (now - it.parkedAt) >= twoHoursMs }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(GridPrimary.copy(alpha = 0.1f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.PauseCircle,
                                contentDescription = null,
                                tint = GridPrimary,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        Column {
                            Text(
                                text = "Parked Orders",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Bold,
                                fontSize = 18.sp,
                                color = GridTextPrimary
                            )
                            if (activeOrders.isNotEmpty()) {
                                Text(
                                    text = "${activeOrders.size} active",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Normal,
                                    fontSize = 12.sp,
                                    color = GridTextSecondary
                                )
                            }
                        }
                    }
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
                colors = TopAppBarDefaults.topAppBarColors(containerColor = GridBackground)
            )
        },
        containerColor = GridBackground
    ) { padding ->
        if (activeOrders.isEmpty() && expiredOrders.isEmpty()) {
            // Empty state
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.PauseCircle,
                        contentDescription = null,
                        tint = GridBorderMedium,
                        modifier = Modifier.size(64.dp)
                    )
                    Text(
                        text = "No Parked Orders",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 18.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        text = "Hold an order from the checkout sidebar to park it here",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary.copy(alpha = 0.7f)
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Active orders
                items(activeOrders) { order ->
                    ParkedOrderCard(
                        order = order,
                        isExpired = false,
                        onRecall = { onRecallOrder(order) },
                        onDelete = { onDeleteOrder(order.id) }
                    )
                }

                // Expired section header
                if (expiredOrders.isNotEmpty()) {
                    item {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(4.dp)
                                    .clip(CircleShape)
                                    .background(GridBorderMedium)
                            )
                            Text(
                                text = "Expired",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 13.sp,
                                color = GridTextSecondary
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }

                items(expiredOrders) { order ->
                    ParkedOrderCard(
                        order = order,
                        isExpired = true,
                        onRecall = { /* cannot recall expired */ },
                        onDelete = { onDeleteOrder(order.id) }
                    )
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Parked Order Card (individual item)
// ────────────────────────────────────────────────────────────────

@Composable
private fun ParkedOrderCard(
    order: ParkedOrder,
    isExpired: Boolean,
    onRecall: () -> Unit,
    onDelete: () -> Unit
) {
    val cardBg by animateColorAsState(
        targetValue = if (isExpired) GridDisabledBg.copy(alpha = 0.5f) else GridSurface,
        label = "cardBg",
        animationSpec = spring(dampingRatio = 0.7f)
    )

    val timeAgo = formatTimeAgo(order.parkedAt)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(cardBg)
            .border(
                width = if (isExpired) 1.dp else 0.dp,
                color = GridBorderMedium.copy(alpha = 0.5f),
                shape = RoundedCornerShape(14.dp)
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { if (!isExpired) onRecall() }
            )
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            // Left: customer info and order details
            Column(modifier = Modifier.weight(1f)) {
                // Customer name or "Walk-in"
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = order.customerName ?: "Walk-in",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = if (isExpired) GridTextSecondary else GridTextPrimary
                    )
                    if (isExpired) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(GridBorderMedium)
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "Expired",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 10.sp,
                                color = GridTextSecondary
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Item count
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ShoppingCart,
                            contentDescription = null,
                            tint = GridTextSecondary,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = "${order.itemCount} item${if (order.itemCount != 1) "s" else ""}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 13.sp,
                            color = GridTextSecondary
                        )
                    }

                    // Time parked
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Schedule,
                            contentDescription = null,
                            tint = GridTextSecondary,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = timeAgo,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 13.sp,
                            color = GridTextSecondary
                        )
                    }
                }

                if (order.items.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    // Show first few items as a preview
                    val previewItems = order.items.take(2)
                    previewItems.forEach { item ->
                        Text(
                            text = "${item.quantity}x ${item.name}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 12.sp,
                            color = GridTextSecondary.copy(alpha = 0.8f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (order.items.size > 2) {
                        Text(
                            text = "+${order.items.size - 2} more",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = 12.sp,
                            color = GridTextSecondary.copy(alpha = 0.6f)
                        )
                    }
                }
            }

            // Right: total + actions
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "S$${String.format("%.2f", order.total)}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = if (isExpired) GridTextSecondary else GridPrimary
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    if (!isExpired) {
                        // Recall button
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(GridPrimary.copy(alpha = 0.1f))
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onRecall
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Restore,
                                contentDescription = "Recall order",
                                tint = GridPrimary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    // Delete button (always available)
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(GridError.copy(alpha = 0.1f))
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = onDelete
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = "Delete order",
                            tint = GridError,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Utility functions
// ────────────────────────────────────────────────────────────────

private fun formatTimeAgo(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp

    return when {
        diff < 60_000 -> "Just now"
        diff < 3_600_000 -> "${diff / 60_000}m ago"
        diff < 7_200_000 -> "${diff / 3_600_000}h ago"
        else -> {
            val sdf = SimpleDateFormat("h:mm a", Locale.getDefault())
            sdf.format(Date(timestamp))
        }
    }
}

// GridOverlay for the park dialog
private val GridOverlay = Color(0x80000000)