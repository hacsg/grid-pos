package sg.hundredacre.grid.ui.screens.login

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridError
import sg.hundredacre.grid.ui.theme.GridPrimary
import sg.hundredacre.grid.ui.theme.GridPrimaryLight
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.InterFontFamily

private const val PIN_LENGTH = 4
private const val SHAKE_DURATION_MS = 80
private const val SHAKE_AMPLITUDE = 12f
private const val AUTO_SUBMIT_DELAY_MS = 150L
private const val SUCCESS_DISPLAY_MS = 2000L

// Simulated staff data — replace with actual API call
private data class StaffMember(
    val name: String,
    val role: String
)

private val mockStaff = StaffMember(name = "Alex Chen", role = "Shift Lead")

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit
) {
    var pin by remember { mutableStateOf("") }
    var errorState by remember { mutableStateOf(false) }
    var loggedInStaff by remember { mutableStateOf<StaffMember?>(null) }
    val shakeOffset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()

    // Auto-submit when 4 digits are entered
    LaunchedEffect(pin) {
        if (pin.length == PIN_LENGTH) {
            delay(AUTO_SUBMIT_DELAY_MS)
            // TODO: authenticate via API — mock validation for demo
            if (pin == "1234") {
                loggedInStaff = mockStaff
                delay(SUCCESS_DISPLAY_MS)
                onLoginSuccess()
            } else {
                errorState = true
                // Shake animation
                launchShake(shakeOffset)
                // Clear after shake
                delay(SHAKE_DURATION_MS * 5L)
                pin = ""
                errorState = false
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(GridBackground),
        contentAlignment = Alignment.Center
    ) {
        if (loggedInStaff != null) {
            // === WELCOME STATE ===
            WelcomeContent(staff = loggedInStaff!!)
        } else {
            // === LOGIN STATE ===
            LoginContent(
                pin = pin,
                errorState = errorState,
                shakeOffset = shakeOffset.value,
                onDigitPressed = { digit ->
                    if (pin.length < PIN_LENGTH) {
                        pin += digit
                        errorState = false
                    }
                },
                onBackspace = {
                    if (pin.isNotEmpty()) {
                        pin = pin.dropLast(1)
                        errorState = false
                    }
                }
            )
        }
    }
}

// ──────────────────────────────────────────────
// SHAKE LAUNCHER
// ──────────────────────────────────────────────

private suspend fun launchShake(animatable: Animatable<Float>) {
    animatable.snapTo(0f)
    // Rapid oscillation decaying
    for (i in 1..4) {
        val direction = if (i % 2 == 1) 1f else -1f
        val amplitude = SHAKE_AMPLITUDE / i
        animatable.animateTo(
            targetValue = direction * amplitude,
            animationSpec = tween(durationMillis = SHAKE_DURATION_MS)
        )
    }
    animatable.animateTo(
        targetValue = 0f,
        animationSpec = tween(durationMillis = SHAKE_DURATION_MS)
    )
}

// ──────────────────────────────────────────────
// WELCOME CONTENT
// ──────────────────────────────────────────────

@Composable
private fun WelcomeContent(staff: StaffMember) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Avatar circle
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(CircleShape)
                .background(GridPrimaryLight),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Person,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = GridPrimary
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Welcome,",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 18.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = staff.name,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 28.sp,
            color = GridTextPrimary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = staff.role,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )
    }
}

// ──────────────────────────────────────────────
// LOGIN CONTENT
// ──────────────────────────────────────────────

@Composable
private fun LoginContent(
    pin: String,
    errorState: Boolean,
    shakeOffset: Float,
    onDigitPressed: (String) -> Unit,
    onBackspace: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // ── Brand Header ──
        Spacer(modifier = Modifier.height(40.dp))

        // Logo mark — decorative teal circle
        Box(
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(GridPrimary),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "G",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 28.sp,
                color = Color.White
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        Text(
            text = "Grid POS",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 22.sp,
            color = GridTextPrimary
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = "Hundred Acre Creamery",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            color = GridTextSecondary
        )

        Spacer(modifier = Modifier.height(48.dp))

        // ── PIN Dots ──
        PinDotsRow(
            pinLength = pin.length,
            errorState = errorState,
            shakeOffset = shakeOffset
        )

        Spacer(modifier = Modifier.height(6.dp))

        // Hint text
        Text(
            text = if (errorState) "Invalid PIN — try again" else "Enter your staff PIN",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 12.sp,
            color = if (errorState) GridError else GridTextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(36.dp))

        // ── Number Pad ──
        NumberPad(
            onDigitPressed = onDigitPressed,
            onBackspace = onBackspace
        )

        Spacer(modifier = Modifier.height(24.dp))
    }
}

// ──────────────────────────────────────────────
// PIN DOTS
// ──────────────────────────────────────────────

@Composable
private fun PinDotsRow(
    pinLength: Int,
    errorState: Boolean,
    shakeOffset: Float
) {
    val dotColor = when {
        errorState -> GridError
        else -> GridPrimary
    }

    val emptyDotColor = when {
        errorState -> GridError.copy(alpha = 0.3f)
        else -> GridPrimary.copy(alpha = 0.25f)
    }

    val dotSize = 16.dp
    val dotSpacing = 20.dp

    Row(
        horizontalArrangement = Arrangement.spacedBy(dotSpacing),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .offset(x = shakeOffset.dp)
            .padding(vertical = 8.dp)
    ) {
        for (i in 0 until PIN_LENGTH) {
            val isFilled = i < pinLength
            Canvas(modifier = Modifier.size(dotSize)) {
                val radius = size.width / 2
                if (isFilled) {
                    drawCircle(
                        color = dotColor,
                        radius = radius
                    )
                } else {
                    drawCircle(
                        color = emptyDotColor,
                        radius = radius,
                        style = Stroke(width = 2.5f)
                    )
                }
            }
        }
    }
}

// ──────────────────────────────────────────────
// NUMBER PAD
// ──────────────────────────────────────────────

@Composable
private fun NumberPad(
    onDigitPressed: (String) -> Unit,
    onBackspace: () -> Unit
) {
    val buttonSize = 72.dp
    val spacing = 12.dp

    Column(
        verticalArrangement = Arrangement.spacedBy(spacing),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Row 1: 1, 2, 3
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
            NumberPadButton(text = "1", size = buttonSize, onClick = { onDigitPressed("1") })
            NumberPadButton(text = "2", size = buttonSize, onClick = { onDigitPressed("2") })
            NumberPadButton(text = "3", size = buttonSize, onClick = { onDigitPressed("3") })
        }
        // Row 2: 4, 5, 6
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
            NumberPadButton(text = "4", size = buttonSize, onClick = { onDigitPressed("4") })
            NumberPadButton(text = "5", size = buttonSize, onClick = { onDigitPressed("5") })
            NumberPadButton(text = "6", size = buttonSize, onClick = { onDigitPressed("6") })
        }
        // Row 3: 7, 8, 9
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
            NumberPadButton(text = "7", size = buttonSize, onClick = { onDigitPressed("7") })
            NumberPadButton(text = "8", size = buttonSize, onClick = { onDigitPressed("8") })
            NumberPadButton(text = "9", size = buttonSize, onClick = { onDigitPressed("9") })
        }
        // Row 4: empty, 0, backspace
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
            // Empty spacer to maintain grid alignment
            Box(modifier = Modifier.size(buttonSize))
            NumberPadButton(text = "0", size = buttonSize, onClick = { onDigitPressed("0") })
            NumberPadBackspaceButton(size = buttonSize, onClick = onBackspace)
        }
    }
}

// ──────────────────────────────────────────────
// NUMBER PAD BUTTON
// ──────────────────────────────────────────────

@Composable
private fun NumberPadButton(
    text: String,
    size: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (isPressed) 0.90f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "padButtonScale"
    )

    Box(
        modifier = Modifier
            .size(size)
            .scale(scale)
            .shadow(
                elevation = if (isPressed) 1.dp else 2.dp,
                shape = RoundedCornerShape(16.dp),
                ambientColor = Color.Black.copy(alpha = 0.08f),
                spotColor = Color.Black.copy(alpha = 0.12f)
            )
            .clip(RoundedCornerShape(16.dp))
            .background(GridBackground)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 24.sp,
            color = GridTextPrimary,
            textAlign = TextAlign.Center
        )
    }
}

// ──────────────────────────────────────────────
// BACKSPACE BUTTON
// ──────────────────────────────────────────────

@Composable
private fun NumberPadBackspaceButton(
    size: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (isPressed) 0.90f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "backspaceScale"
    )

    Box(
        modifier = Modifier
            .size(size)
            .scale(scale)
            .shadow(
                elevation = if (isPressed) 1.dp else 2.dp,
                shape = RoundedCornerShape(16.dp),
                ambientColor = Color.Black.copy(alpha = 0.08f),
                spotColor = Color.Black.copy(alpha = 0.12f)
            )
            .clip(RoundedCornerShape(16.dp))
            .background(GridBackground)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            ),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "⌫",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 22.sp,
            color = GridTextSecondary,
            textAlign = TextAlign.Center
        )
    }
}