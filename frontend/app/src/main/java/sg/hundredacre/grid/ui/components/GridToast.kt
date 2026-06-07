package sg.hundredacre.grid.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import sg.hundredacre.grid.ui.theme.GridCornerShapes
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.InterFontFamily

private val ToastBgColor = Color(0xFF1A1A1A)
private val ToastDurationMs = 3000L

@Composable
fun GridToastHost(
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier
) {
    SnackbarHost(
        hostState = snackbarHostState,
        modifier = modifier,
        snackbar = { data ->
            GridToast(data = data)
        }
    )
}

@Composable
private fun GridToast(data: SnackbarData) {
    Snackbar(
        snackbarData = data,
        containerColor = Color.Transparent,
        contentColor = Color.Transparent,
        shape = RoundedCornerShape(0.dp),
        modifier = Modifier.padding(horizontal = 16.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(ToastBgColor, GridCornerShapes.toast),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = data.visuals.message,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                color = Color.White,
                maxLines = 1
            )
        }
    }
}

/**
 * Shows a Grid-style toast via the provided SnackbarHostState.
 * Automatically dismisses after 3 seconds.
 */
suspend fun SnackbarHostState.showGridToast(message: String) {
    showSnackbar(
        message = message,
        duration = SnackbarDuration.Short
    )
}

/**
 * Composable that automatically shows a toast message for 3 seconds.
 */
@Composable
fun GridToastMessage(
    message: String,
    snackbarHostState: SnackbarHostState,
    onDismiss: () -> Unit
) {
    LaunchedEffect(message) {
        snackbarHostState.showSnackbar(
            message = message,
            duration = SnackbarDuration.Short
        )
        delay(ToastDurationMs)
        onDismiss()
    }
}