const { withAndroidManifest, withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const SIGNING_MARKER = 'GRABBIT_UPLOAD_STORE_FILE';

/**
 * Signs release builds with the GRabbit upload key when CI provides it through environment
 * variables (GRABBIT_UPLOAD_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD). Without
 * them a release build falls back to the public debug key, which is fine for local testing but
 * must never be published: anyone holding that key can sign an "update" Android will accept.
 * The release workflow refuses to publish an APK signed with the debug key.
 */
function addReleaseSigning(gradle) {
  if (gradle.includes(SIGNING_MARKER)) return gradle;

  const releaseConfig = `
        release {
            def grabbitStore = System.getenv('GRABBIT_UPLOAD_STORE_FILE')
            if (grabbitStore) {
                storeFile file(grabbitStore)
                storePassword System.getenv('GRABBIT_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('GRABBIT_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('GRABBIT_UPLOAD_KEY_PASSWORD')
            }
        }`;
  const signingStart = gradle.indexOf('signingConfigs {');
  if (signingStart === -1) throw new Error('withAndroidFixes: app/build.gradle has no signingConfigs block');
  const insertAt = signingStart + 'signingConfigs {'.length;
  let out = gradle.slice(0, insertAt) + releaseConfig + gradle.slice(insertAt);

  const buildTypes = out.indexOf('buildTypes {');
  const releaseType = buildTypes === -1 ? -1 : out.indexOf('release {', buildTypes);
  const debugSigning = 'signingConfig signingConfigs.debug';
  const target = releaseType === -1 ? -1 : out.indexOf(debugSigning, releaseType);
  if (target === -1) throw new Error('withAndroidFixes: release build type has no signingConfig to replace');
  out =
    out.slice(0, target) +
    "signingConfig System.getenv('GRABBIT_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug" +
    out.slice(target + debugSigning.length);
  return out;
}


/**
 * Expo Config Plugin to ensure maximum compatibility on Android / Xiaomi MIUI devices:
 * 1. Sets expo.useLegacyPackaging=true so native .so libraries are compressed and extracted
 *    via android:extractNativeLibs="true" (prevents UnsatisfiedLinkError & MIUI installer failures).
 * 2. Enables android:usesCleartextTraffic="true" so LAN Desktop RPC Bridge (http://192.168.x.x:31542)
 *    and HTTP media downloads work on Android 9+ (API 28+).
 * 3. Strips SYSTEM_ALERT_WINDOW permission so Xiaomi MIUI Security Scan doesn't flag the sideloaded APK.
 * 4. Signs release builds with the GRabbit upload key from the environment (see addReleaseSigning).
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
    } else {
      manifest['uses-permission'] = [];
    }

    // Ensure REQUEST_INSTALL_PACKAGES is declared so in-app APK updater can launch the package installer
    if (
      !manifest['uses-permission'].some(
        (perm) => perm.$?.['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES'
      )
    ) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES' },
      });
    }

    // Enable cleartext HTTP traffic for LAN Desktop Bridge & HTTP media downloads
    const mainApp = manifest.application?.[0];
    if (mainApp && mainApp.$) {
      mainApp.$['android:usesCleartextTraffic'] = 'true';
      mainApp.$['android:extractNativeLibs'] = 'true';
    }

    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language === 'groovy') mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });

  return config;
};

module.exports.addReleaseSigning = addReleaseSigning;
