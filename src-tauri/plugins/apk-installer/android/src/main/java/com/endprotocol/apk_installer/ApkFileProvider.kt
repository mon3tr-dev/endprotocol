package com.endprotocol.apk_installer

import androidx.core.content.FileProvider

/**
 * Dedicated FileProvider subclass for the update-APK cache.
 *
 * The manifest merger keys <provider> nodes by android:name, so declaring the
 * same androidx.core.content.FileProvider class twice (app template + this
 * plugin) collides on authorities and FILE_PROVIDER_PATHS. Android requires
 * each extra FileProvider in an APK to be its own subclass anyway; keeping the
 * base class for the app template and this subclass for the plugin lets both
 * providers coexist with distinct authorities (.fileprovider / .apkprovider).
 */
class ApkFileProvider : FileProvider()
