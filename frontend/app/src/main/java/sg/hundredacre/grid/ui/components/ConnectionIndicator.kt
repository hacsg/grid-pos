package sg.hundredacre.grid.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import sg.hundredacre.grid.sync.SyncManager
import sg.hundredacre.grid.sync.SyncState
import sg.hundredacre.grid.ui.theme.GridBackground
import sg.hundredacre.grid.ui.theme.GridError
import sg.hundredacre.grid.ui.theme.GridSuccess
import sg.hundredacre.grid.ui.theme.GridTextPrimary
import sg.hundredacre.grid.ui.theme.GridTextSecondary
import sg.hundredacre.grid.ui.theme.GridWarning
import sg.hundredacre.grid.ui.theme.InterFontFamily

// ────────────────────────────────────────────────────────────────
// Connection status dot — placed in the top bar / toolbar area
// ────────────────────────────────────────────────────────────────

/**
 * Small colored dot indicating the current sync + connection state.
 *
 * - **Green** — online, all orders synced
 * - **Yellow** — online, X orders pending sync
 * - **Red** — offline or disconnected
 *
 * @param syncState observed from [SyncManager.syncState]
 */
@Composable
fun ConnectionDot(
    syncState: SyncState,
    modifier: Modifier = Modifier
) {
    val dotColor by animateColorAsState(
        targetValue = when (syncState) {
            is SyncState.Connected -> GridSuccess
            is SyncState.Syncing -> GridWarning
            is SyncState.OfflinePending -> GridError
            is SyncState.Disconnected -> GridError
        },
        animationSpec = tween(durationMillis = 300),
        label = "dotColor"
    )

    Box(
        modifier = modifier
            .size(12.dp)
            .clip(CircleShape)
            .background(dotColor)
    )
}

// ────────────────────────────────────────────────────────────────
// Offline / syncing banner — shown at the top of the screen
// ────────────────────────────────────────────────────────────────

/**
 * Full-width banner that slides in/out below the top bar.
 *
 * - Offline with pending orders → red banner: "Offline — X orders pending sync"
 * - Online with pending orders → yellow banner: "Syncing — X orders remaining"
 * - All synced → hidden
 *
 * @param syncState observed from [SyncManager.syncState]
 */
@Composable
fun SyncStatusBanner(
    syncState: SyncState,
    modifier: Modifier = Modifier
) {
    val isVisible = syncState is SyncState.OfflinePending ||
        syncState is SyncState.Syncing

    val bannerColor = when (syncState) {
        is SyncState.OfflinePending -> GridError
        is SyncState.Syncing -> GridWarning
        else -> Color.Transparent
    }

    val message = when (syncState) {
        is SyncState.OfflinePending ->
            "Offline — ${syncState.pendingCount} order${if (syncState.pendingCount != 1) "s" else ""} pending sync"
        is SyncState.Syncing ->
            "Syncing — ${syncState.pendingCount} order${if (syncState.pendingCount != 1) "s" else ""} remaining"
        else -> ""
    }

    val textColor = when (syncState) {
        is SyncState.OfflinePending -> Color.White
        is SyncState.Syncing -> Color(0xFF3D3D3D) // dark text on yellow
        else -> Color.Transparent
    }

    AnimatedVisibility(
        visible = isVisible,
        enter = slideInVertically(initialOffsetY = { -it }) + fadeIn(),
        exit = slideOutVertically(targetOffsetY = { -it }) + fadeOut(),
        modifier = modifier
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(bannerColor)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = message,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = textColor
            )
        }
    }
}

// ────────────────────────────────────────────────────────────────
// Combined status row — dot + label, suitable for a toolbar
// ────────────────────────────────────────────────────────────────

/**
 * Row containing the [ConnectionDot] and a short text label.
 * Typical placement: top-right corner of the toolbar.
 *
 * @param syncState observed from [SyncManager.syncState]
 */
@Composable
fun ConnectionIndicator(
    syncState: SyncState,
    modifier: Modifier = Modifier
) {
    val label = when (syncState) {
        is SyncState.Connected -> "Online"
        is SyncState.Syncing -> "Syncing (${syncState.pendingCount})"
        is SyncState.OfflinePending -> "Offline (${syncState.pendingCount})"
        is SyncState.Disconnected -> "Offline"
    }

    val labelColor = when (syncState) {
        is SyncState.Connected -> GridSuccess
        is SyncState.Syncing -> GridWarning
        is SyncState.OfflinePending -> GridError
        is SyncState.Disconnected -> GridError
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        ConnectionDot(syncState = syncState)
        Text(
            text = label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            color = labelColor
        )
    }
}