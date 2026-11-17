# Releasing GRabbit

Pushing a `v*` tag (or running the **Release** workflow by hand) builds every platform and
publishes one GitHub release with `SHA256SUMS.txt`. Two signing keys are involved. Set them up
once.

## Android: release signing key (required)

Without it, Gradle signs the APK with the public Android debug key. Anyone has that key, so anyone
could build an APK that Android accepts as an update over GRabbit. The release workflow therefore
**fails** when the key is missing, and checks that the built APK is not debug-signed.

1. Create the key once and keep it safe (losing it means users must uninstall to update):

   ```bash
   keytool -genkeypair -v -storetype JKS -keystore grabbit-upload.jks -alias grabbit -keyalg RSA -keysize 4096 -validity 10000
   ```

2. Add these repository secrets (**Settings → Secrets and variables → Actions**):

   | Secret | Value |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 grabbit-upload.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("grabbit-upload.jks"))`) |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `grabbit` (or the alias you chose) |
   | `ANDROID_KEY_PASSWORD` | the key password |

3. **One-time switch for existing users.** APKs up to v1.2.1 were signed with the debug key.
   Android refuses to install an update signed with a different key, so people on those versions
   must uninstall once and install the new APK. Say so in the release notes of the first signed
   release. (Their downloads list and settings live in the app's storage and are removed by the
   uninstall.)

Local builds: `apps/mobile/plugins/withAndroidFixes.js` reads the same key from
`GRABBIT_UPLOAD_STORE_FILE`, `GRABBIT_UPLOAD_STORE_PASSWORD`, `GRABBIT_UPLOAD_KEY_ALIAS` and
`GRABBIT_UPLOAD_KEY_PASSWORD`. Without them a local release build is debug-signed, which is fine
for testing on your own device.

## Windows: code signing (recommended)

Unsigned installers trigger SmartScreen warnings, and electron-updater can only check the
publisher of a downloaded update when the app itself is signed. The workflow signs with
[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) when it is configured,
and otherwise builds unsigned with a warning.

Repository **variables**:

| Variable | Example |
| --- | --- |
| `AZURE_SIGN_ENDPOINT` | `https://eus.codesigning.azure.net/` |
| `AZURE_SIGN_ACCOUNT` | Trusted Signing account name |
| `AZURE_SIGN_PROFILE` | certificate profile name |
| `AZURE_SIGN_PUBLISHER` | the subject CN on the certificate, e.g. your legal name |

Repository **secrets**: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` for an app
registration with the *Trusted Signing Certificate Profile Signer* role.

## Checklist

- Bump `version` in the root, `apps/*` and `packages/*` `package.json` files and `apps/mobile/app.json`.
- Update the download links in `README.md`.
- Tag `vX.Y.Z` and push the tag.
- Check that the release has an `.exe`, a portable `.exe`, `latest.yml`, the `.apk`, the
  extension `.zip`, and `SHA256SUMS.txt`.
