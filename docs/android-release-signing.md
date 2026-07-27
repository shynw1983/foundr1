# Android release signing

Foundr1 Store uses a fixed release signing key from version `0.2.0` (`versionCode 11`) onward.

## Local signing files

The signing key and credentials are intentionally stored outside the repository:

- `~/.foundr1/android/foundr1-release.jks`
- `~/.foundr1/android/release.properties`

The properties file contains:

```properties
storeFile=/absolute/path/to/foundr1-release.jks
storePassword=...
keyAlias=foundr1-release
keyPassword=...
```

Both files must remain readable only by the owning user and must never be committed.

Before relying on app upgrades, keep an encrypted copy of both files on a separate device or managed secrets vault. Losing the signing key makes it impossible to install a future APK over an existing installation.

## Build and publish

Use the repository publishing command from the repository root:

```bash
npm run apk:store
```

The Store publisher builds `storeRelease`, increments the version code from `public/downloads/store/version.json`, and updates:

- the versioned APK under `public/downloads/store/`
- `public/downloads/store/latest.apk`
- `public/downloads/foundr1-store-latest.apk`
- `public/downloads/store/version.json`

Other Android flavors remain on their existing build type until they are deliberately migrated to release signing.

## Signature verification

Verify a generated APK before publishing:

```bash
apksigner verify --verbose --print-certs public/downloads/store/latest.apk
```

The Foundr1 release certificate SHA-256 digest begins with `043563376a2e0d52`.
