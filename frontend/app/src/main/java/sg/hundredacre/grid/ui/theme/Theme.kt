package sg.hundredacre.grid.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val GridColorScheme = lightColorScheme(
    primary = GridPrimary,
    onPrimary = GridBackground,
    primaryContainer = GridPrimaryLight,
    onPrimaryContainer = GridPrimaryDark,
    secondary = GridPrimaryDark,
    onSecondary = GridBackground,
    background = GridBackground,
    onBackground = GridTextPrimary,
    surface = GridSurface,
    onSurface = GridTextPrimary,
    surfaceVariant = GridSurface,
    onSurfaceVariant = GridTextSecondary,
    error = GridError,
    onError = GridBackground,
    outline = GridBorder,
    outlineVariant = GridBorderMedium
)

@Composable
fun GridTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = GridColorScheme,
        typography = GridTypography,
        shapes = GridShapes,
        content = content
    )
}