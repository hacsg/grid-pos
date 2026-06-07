package sg.hundredacre.grid.ui.screens.cart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.ui.components.CartItemRow
import sg.hundredacre.grid.ui.components.GridPrimaryButton
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridBorder
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CartScreen(
    onNavigateToPayment: () -> Unit,
    onNavigateBack: () -> Unit
) {
    // Sample cart state
    val cartItems = remember {
        mutableStateOf(
            listOf(
                CartItem("Pistachio Gelato", "Small cup", 5.50, 2),
                CartItem("Dark Chocolate", "Large cone", 6.50, 1),
                CartItem("Mango Sorbet", "Small cup", 5.00, 3)
            )
        )
    }

    val subtotal = cartItems.value.sumOf { it.price * it.quantity }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Cart",
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
        bottomBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(GridBackground)
                    .padding(16.dp)
            ) {
                Divider(color = GridBorder)
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "Subtotal",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = 14.sp,
                        color = GridTextSecondary
                    )
                    Text(
                        "$${String.format("%.2f", subtotal)}",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        color = GridPrimary
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                GridPrimaryButton(
                    text = "Proceed to Payment",
                    onClick = onNavigateToPayment
                )
            }
        },
        containerColor = GridBackground
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
        ) {
            items(cartItems.value) { item ->
                CartItemRow(
                    itemName = item.name,
                    modifierDescription = item.modifier,
                    unitPrice = item.price,
                    quantity = item.quantity,
                    onDecrement = {
                        cartItems.value = cartItems.value.map {
                            if (it.name == item.name && it.modifier == item.modifier) {
                                it.copy(quantity = maxOf(0, it.quantity - 1))
                            } else it
                        }.filter { it.quantity > 0 }
                    },
                    onIncrement = {
                        cartItems.value = cartItems.value.map {
                            if (it.name == item.name && it.modifier == item.modifier) {
                                it.copy(quantity = it.quantity + 1)
                            } else it
                        }
                    }
                )
                Divider(color = GridBorder)
            }
        }
    }
}

private data class CartItem(
    val name: String,
    val modifier: String?,
    val price: Double,
    val quantity: Int
)