package sg.hundredacre.grid

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import sg.hundredacre.grid.ui.screens.login.LoginScreen
import sg.hundredacre.grid.ui.screens.menu.MenuScreen
import sg.hundredacre.grid.ui.screens.cart.CartScreen
import sg.hundredacre.grid.ui.screens.payment.PaymentScreen

object Routes {
    const val LOGIN = "login"
    const val MENU = "menu"
    const val CART = "cart"
    const val PAYMENT = "payment"
}

@Composable
fun GridApp() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = Routes.LOGIN
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Routes.MENU) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                }
            )
        }
        composable(Routes.MENU) {
            MenuScreen(
                onNavigateToCart = {
                    navController.navigate(Routes.CART)
                }
            )
        }
        composable(Routes.CART) {
            CartScreen(
                onNavigateToPayment = {
                    navController.navigate(Routes.PAYMENT)
                },
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
        composable(Routes.PAYMENT) {
            PaymentScreen(
                onPaymentComplete = {
                    navController.navigate(Routes.MENU) {
                        popUpTo(Routes.MENU) { inclusive = true }
                    }
                },
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}