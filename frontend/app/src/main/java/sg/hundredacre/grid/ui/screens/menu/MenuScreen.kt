package sg.hundredacre.grid.ui.screens.menu

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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardMembership
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.data.api.CustomerData
import sg.hundredacre.grid.ui.components.CartItemRow
import sg.hundredacre.grid.ui.components.GridPrimaryButton
import sg.hundredacre.grid.ui.components.GridSecondaryButton
import sg.hundredacre.grid.ui.components.ProductCard
import sg.hundredacre.grid.ui.screens.checkout.DiscountResult
import sg.hundredacre.grid.ui.screens.checkout.DiscountSheet
import sg.hundredacre.grid.ui.screens.checkout.IsCartItem
import sg.hundredacre.grid.ui.screens.checkout.LoyaltyRedemptionResult
import sg.hundredacre.grid.ui.screens.checkout.ParkOrderDialog
import sg.hundredacre.grid.ui.screens.checkout.ParkedOrder
import sg.hundredacre.grid.ui.screens.checkout.ParkedOrdersScreen
import sg.hundredacre.grid.ui.loyalty.LoyaltyBottomSheet
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorder
import sg.hundredacre.grid.ui.theme.GridBorderMedium
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.InterFontFamily

@Composable
fun MenuScreen(
    onNavigateToCart: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    var selectedCategory by remember { mutableStateOf("All") }

    // ── Cart state ──
    val cartItems = remember {
        mutableStateListOf(
            CartItem("Pistachio", null, 5.50, 2),
            CartItem("Dark Chocolate", null, 5.50, 1),
            CartItem("Mango Sorbet", "Small", 5.50, 1),
        )
    }

    // ── Discount state ──
    var showDiscountSheet by remember { mutableStateOf(false) }
    var activeDiscount by remember { mutableStateOf<DiscountResult?>(null) }

    // ── Loyalty state ──
    var showLoyaltySheet by remember { mutableStateOf(false) }
    var activeLoyaltyRedemption by remember { mutableStateOf<LoyaltyRedemptionResult?>(null) }
    var activeLoyaltyCustomer by remember { mutableStateOf<CustomerData?>(null) }

    // ── Parked orders state ──
    val parkedOrders = remember { mutableStateListOf<ParkedOrder>() }
    var showParkDialog by remember { mutableStateOf(false) }
    var showParkedOrdersList by remember { mutableStateOf(false) }

    // Unique ID counter for parked orders
    var parkedOrderIdCounter by remember { mutableStateOf(0L) }

    val categories = listOf("All", "Gelato", "Sorbet", "Milkshakes", "Toppings", "Specials")
    val sampleProducts = listOf(
        ProductCardData("Pistachio", 5.50, null, false),
        ProductCardData("Dark Chocolate", 5.50, null, false),
        ProductCardData("Mango Sorbet", 5.50, null, false),
        ProductCardData("Strawberry", 5.00, null, false),
        ProductCardData("Matcha", 6.00, null, false),
        ProductCardData("Salted Caramel", 5.50, null, true),
        ProductCardData("Vanilla Bean", 5.00, null, false),
        ProductCardData("Chocolate Fudge", 6.50, null, false),
        ProductCardData("Cookies & Cream", 5.50, null, false),
        ProductCardData("Honey Lavender", 6.00, null, false),
        ProductCardData("Limoncello", 6.50, null, false),
        ProductCardData("Raspberry Sorbet", 5.50, null, false),
    )

    val filteredProducts = if (selectedCategory == "All") sampleProducts
    else sampleProducts // In production this would filter by category

    // Modifier sheet state
    var showModifierSheet by remember { mutableStateOf(false) }
    var selectedProduct by remember { mutableStateOf<ProductCardData?>(null) }

    // ── Apply discount to totals ──
    fun applyDiscount(subtotal: Double): Double {
        return if (activeDiscount != null) {
            subtotal - activeDiscount!!.discountAmount
        } else {
            subtotal
        }
    }

    // ── Main content ──
    if (showParkedOrdersList) {
        ParkedOrdersScreen(
            parkedOrders = parkedOrders.toList(),
            onNavigateBack = { showParkedOrdersList = false },
            onRecallOrder = { order ->
                // Restore cart from parked order
                cartItems.clear()
                order.items.forEach { item ->
                    cartItems.add(CartItem(item.name, item.modifierDescription, item.unitPrice, item.quantity))
                }
                parkedOrders.removeAll { it.id == order.id }
                showParkedOrdersList = false
            },
            onDeleteOrder = { id ->
                parkedOrders.removeAll { it.id == id }
            }
        )
    } else {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .background(GridBackground)
        ) {
            // ──────────────────────────────────────────────
            // LEFT SECTION (60%): Category sidebar + Product grid
            // ──────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .weight(0.6f)
                    .fillMaxHeight()
            ) {
                CategorySidebar(
                    categories = categories,
                    selectedCategory = selectedCategory,
                    onCategorySelected = { selectedCategory = it }
                )

                // Product grid area
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                ) {
                    // ── Header bar with toolbar icons ──
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 20.dp, end = 16.dp, top = 16.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = selectedCategory,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 22.sp,
                            color = GridTextPrimary
                        )
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Parked orders icon with badge
                            Box {
                                IconButton(onClick = { showParkedOrdersList = true }) {
                                    Icon(
                                        imageVector = Icons.Default.PauseCircle,
                                        contentDescription = "Parked orders",
                                        tint = if (parkedOrders.isNotEmpty()) GridPrimary else GridTextSecondary
                                    )
                                }
                                if (parkedOrders.isNotEmpty()) {
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = GridPrimary,
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(end = 4.dp, top = 4.dp)
                                    ) {
                                        Text(
                                            text = "${parkedOrders.size}",
                                            fontFamily = InterFontFamily,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 10.sp,
                                            color = GridBackground,
                                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                        )
                                    }
                                }
                            }

                            // Loyalty lookup icon
                            IconButton(onClick = { showLoyaltySheet = true }) {
                                Icon(
                                    imageVector = Icons.Default.CardMembership,
                                    contentDescription = "Loyalty",
                                    tint = if (activeLoyaltyCustomer != null || activeLoyaltyRedemption != null) {
                                        GridPrimary
                                    } else {
                                        GridTextSecondary
                                    }
                                )
                            }

                            // Settings icon
                            IconButton(onClick = onNavigateToSettings) {
                                Icon(
                                    imageVector = Icons.Default.Settings,
                                    contentDescription = "Settings",
                                    tint = GridTextSecondary
                                )
                            }
                        }
                    }

                    // Sub-header: item count hint
                    Text(
                        text = "${filteredProducts.size} items",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 13.sp,
                        color = GridTextSecondary,
                        modifier = Modifier.padding(start = 20.dp, bottom = 8.dp)
                    )

                    // Product grid — 4 columns for 15.6" screen
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(4),
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            bottom = 16.dp
                        ),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(end = 4.dp)
                    ) {
                        items(filteredProducts) { product ->
                            ProductCard(
                                imageUrl = product.imageUrl,
                                title = product.name,
                                price = product.price,
                                isSoldOut = product.isSoldOut,
                                onClick = {
                                    selectedProduct = product
                                    showModifierSheet = true
                                },
                                modifier = Modifier.heightIn(min = 140.dp)
                            )
                        }
                    }
                }
            }

            // ──────────────────────────────────────────────
            // RIGHT SECTION (40%): Persistent Cart Sidebar
            // ──────────────────────────────────────────────
            CartSidebar(
                cartItems = cartItems,
                activeDiscount = activeDiscount,
                activeLoyaltyRedemption = activeLoyaltyRedemption,
                activeLoyaltyCustomer = activeLoyaltyCustomer,
                onIncrement = { index ->
                    val item = cartItems[index]
                    cartItems[index] = item.copy(quantity = item.quantity + 1)
                },
                onDecrement = { index ->
                    val item = cartItems[index]
                    if (item.quantity > 1) {
                        cartItems[index] = item.copy(quantity = item.quantity - 1)
                    } else {
                        cartItems.removeAt(index)
                    }
                },
                onClear = {
                    cartItems.clear()
                    activeDiscount = null
                    activeLoyaltyRedemption = null
                    activeLoyaltyCustomer = null
                },
                onHoldOrder = {
                    if (cartItems.isNotEmpty()) {
                        showParkDialog = true
                    }
                },
                onDiscount = {
                    showDiscountSheet = true
                }
            )

            // ── Gelato Modifier Bottom Sheet ──
            selectedProduct?.let { product ->
                GelatoModifierSheet(
                    productName = product.name,
                    basePrice = product.price,
                    scoopCount = 2, // Default: 2 scoops for gelato
                    flavors = defaultGelatoFlavors(),
                    isVisible = showModifierSheet,
                    onDismiss = {
                        showModifierSheet = false
                        selectedProduct = null
                    },
                    onAddToCart = { result ->
                        val existingIndex = cartItems.indexOfFirst { it.name == result.productName }
                        val modifierDesc = buildString {
                            append(result.selectedFlavors.joinToString(" + "))
                            if (result.container != ContainerType.Cup) {
                                append(" | ${result.container.displayName}")
                            }
                            if (result.toppings.isNotEmpty()) {
                                append(" | ${result.toppings.joinToString { it.displayName }}")
                            }
                        }
                        if (existingIndex >= 0) {
                            val existing = cartItems[existingIndex]
                            cartItems[existingIndex] = existing.copy(
                                modifierDescription = modifierDesc,
                                unitPrice = result.totalPrice,
                                quantity = existing.quantity + 1
                            )
                        } else {
                            cartItems.add(
                                CartItem(
                                    name = result.productName,
                                    modifierDescription = modifierDesc,
                                    unitPrice = result.totalPrice,
                                    quantity = 1
                                )
                            )
                        }
                    }
                )
            }
        }

        // ── Discount Bottom Sheet ──
        val subtotal = cartItems.sumOf { it.unitPrice * it.quantity }
        DiscountSheet(
            isVisible = showDiscountSheet,
            subtotal = subtotal,
            onDismiss = { showDiscountSheet = false },
            onApplyDiscount = { result ->
                activeDiscount = result
                showDiscountSheet = false
            }
        )

        // ── Plotholders Loyalty Bottom Sheet ──
        LoyaltyBottomSheet(
            isVisible = showLoyaltySheet,
            onDismiss = { showLoyaltySheet = false },
            onCustomerSelected = { customer ->
                activeLoyaltyCustomer = customer
            }
        )

        // ── Park Order Dialog ──
        val itemCount = cartItems.sumOf { it.quantity }
        val totalForPark = subtotal - (activeDiscount?.discountAmount ?: 0.0)
        ParkOrderDialog(
            isVisible = showParkDialog,
            itemCount = itemCount,
            total = totalForPark,
            onDismiss = { showParkDialog = false },
            onPark = { customerName ->
                parkedOrderIdCounter++
                val parkItems = cartItems.map { item ->
                    IsCartItem(item.name, item.modifierDescription, item.unitPrice, item.quantity)
                }
                parkedOrders.add(
                    ParkedOrder(
                        id = parkedOrderIdCounter,
                        customerName = customerName,
                        items = parkItems,
                        total = totalForPark,
                        itemCount = itemCount,
                        parkedAt = System.currentTimeMillis()
                    )
                )
                cartItems.clear()
                activeDiscount = null
                activeLoyaltyRedemption = null
                activeLoyaltyCustomer = null
                showParkDialog = false
            }
        )
    }
}

// ────────────────────────────────────────────────────────────────
// Category Sidebar — vertical tabs on the far-left edge
// ────────────────────────────────────────────────────────────────
@Composable
private fun CategorySidebar(
    categories: List<String>,
    selectedCategory: String,
    onCategorySelected: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .width(72.dp)
            .fillMaxHeight()
            .background(GridSurface)
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(8.dp))

        categories.forEach { category ->
            val isSelected = category == selectedCategory
            val containerColor = if (isSelected) GridPrimary else Color.Transparent
            val contentColor = if (isSelected) GridBackground else GridTextSecondary

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp)
                    .height(64.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(containerColor)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = { onCategorySelected(category) }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = category,
                    fontFamily = InterFontFamily,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 11.sp,
                    color = contentColor,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    lineHeight = 14.sp,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Cart Sidebar — persistent right panel with items, totals, actions
// ────────────────────────────────────────────────────────────────
@Composable
private fun CartSidebar(
    cartItems: MutableList<CartItem>,
    activeDiscount: DiscountResult?,
    activeLoyaltyRedemption: LoyaltyRedemptionResult?,
    activeLoyaltyCustomer: CustomerData?,
    onIncrement: (Int) -> Unit,
    onDecrement: (Int) -> Unit,
    onClear: () -> Unit,
    onHoldOrder: () -> Unit,
    onDiscount: () -> Unit
) {
    val subtotal = cartItems.sumOf { it.unitPrice * it.quantity }
    val tax = subtotal * 0.09
    val discountAmount = activeDiscount?.discountAmount ?: 0.0
    val loyaltyDiscount = (activeLoyaltyRedemption?.discountAmount ?: 0.0)
    val totalDiscount = discountAmount + loyaltyDiscount
    val discountedSubtotal = subtotal - totalDiscount
    val taxOnDiscounted = discountedSubtotal * 0.09
    val total = discountedSubtotal + taxOnDiscounted
    val itemCount = cartItems.sumOf { it.quantity }

    Column(
        modifier = Modifier
            .fillMaxHeight()
            .fillMaxWidth()
            .background(GridSurface)
            .border(
                width = 1.dp,
                color = GridBorder,
                shape = RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp)
            )
    ) {
        // ── Cart Header ──
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 18.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Current Order",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = GridTextPrimary
                )
                // Item count badge
                if (itemCount > 0) {
                    Surface(
                        shape = RoundedCornerShape(20.dp),
                        color = GridPrimary
                    ) {
                        Text(
                            text = "$itemCount",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            color = GridBackground,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
            }
            if (cartItems.isNotEmpty()) {
                IconButton(onClick = onClear) {
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = "Clear cart",
                        tint = GridTextSecondary
                    )
                }
            }
        }

        HorizontalDivider(color = GridBorder, thickness = 1.dp)

        // ── Discount/Loyalty chips (compact) ──
        if (activeDiscount != null || activeLoyaltyRedemption != null || activeLoyaltyCustomer != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                activeDiscount?.let { d ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = GridSuccess.copy(alpha = 0.1f)
                    ) {
                        Text(
                            text = d.discountLabel,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 11.sp,
                            color = GridSuccess,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                        )
                    }
                }
                activeLoyaltyCustomer?.let { customer ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = GridPrimary.copy(alpha = 0.1f)
                    ) {
                        Text(
                            text = "${customer.name ?: "Loyalty"} - ${customer.tier ?: "member"}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 11.sp,
                            color = GridPrimary,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                activeLoyaltyRedemption?.let { l ->
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = GridPrimary.copy(alpha = 0.1f)
                    ) {
                        Text(
                            text = "-S$${String.format("%.2f", l.discountAmount)} pts",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 11.sp,
                            color = GridPrimary,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                        )
                    }
                }
            }
        }

        // ── Cart Items List (scrollable) ──
        if (cartItems.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ShoppingCart,
                        contentDescription = null,
                        tint = GridBorderMedium,
                        modifier = Modifier.size(56.dp)
                    )
                    Text(
                        text = "Cart is empty",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 16.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        text = "Tap items on the menu to add them",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 13.sp,
                        color = GridTextSecondary.copy(alpha = 0.7f)
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                items(cartItems.indices.toList()) { index ->
                    val item = cartItems[index]
                    CartItemRow(
                        itemName = item.name,
                        modifierDescription = item.modifierDescription,
                        unitPrice = item.unitPrice,
                        quantity = item.quantity,
                        onDecrement = { onDecrement(index) },
                        onIncrement = { onIncrement(index) }
                    )
                    if (index < cartItems.lastIndex) {
                        HorizontalDivider(
                            color = GridBorder,
                            thickness = 0.5.dp
                        )
                    }
                }
            }
        }

        // ── Totals and Action Buttons ──
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp)
        ) {
            HorizontalDivider(color = GridBorder, thickness = 1.dp)
            Spacer(modifier = Modifier.height(12.dp))

            // Subtotal
            CartTotalRow(label = "Subtotal", amount = subtotal)
            Spacer(modifier = Modifier.height(4.dp))

            // Discount line (if active)
            if (activeDiscount != null) {
                CartTotalRow(
                    label = "Discount (${activeDiscount.discountLabel})",
                    amount = -activeDiscount.discountAmount,
                    valueColor = GridSuccess
                )
                Spacer(modifier = Modifier.height(4.dp))
            }

            // Loyalty discount line (if active)
            if (activeLoyaltyRedemption != null) {
                CartTotalRow(
                    label = "Loyalty (${activeLoyaltyRedemption.redeemedPoints} pts)",
                    amount = -activeLoyaltyRedemption.discountAmount,
                    valueColor = GridPrimary
                )
                Spacer(modifier = Modifier.height(4.dp))
            }

            // Tax (on discounted amount)
            CartTotalRow(label = "GST (9%)", amount = taxOnDiscounted)
            Spacer(modifier = Modifier.height(4.dp))

            // Total — prominent
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Total",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = GridTextPrimary
                )
                Text(
                    text = "S$${String.format("%.2f", total)}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = GridPrimary
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Pay button — primary CTA
            GridPrimaryButton(
                text = "Pay  S$${String.format("%.2f", total)}",
                onClick = { /* TODO: navigate to payment */ },
                modifier = Modifier.height(56.dp),
                enabled = cartItems.isNotEmpty()
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Hold + Discount — secondary actions
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                GridSecondaryButton(
                    text = "Hold Order",
                    onClick = onHoldOrder,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                )
                GridSecondaryButton(
                    text = "Discount",
                    onClick = onDiscount,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                )
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Cart total row composable (subtotal, tax, discount)
// ────────────────────────────────────────────────────────────────
@Composable
private fun CartTotalRow(
    label: String,
    amount: Double,
    valueColor: androidx.compose.ui.graphics.Color = GridTextSecondary
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
            text = if (amount < 0) "-S$${String.format("%.2f", -amount)}" else "S$${String.format("%.2f", amount)}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = valueColor
        )
    }
}

// ────────────────────────────────────────────────────────────────
// Data classes
// ────────────────────────────────────────────────────────────────
private data class CartItem(
    val name: String,
    val modifierDescription: String?,
    val unitPrice: Double,
    val quantity: Int
)

private data class ProductCardData(
    val name: String,
    val price: Double,
    val imageUrl: String?,
    val isSoldOut: Boolean
)
