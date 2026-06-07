package sg.hundredacre.grid.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

val GridShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp)
)

// Named shape constants for specific components
object GridCornerShapes {
    val button = RoundedCornerShape(12.dp)
    val card = RoundedCornerShape(12.dp)
    val chip = RoundedCornerShape(20.dp) // pill
    val toast = RoundedCornerShape(8.dp)
    val quantityButton = RoundedCornerShape(16.dp) // circle
}