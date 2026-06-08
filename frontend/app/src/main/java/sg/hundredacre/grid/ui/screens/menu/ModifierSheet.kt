package sg.hundredacre.grid.ui.screens.menu

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
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
import sg.hundredacre.grid.ui.theme.InterFontFamily

// ────────────────────────────────────────────────────────────────
// Data models
// ────────────────────────────────────────────────────────────────

data class GelatoFlavor(
    val name: String,
    val imageUrl: String? = null,
    val isSoldOut: Boolean = false
)

enum class ContainerType(val displayName: String, val priceAdjustment: Double) {
    Cup("Cup", 0.0),
    SugarCone("Sugar Cone", 0.50),
    WaffleCone("Waffle Cone", 1.00)
}

enum class Topping(val displayName: String, val priceAdjustment: Double) {
    ChocolateSauce("Chocolate Sauce", 0.50),
    Caramel("Caramel", 0.50),
    Sprinkles("Sprinkles", 0.30),
    CrushedNuts("Crushed Nuts", 0.50),
    WhippedCream("Whipped Cream", 0.40)
}

data class ModifierSheetResult(
    val productName: String,
    val basePrice: Double,
    val selectedFlavors: List<String>,
    val container: ContainerType,
    val toppings: List<Topping>,
    val totalPrice: Double
)

// ────────────────────────────────────────────────────────────────
// Default sample data (used by MenuScreen)
// ────────────────────────────────────────────────────────────────

fun defaultGelatoFlavors(): List<GelatoFlavor> = listOf(
    GelatoFlavor("Pistachio", null, false),
    GelatoFlavor("Dark Chocolate", null, false),
    GelatoFlavor("Mango Sorbet", null, false),
    GelatoFlavor("Strawberry", null, false),
    GelatoFlavor("Matcha", null, false),
    GelatoFlavor("Salted Caramel", null, true),
    GelatoFlavor("Vanilla Bean", null, false),
    GelatoFlavor("Chocolate Fudge", null, false),
    GelatoFlavor("Cookies & Cream", null, false),
    GelatoFlavor("Honey Lavender", null, false),
    GelatoFlavor("Limoncello", null, false),
    GelatoFlavor("Raspberry Sorbet", null, false)
)

// ────────────────────────────────────────────────────────────────
// Modifier Bottom Sheet — main composable
// ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GelatoModifierSheet(
    productName: String,
    basePrice: Double,
    scoopCount: Int,
    flavors: List<GelatoFlavor>,
    isVisible: Boolean,
    onDismiss: () -> Unit,
    onAddToCart: (ModifierSheetResult) -> Unit
) {
    if (!isVisible) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // State
    var selectedFlavors by remember { mutableStateOf<List<String>>(emptyList()) }
    var selectedContainer by remember { mutableStateOf(ContainerType.Cup) }
    var selectedToppings by remember { mutableStateOf<List<Topping>>(emptyList()) }

    // Live price calc
    val containerAdjustment = selectedContainer.priceAdjustment
    val toppingsAdjustment = selectedToppings.sumOf { it.priceAdjustment }
    val totalPrice = basePrice + containerAdjustment + toppingsAdjustment

    // Reset state when sheet opens
    // (We rely on recomposition; the remember keys don't change on open/close)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = GridBackground,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        tonalElevation = 0.dp,
        dragHandle = null // We provide our own header
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 0.dp) // button pinned to bottom edge
        ) {
            // ── Scrollable content area (below header, above price bar + button) ──
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
            ) {
                // ── Header ──
                SheetHeader(
                    productName = productName,
                    onClose = onDismiss
                )

                Spacer(modifier = Modifier.height(4.dp))

                // ── Scoop hint ──
                Text(
                    text = "Select $scoopCount ${if (scoopCount == 1) "flavor" else "flavors"}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = GridTextSecondary,
                    modifier = Modifier.padding(bottom = 12.dp)
                )

                // ── Section A: Flavor Picker ──
                SectionLabel("Flavors")
                Spacer(modifier = Modifier.height(8.dp))
                FlavorGrid(
                    flavors = flavors,
                    scoopCount = scoopCount,
                    selectedFlavors = selectedFlavors,
                    onFlavorToggle = { flavor ->
                        selectedFlavors = if (flavor in selectedFlavors) {
                            selectedFlavors - flavor
                        } else if (selectedFlavors.size < scoopCount) {
                            selectedFlavors + flavor
                        } else {
                            // Replace the last selection (rotate)
                            selectedFlavors.drop(1) + flavor
                        }
                    }
                )

                Spacer(modifier = Modifier.height(24.dp))

                // ── Section B: Container ──
                SectionLabel("Container")
                Spacer(modifier = Modifier.height(8.dp))
                ContainerSelector(
                    selectedContainer = selectedContainer,
                    onContainerSelected = { selectedContainer = it }
                )

                Spacer(modifier = Modifier.height(24.dp))

                // ── Section C: Toppings ──
                SectionLabel("Toppings (max 3)")
                Spacer(modifier = Modifier.height(8.dp))
                ToppingSelector(
                    selectedToppings = selectedToppings,
                    onToppingToggle = { topping ->
                        selectedToppings = if (topping in selectedToppings) {
                            selectedToppings - topping
                        } else if (selectedToppings.size < 3) {
                            selectedToppings + topping
                        } else {
                            // Already at max — don't add
                            selectedToppings
                        }
                    }
                )

                Spacer(modifier = Modifier.height(20.dp))
            }

            // ── Pinned bottom: price bar + Add to Cart button ──
            BottomBar(
                basePrice = basePrice,
                containerAdjustment = containerAdjustment,
                toppingsAdjustment = toppingsAdjustment,
                totalPrice = totalPrice,
                canAddToCart = selectedFlavors.isNotEmpty(),
                onAddToCart = {
                    onAddToCart(
                        ModifierSheetResult(
                            productName = productName,
                            basePrice = basePrice,
                            selectedFlavors = selectedFlavors,
                            container = selectedContainer,
                            toppings = selectedToppings,
                            totalPrice = totalPrice
                        )
                    )
                    onDismiss()
                }
            )
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Individual section composables
// ────────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        color = GridTextPrimary
    )
}

@Composable
private fun SheetHeader(
    productName: String,
    onClose: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "Customize $productName",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            color = GridTextPrimary
        )
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(GridSurface)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose
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
}

// ── Flavor Grid ────────────────────────────────────────────────

@Composable
private fun FlavorGrid(
    flavors: List<GelatoFlavor>,
    scoopCount: Int,
    selectedFlavors: List<String>,
    onFlavorToggle: (String) -> Unit
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = Modifier
            .fillMaxWidth()
            .height(280.dp), // fixed height for ~2 rows in the scrollable column
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        userScrollEnabled = false // nested scrolling prevention
    ) {
        items(flavors) { flavor ->
            FlavorButton(
                flavor = flavor,
                isSelected = flavor.name in selectedFlavors,
                selectionOrder = selectedFlavors.indexOf(flavor.name).let {
                    if (it >= 0) it + 1 else null
                },
                onClick = {
                    if (!flavor.isSoldOut) {
                        onFlavorToggle(flavor.name)
                    }
                }
            )
        }
    }
}

@Composable
private fun FlavorButton(
    flavor: GelatoFlavor,
    isSelected: Boolean,
    selectionOrder: Int?,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.95f else 1f,
        label = "flavorScale"
    )

    val borderColor by animateColorAsState(
        targetValue = when {
            flavor.isSoldOut -> GridError.copy(alpha = 0.3f)
            isSelected -> GridPrimary
            else -> GridBorderMedium
        },
        label = "borderColor",
        animationSpec = spring(dampingRatio = 0.7f)
    )

    val bgColor by animateColorAsState(
        targetValue = when {
            flavor.isSoldOut -> GridDisabledBg.copy(alpha = 0.5f)
            isSelected -> GridPrimaryLight.copy(alpha = 0.35f)
            else -> GridSurface
        },
        label = "bgColor",
        animationSpec = spring(dampingRatio = 0.7f)
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(14.dp))
            .background(bgColor)
            .border(
                width = if (isSelected) 2.dp else 1.dp,
                color = borderColor,
                shape = RoundedCornerShape(14.dp)
            )
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            )
    ) {
        Box {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(top = 12.dp, bottom = 10.dp)
            ) {
                // Flavor image thumbnail or placeholder
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(28.dp))
                        .background(
                            if (flavor.isSoldOut) GridDisabledBg
                            else if (isSelected) GridPrimary.copy(alpha = 0.15f)
                            else GridBorder
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (flavor.imageUrl != null) {
                        AsyncImage(
                            model = flavor.imageUrl,
                            contentDescription = flavor.name,
                            modifier = Modifier
                                .size(56.dp)
                                .clip(RoundedCornerShape(28.dp)),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Text(
                            text = flavor.name.take(1),
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            color = if (flavor.isSoldOut) GridDisabledText
                            else if (isSelected) GridPrimary
                            else GridTextSecondary.copy(alpha = 0.4f)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                // Flavor name
                Text(
                    text = flavor.name,
                    fontFamily = InterFontFamily,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 12.sp,
                    color = if (flavor.isSoldOut) GridDisabledText
                    else if (isSelected) GridPrimaryDark
                    else GridTextPrimary,
                    maxLines = 2,
                    textAlign = TextAlign.Center,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 15.sp,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }

            // Selection badge (numbered)
            if (isSelected && selectionOrder != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(GridPrimary),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "$selectionOrder",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        color = GridBackground
                    )
                }
            }

            // Sold-out red overlay
            if (flavor.isSoldOut) {
                Box(
                    modifier = Modifier
                        .matchParentSize()
                        .background(GridBackground.copy(alpha = 0.35f))
                        .clip(RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "SOLD OUT",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 9.sp,
                        color = GridError,
                        modifier = Modifier
                            .background(
                                GridBackground.copy(alpha = 0.9f),
                                RoundedCornerShape(4.dp)
                            )
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }
    }
}

// ── Container Selector (radio) ─────────────────────────────────

@Composable
private fun ContainerSelector(
    selectedContainer: ContainerType,
    onContainerSelected: (ContainerType) -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        ContainerType.entries.forEach { container ->
            val isSelected = container == selectedContainer
            val bgColor by animateColorAsState(
                targetValue = if (isSelected) GridPrimaryLight.copy(alpha = 0.3f)
                else GridSurface,
                label = "containerBg"
            )
            val borderColor by animateColorAsState(
                targetValue = if (isSelected) GridPrimary else GridBorderMedium,
                label = "containerBorder"
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(bgColor)
                    .border(
                        width = if (isSelected) 1.5.dp else 1.dp,
                        color = borderColor,
                        shape = RoundedCornerShape(12.dp)
                    )
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = { onContainerSelected(container) }
                    )
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    RadioButton(
                        selected = isSelected,
                        onClick = { onContainerSelected(container) },
                        colors = RadioButtonDefaults.colors(
                            selectedColor = GridPrimary,
                            unselectedColor = GridBorderMedium
                        )
                    )
                    Text(
                        text = container.displayName,
                        fontFamily = InterFontFamily,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 15.sp,
                        color = GridTextPrimary
                    )
                }

                Text(
                    text = if (container.priceAdjustment > 0) {
                        "+S$${String.format("%.2f", container.priceAdjustment)}"
                    } else {
                        "Free"
                    },
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = if (container.priceAdjustment > 0) GridPrimary else GridTextSecondary
                )
            }
        }
    }
}

// ── Topping Selector (multi-select chips) ─────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ToppingSelector(
    selectedToppings: List<Topping>,
    onToppingToggle: (Topping) -> Unit
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Topping.entries.forEach { topping ->
            val isSelected = topping in selectedToppings
            val interactionSource = remember { MutableInteractionSource() }
            val isPressed by interactionSource.collectIsPressedAsState()
            val scale by animateFloatAsState(
                targetValue = if (isPressed) 0.95f else 1f,
                label = "toppingScale"
            )

            val containerColor by animateColorAsState(
                targetValue = if (isSelected) GridPrimary else GridSurface,
                label = "toppingBg"
            )
            val borderColor by animateColorAsState(
                targetValue = if (isSelected) GridPrimary else GridBorderMedium,
                label = "toppingBorder"
            )
            val contentColor by animateColorAsState(
                targetValue = if (isSelected) GridBackground else GridTextPrimary,
                label = "toppingContent"
            )

            Row(
                modifier = Modifier
                    .scale(scale)
                    .clip(RoundedCornerShape(20.dp))
                    .background(containerColor)
                    .border(
                        width = 1.dp,
                        color = borderColor,
                        shape = RoundedCornerShape(20.dp)
                    )
                    .clickable(
                        interactionSource = interactionSource,
                        indication = null,
                        onClick = { onToppingToggle(topping) }
                    )
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = null,
                        tint = GridBackground,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    text = topping.displayName,
                    fontFamily = InterFontFamily,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 14.sp,
                    color = contentColor
                )
                if (topping.priceAdjustment > 0) {
                    Text(
                        text = "+S$${String.format("%.2f", topping.priceAdjustment)}",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = if (isSelected) GridBackground.copy(alpha = 0.8f)
                        else GridPrimary
                    )
                }
            }
        }
    }
}

// ── Bottom Bar: Price + Add to Cart ───────────────────────────

@Composable
private fun BottomBar(
    basePrice: Double,
    containerAdjustment: Double,
    toppingsAdjustment: Double,
    totalPrice: Double,
    canAddToCart: Boolean,
    onAddToCart: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(GridSurface)
            .border(
                width = 1.dp,
                color = GridBorder,
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
            )
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        // Price breakdown
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                PriceLine(label = "Base", amount = basePrice)
                if (containerAdjustment > 0) {
                    PriceLine(label = "Container", amount = containerAdjustment)
                }
                if (toppingsAdjustment > 0) {
                    PriceLine(label = "Toppings", amount = toppingsAdjustment)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "S$${String.format("%.2f", totalPrice)}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    color = GridPrimary
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))
        HorizontalDivider(color = GridBorder, thickness = 1.dp)
        Spacer(modifier = Modifier.height(12.dp))

        // Add to Cart button
        val interactionSource = remember { MutableInteractionSource() }
        val isPressed by interactionSource.collectIsPressedAsState()
        val scale by animateFloatAsState(
            targetValue = if (isPressed) 0.97f else 1f,
            label = "addToCartScale"
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .scale(scale)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (canAddToCart) GridPrimary else GridDisabledBg
                )
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = canAddToCart,
                    onClick = onAddToCart
                ),
            contentAlignment = Alignment.Center
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = if (canAddToCart) "Add to Cart — S$${String.format("%.2f", totalPrice)}"
                    else "Select a flavor first",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = if (canAddToCart) GridBackground else GridDisabledText
                )
            }
        }
    }
}

@Composable
private fun PriceLine(
    label: String,
    amount: Double
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 13.sp,
            color = GridTextSecondary
        )
        Text(
            text = "+S$${String.format("%.2f", amount)}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = GridTextSecondary
        )
    }
}