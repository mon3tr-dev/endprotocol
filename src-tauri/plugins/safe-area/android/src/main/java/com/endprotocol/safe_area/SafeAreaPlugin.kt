package com.endprotocol.safe_area

import android.app.Activity
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Reports the system-bar insets to the frontend.
 *
 * The web platform's `env(safe-area-inset-*)` does not work here: wry's
 * Android WebView is laid out behind the status/navigation bars (Android 15
 * forces edge-to-edge) but is never told what the insets are, so `env()`
 * resolves to `0px` while the bars visibly overlap the page.
 *
 * Reading `WindowInsetsCompat` directly gives the real values. They are
 * converted from **physical pixels** to **CSS pixels** by dividing with the
 * display density — the frontend's CSS variables are in CSS px, and mixing the
 * two units is what makes a 74px status bar turn into a 74 *CSS* px gap.
 */
@TauriPlugin
class SafeAreaPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun getSafeAreaInsets(invoke: Invoke) {
        try {
            val decorView: View? = activity.window?.decorView
            if (decorView == null) {
                invoke.resolve(emptyInsets())
                return
            }

            val density = activity.resources.displayMetrics.density
            if (density <= 0f) {
                invoke.resolve(emptyInsets())
                return
            }

            val insets = ViewCompat.getRootWindowInsets(decorView)
                ?: run {
                    invoke.resolve(emptyInsets())
                    return
                }

            val systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )

            invoke.resolve(
                JSObject().apply {
                    put("top", (systemBars.top / density).toDouble())
                    put("bottom", (systemBars.bottom / density).toDouble())
                    put("left", (systemBars.left / density).toDouble())
                    put("right", (systemBars.right / density).toDouble())
                }
            )
        } catch (error: Exception) {
            // Never fail the call: the frontend falls back to env(), and a
            // missing inset is far less harmful than a broken page.
            invoke.resolve(emptyInsets())
        }
    }

    private fun emptyInsets() = JSObject().apply {
        put("top", 0.0)
        put("bottom", 0.0)
        put("left", 0.0)
        put("right", 0.0)
    }
}
