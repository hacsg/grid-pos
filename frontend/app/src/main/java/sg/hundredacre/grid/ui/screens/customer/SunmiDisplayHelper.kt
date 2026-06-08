package sg.hundredacre.grid.ui.screens.customer

import android.app.Presentation
import android.content.Context
import android.graphics.Color
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.view.Display
import android.view.WindowManager
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import sg.hundredacre.grid.ui.theme.GridTheme

/**
 * Helper for detecting and managing the Sunmi T series secondary
 * (customer-facing) display.
 *
 * Uses Android's [Presentation] API, which creates a dedicated dialog
 * window on the target [Display]. On Sunmi T series devices the secondary
 * display is typically an HDMI or MIPI screen registered as a separate
 * display by the hardware abstraction layer.
 *
 * Usage:
 * ```kotlin
 * val helper = remember { SunmiDisplayHelper(context) }
 *
 * LaunchedEffect(displayState) {
 *     if (helper.isSecondaryDisplayAvailable) {
 *         helper.show(displayState)
 *     }
 * }
 *
 * DisposableEffect(Unit) {
 *     onDispose { helper.dismiss() }
 * }
 * ```
 */
class SunmiDisplayHelper(private val context: Context) {

    /** Whether a secondary display is currently connected and usable. */
    val isSecondaryDisplayAvailable: Boolean
        get() = secondaryDisplay != null

    /** The secondary display, if any. */
    val secondaryDisplay: Display?
        get() = findSecondaryDisplay()

    /** The currently active Presentation, or null if none is showing. */
    var currentPresentation: CustomerPresentation? by mutableStateOf(null)
        private set

    /**
     * Show the customer display composable on the secondary screen.
     *
     * @param state The [CustomerDisplayState] to project.
     * @return true if the presentation was shown, false if no secondary
     *         display is available.
     */
    fun show(state: CustomerDisplayState): Boolean {
        val display = secondaryDisplay ?: return false

        // Re-use existing presentation if it's still valid (screen not changed)
        if (currentPresentation?.display?.displayId == display.displayId) {
            currentPresentation?.updateState(state)
            return true
        }

        // Dismiss old presentation on a different display
        dismiss()

        val presentation = CustomerPresentation(context, display).apply {
            updateState(state)
            show()
        }
        currentPresentation = presentation
        return true
    }

    /**
     * Dismiss the customer display presentation and release its window.
     */
    fun dismiss() {
        currentPresentation?.dismiss()
        currentPresentation = null
    }

    // ── Internal helpers ────────────────────────────────────────────

    /**
     * Scan all registered displays and pick one that is *not* the default
     * display. On Sunmi T series the secondary screen is registered as a
     * non-default display by the vendor HAL.
     */
    private fun findSecondaryDisplay(): Display? {
        val displayManager =
            context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
                ?: return null

        val displays = displayManager.displays
        if (displays.size < 2) return null

        // Pick the first display whose ID differs from the default
        val defaultDisplayId = displayManager.getDisplay(Display.DEFAULT_DISPLAY)?.displayId
        return displays.firstOrNull { it.displayId != defaultDisplayId }
    }

    // ── Presentation subclass ────────────────────────────────────────

    /**
     * A [Presentation] that renders the [CustomerDisplayScreen] composable
     * using Jetpack Compose.
     *
     * The presentation window is configured as:
     * - FLAG_NOT_FOCUSABLE (no user input / buttons)
     * - FLAG_NOT_TOUCHABLE  (read-only display)
     * - FLAG_KEEP_SCREEN_ON (always on while order is live)
     * - Full screen / no system UI chrome
     */
    class CustomerPresentation(
        context: Context,
        display: Display,
    ) : Presentation(context, display) {

        private var currentState: CustomerDisplayState by mutableStateOf(
            CustomerDisplayState.Idle
        )

        override fun onCreate(savedInstanceState: Bundle?) {
            super.onCreate(savedInstanceState)

            // Configure window: no touch, no chrome, keep screen on
            window?.apply {
                setType(WindowManager.LayoutParams.TYPE_APPLICATION_PANEL)
                addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE)
                addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
                addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
                decorView.setBackgroundColor(Color.WHITE)
            }

            setContentView(
                ComposeView(this).apply {
                    setContent {
                        CustomerDisplayPresentationContent()
                    }
                }
            )
        }

        /**
         * Update the state projected on the secondary display.
         * Called from [SunmiDisplayHelper.show] on the main thread.
         */
        fun updateState(state: CustomerDisplayState) {
            currentState = state
        }

        @Composable
        private fun CustomerDisplayPresentationContent() {
            GridTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = androidx.compose.ui.graphics.Color.White,
                ) {
                    CustomerDisplayScreen(state = currentState)
                }
            }
        }
    }

    companion object {
        private const val TAG = "SunmiDisplayHelper"
    }
}