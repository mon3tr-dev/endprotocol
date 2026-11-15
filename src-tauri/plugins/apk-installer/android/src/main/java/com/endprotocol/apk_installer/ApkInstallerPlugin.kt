package com.endprotocol.apk_installer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
internal class InstallApkArgs {
    lateinit var path: String
}

@TauriPlugin
class ApkInstallerPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun installApk(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(InstallApkArgs::class.java)
            val apk = File(args.path).canonicalFile
            // `app_cache_dir()` on Android resolves to `getCacheDir()/<identifier>`, so the
            // APK lives in the app's private cache. Accept anything below that cache root
            // instead of pinning the exact subdirectory layout.
            val cacheDirectory = activity.cacheDir.canonicalFile

            if (!apk.path.startsWith(cacheDirectory.path + File.separator) ||
                !apk.isFile || !apk.extension.equals("apk", ignoreCase = true)
            ) {
                invoke.reject("The APK path is invalid.")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !activity.packageManager.canRequestPackageInstalls()
            ) {
                val settingsIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
                activity.startActivity(settingsIntent)
                // Report as a normal result rather than an error: the caller keeps the
                // downloaded APK and retries installation once permission is granted,
                // instead of paying for the download again.
                invoke.resolve(JSObject().put("status", STATUS_PERMISSION_REQUIRED))
                return
            }

            val apkUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.apkprovider",
                apk
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(installIntent)
            invoke.resolve(JSObject().put("status", STATUS_OPENED))
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Failed to open the Android package installer.")
        }
    }

    private companion object {
        const val STATUS_OPENED = "opened"
        const val STATUS_PERMISSION_REQUIRED = "permissionRequired"
    }
}
