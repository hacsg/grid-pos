package sg.hundredacre.grid.ui.loyalty

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.data.api.CustomerData
import sg.hundredacre.grid.ui.components.GridPrimaryButton
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridSurface
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily

@Composable
fun OrderCompleteScreen(
    customer: CustomerData?,
    momentsEarned: Int,
    onDone: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(GridBackground)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.CheckCircle,
            contentDescription = null,
            tint = GridPrimary,
            modifier = Modifier.height(72.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        Text(
            text = "Order Complete",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 28.sp,
            color = GridTextPrimary
        )
        Spacer(modifier = Modifier.height(22.dp))

        if (customer != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(GridSurface, RoundedCornerShape(8.dp))
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = customer.name ?: "Loyalty Customer",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            color = GridTextPrimary
                        )
                        Text(
                            text = "Moments earned: +$momentsEarned",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = GridTextSecondary
                        )
                    }
                    TierBadge(tier = customer.tier ?: "member")
                }
            }
            Spacer(modifier = Modifier.height(22.dp))
        }

        GridPrimaryButton(
            text = "Done",
            onClick = onDone,
            modifier = Modifier.fillMaxWidth()
        )
    }
}
