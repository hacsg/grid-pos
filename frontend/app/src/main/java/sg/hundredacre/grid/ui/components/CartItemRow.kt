package sg.hundredacre.grid.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.ui.theme.GridBorderMedium
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily

@Composable
fun CartItemRow(
    itemName: String,
    modifierDescription: String?,
    unitPrice: Double,
    quantity: Int,
    onDecrement: () -> Unit,
    onIncrement: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(76.dp)
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Left: item name + modifiers
        Column(
            modifier = Modifier.weight(1f)
        ) {
            Text(
                text = itemName,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = GridTextPrimary
            )
            if (modifierDescription != null) {
                Text(
                    text = modifierDescription,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Normal,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = GridTextSecondary
                )
            }
        }

        // Right: price + quantity controls
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End
        ) {
            // Price — S$ for Singapore
            Text(
                text = "S$${String.format("%.2f", unitPrice * quantity)}",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = GridPrimary,
                modifier = Modifier.padding(end = 12.dp)
            )

            // Quantity controls
            QuantityControl(
                quantity = quantity,
                onDecrement = onDecrement,
                onIncrement = onIncrement
            )
        }
    }
}

@Composable
private fun QuantityControl(
    quantity: Int,
    onDecrement: () -> Unit,
    onIncrement: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(0.dp)
    ) {
        // Minus button: 32dp circle, border #DEE2E6
        IconButton(
            onClick = onDecrement,
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.iconButtonColors(
                contentColor = GridTextPrimary
            )
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .border(1.dp, GridBorderMedium, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "−",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = GridTextPrimary
                )
            }
        }

        // Quantity text
        Text(
            text = quantity.toString(),
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            color = GridTextPrimary,
            modifier = Modifier.padding(horizontal = 12.dp)
        )

        // Plus button: 32dp circle, border #DEE2E6
        IconButton(
            onClick = onIncrement,
            modifier = Modifier.size(32.dp),
            colors = IconButtonDefaults.iconButtonColors(
                contentColor = GridTextPrimary
            )
        ) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .border(1.dp, GridBorderMedium, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "+",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = GridTextPrimary
                )
            }
        }
    }
}