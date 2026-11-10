const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

/**
 * Expo Config Plugin to ensure maximum compatibility on Android / Xiaomi MIUI devices:
 * 1. Sets expo.useLegacyPackaging=true so native .so libraries are compressed and extracted
 *    via android:extractNativeLibs="true" (prevents UnsatisfiedLinkError & MIUI installer failures).
 * 2. Enables android:usesCleartextTraffic="true" so LAN Desktop RPC Bridge (http://192.168.x.x:31542)
 *    and HTTP media downloads work on Android 9+ (API 28+).
 * 3. Strips SYSTEM_ALERT_WINDOW permission so Xiaomi MIUI Security Scan doesn't flag the sideloaded APK.
 */
module.exports = function withAndroidFixes(config) {
  config = withGradleProperties(config, (mod) => {
    const props = mod.modResults;
    const existing = props.find(
      (item) => item.type === 'property' && item.key === 'expo.useLegacyPackaging'
    );
    if (existing) {
      existing.value = 'true';
    } else {
      props.push({
        type: 'property',
        key: 'expo.useLegacyPackaging',
        value: 'true',
      });
    }
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Strip SYSTEM_ALERT_WINDOW which triggers MIUI Security warnings on sideloaded APKs
    if (Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (perm) => perm.$?.['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW'
      );
    }

    // Enable cleartext HTTP traffic for LAN Desktop Bridge & HTTP media downloads
    const mainApp = manifest.application?.[0];
    if (mainApp && mainApp.$) {
      mainApp.$['android:usesCleartextTraffic'] = 'true';
      mainApp.$['android:extractNativeLibs'] = 'true';
    }

    return mod;
  });

  return config;
};
