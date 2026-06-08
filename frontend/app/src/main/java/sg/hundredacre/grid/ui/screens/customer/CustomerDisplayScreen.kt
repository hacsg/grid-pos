package sg.hundredacre.grid.ui.screens.customer

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily
import kotlinx.coroutines.delay

// ─── Public state types ──────────────────────────────────────────────────

/**
 * Immutable state projected onto the customer-facing secondary display.
 */
sealed class CustomerDisplayState {
    /** No active order — branded idle/splash screen. */
    object Idle : CustomerDisplayState()

    /** A live order is being composed or charged. */
    data class Ordering(
        val items: List<DisplayCartItem>,
        val subtotalCents: Long,
        val taxCents: Long = 0L,
    ) : CustomerDisplayState()

    /** Payment completed successfully — short-lived confirmation. */
    data class PaymentSuccess(
        val totalCents: Long,
        val message: String = "Thank You!",
    ) : CustomerDisplayState()
}

/**
 * A single line item for the customer display — kept minimal and read-only.
 */
data class DisplayCartItem(
    val name: String,
    val quantity: Int,
    val unitPriceCents: Long,
    val modifiers: List<String> = emptyList(),
    val lineTotalCents: Long = unitPriceCents * quantity,
)

// ─── Public composable — the full customer-facing display ────────────────

/**
 * Full-screen customer-facing composable intended for projection onto a
 * Sunmi T series secondary display.
 *
 * Three states: [CustomerDisplayState.Idle] (branded splash),
 * [CustomerDisplayState.Ordering] (live cart mirror),
 * [CustomerDisplayState.PaymentSuccess] (confirmation animation).
 *
 * @param state The current display state — feed this from a shared ViewModel
 *              or state holder (e.g. [CustomerDisplayStateHolder]).
 * @param modifier Optional modifier for the root container.
 */
@Composable
fun CustomerDisplayScreen(
    state: CustomerDisplayState,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(GridBackground),
        contentAlignment = Alignment.Center,
    ) {
        when (state) {
            is CustomerDisplayState.Idle -> IdleContent()
            is CustomerDisplayState.Ordering -> OrderingContent(state)
            is CustomerDisplayState.PaymentSuccess -> PaymentSuccessContent(state)
        }
    }
}

// ─── State 1: Branded Idle / Splash (Apple-Store premium feel) ───────────

@Composable
private fun IdleContent() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // Decorative top accent line
        Box(
            modifier = Modifier
                .width(60.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(GridPrimary),
        )

        Spacer(modifier = Modifier.height(48.dp))

        // Brand mark — stylised initials as a logo stand-in
        Box(
            modifier = Modifier
                .size(120.dp)
                .clip(CircleShape)
                .background(GridPrimary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "HAC",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 28.sp,
                color = Color.White,
                letterSpacing = 4.sp,
            )
        }

        Spacer(modifier = Modifier.height(36.dp))

        // Full brand name — large, elegant
        Text(
            text = "Hundred Acre",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 42.sp,
            color = GridTextPrimary,
            letterSpacing = (-0.5).sp,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "Creamery",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Light,
            fontSize = 42.sp,
            color = GridPrimary,
            letterSpacing = 2.sp,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Tagline
        Text(
            text = "Artisan Gelato • Singapore",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 18.sp,
            color = GridTextSecondary,
            letterSpacing = 3.sp,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(48.dp))

        // Decorative bottom accent line
        Box(
            modifier = Modifier
                .width(60.dp)
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(GridPrimaryLight),
        )

        Spacer(modifier = Modifier.weight(1f))

        // Social handle — bottom of screen
        Text(
            text = "@hundredacrecreamery",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = GridTextSecondary,
            letterSpacing = 2.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 48.dp),
        )
    }
}

// ─── State 2: Live Order Cart Mirror ────────────────────────────────────

@Composable
private fun OrderingContent(state: CustomerDisplayState.Ordering) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp, vertical = 28.dp),
    ) {
        // Header
        Text(
            text = "YOUR ORDER",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            color = GridPrimary,
            letterSpacing = 4.sp,
        )

        Spacer(modifier = Modifier.height(4.dp))

        HorizontalDivider(
            color = GridPrimaryLight,
            thickness = 2.dp,
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Item list — scrollable
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(state.items, key = { it.name + it.modifiers.hashCode() }) { item ->
                CartLineItemRow(item)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Footer divider + totals
        HorizontalDivider(
            color = GridPrimaryLight,
            thickness = 2.dp,
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Subtotal
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Subtotal",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 18.sp,
                color = GridTextSecondary,
            )
            Text(
                text = formatSgd(state.subtotalCents),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                color = GridTextPrimary,
            )
        }

        // Tax (if any)
        if (state.taxCents > 0L) {
            Spacer(modifier = Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "GST",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 18.sp,
                    color = GridTextSecondary,
                )
                Text(
                    text = formatSgd(state.taxCents),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    color = GridTextPrimary,
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Total
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Total",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = GridPrimary,
            )
            Text(
                text = formatSgd(state.subtotalCents + state.taxCents),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 32.sp,
                color = GridPrimary,
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Payment hint — large, friendly
        Text(
            text = "Please tap your card or phone to pay",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 16.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun CartLineItemRow(item: DisplayCartItem) {
    Column(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            // Left: quantity badge + item name
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f),
            ) {
                // Quantity badge
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(GridPrimary),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = item.quantity.toString(),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = Color.White,
                    )
                }

                Spacer(modifier = Modifier.width(14.dp))

                // Item name
                Text(
                    text = item.name,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                    color = GridTextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            // Right: line total
            Text(
                text = formatSgd(item.lineTotalCents),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = GridPrimary,
            )
        }

        // Modifiers indented below
        if (item.modifiers.isNotEmpty()) {
            item.modifiers.forEach { modifierText ->
                Text(
                    text = "+ $modifierText",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 16.sp,
                    color = GridTextSecondary,
                    modifier = Modifier.padding(start = 50.dp, top = 2.dp),
                )
            }
        }
    }
}

// ─── State 3: Payment Success Confirmation ──────────────────────────────

@Composable
private fun PaymentSuccessContent(state: CustomerDisplayState.PaymentSuccess) {
    // Animated checkmark draw progress
    val checkmarkProgress = remember { Animatable(0f) }

    LaunchedEffect(Unit) {
        // Brief pause then draw the checkmark
        delay(100)
        checkmarkProgress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = 600, easing = LinearEasing),
        )
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // Green circle + animated checkmark
        Box(
            modifier = Modifier.size(140.dp),
            contentAlignment = Alignment.Center,
        ) {
            // Background circle
            Canvas(modifier = Modifier.size(140.dp)) {
                drawCircle(
                    color = GridSuccess,
                    radius = size.minDimension / 2f,
                )
            }

            // Foreground checkmark — drawn programmatically
            Canvas(modifier = Modifier.size(80.dp)) {
                val strokeWidth = 8f
                // Checkmark path coordinates
                val start = Offset(size.width * 0.25f, size.height * 0.5f)
                val mid = Offset(size.width * 0.45f, size.height * 0.72f)
                val end = Offset(size.width * 0.78f, size.height * 0.30f)

                // First segment (bottom-left → bottom-right)
                drawLine(
                    color = Color.White,
                    start = start,
                    end = Offset(
                        x = start.x + (mid.x - start.x) * checkmarkProgress.value.coerceAtMost(0.5f) * 2f,
                        y = start.y + (mid.y - start.y) * checkmarkProgress.value.coerceAtMost(0.5f) * 2f,
                    ),
                    strokeWidth = strokeWidth,
                    cap = StrokeCap.Round,
                )

                // Second segment (mid → end), starts after first is ~done
                val secondProgress = ((checkmarkProgress.value - 0.5f) * 2f).coerceIn(0f, 1f)
                drawLine(
                    color = Color.White,
                    start = mid,
                    end = Offset(
                        x = mid.x + (end.x - mid.x) * secondProgress,
                        y = mid.y + (end.y - mid.y) * secondProgress,
                    ),
                    strokeWidth = strokeWidth,
                    cap = StrokeCap.Round,
                )
            }
        }

        Spacer(modifier = Modifier.height(36.dp))

        // "Thank You!" text — fades in after checkmark starts
        AnimatedVisibility(
            visible = checkmarkProgress.value > 0.3f,
            enter = fadeIn(animationSpec = tween(400)) +
                    scaleIn(initialScale = 0.8f, animationSpec = tween(400)),
            exit = fadeOut() + scaleOut(),
        ) {
            Text(
                text = state.message,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 48.sp,
                color = GridTextPrimary,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Amount paid — fades in alongside thank you
        AnimatedVisibility(
            visible = checkmarkProgress.value > 0.3f,
            enter = fadeIn(animationSpec = tween(500)),
            exit = fadeOut(),
        ) {
            Text(
                text = formatSgd(state.totalCents),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 28.sp,
                color = GridPrimary,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(modifier = Modifier.height(48.dp))

        // Subtle "thank you for your purchase" line
        AnimatedVisibility(
            visible = checkmarkProgress.value > 0.6f,
            enter = fadeIn(animationSpec = tween(700)),
            exit = fadeOut(),
        ) {
            Text(
                text = "Your order is being prepared",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                color = GridTextSecondary,
                letterSpacing = 1.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ─── Shared helpers ─────────────────────────────────────────────────────

/**
 * Format cents (SGD) to a display string like "S$12.50".
 */
internal fun formatSgd(cents: Long): String {
    val dollars = cents / 100.0
    return if (cents < 0L) {
        "-S$${String.format("%.2f", -dollars)}"
    } else {
        "S$${String.format("%.2f", dollars)}"
    }
}