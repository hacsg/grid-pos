package sg.hundredacre.grid

import android.app.Application
import com.stripe.stripeterminal.TerminalApplicationDelegate
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class GridApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        // Stripe Terminal Application delegate — handles lifecycle hooks
        // (needed for foreground service notifications on newer Android versions)
        TerminalApplicationDelegate.onCreate(this)
    }
}