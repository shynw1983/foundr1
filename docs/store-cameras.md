# Store cameras

The first integration supports a Wi-Fi eufy SoloCam S340 through a Mac on the store's account. `/store/devices` adds a camera card. The viewer captures approximately ten seconds **when requested**, displays its capture timestamp, and disconnects the camera after capture. It is a recent clip, not continuous live video or recording history.

## Data flow and access

1. An existing Store session opens the camera card. Roles match the equipment page: owner, manager, store_terminal, restricted to their visible stores.
2. Foundr1 issues a signed request bound to the employee session, store, configured camera, and enrolled Desktop Bridge device. It expires after five minutes; capture/upload is only accepted in the first ninety seconds.
3. A private Pusher channel delivers the request to the camera service on the designated Mac. The service uses the existing Desktop Bridge enrollment but runs separately. It does not modify or restart inventory/menu Bridge work.
4. The Mac loads eufy credentials and session from macOS Keychain, captures an MP4 in memory, then uploads it through the authenticated Foundr1 camera endpoint to a **private** Vercel Blob store. No eufy credentials are sent to Foundr1. Neither serial numbers nor Blob URLs are returned to viewers.
5. The requesting session fetches the clip through the authenticated Store API. The server deletes the cloud copy before returning the bytes; playback uses a browser memory Blob. Closing, leaving the page, hiding the app, or a five-minute preview deadline clears playback and sends cancellation.
6. Expired orphaned objects are swept on service startup and six minutes after capture activity. This is a fallback, not a permanent recording archive. If the Mac is offline after an interrupted upload, cleanup resumes at startup; expired tickets cannot retrieve the clip in the meantime. Privileged storage administrators can still access private objects until deletion.

No database tables, video rows, idle camera queries, or cron jobs are added. Existing session/enrollment authorization queries run only when viewing/authenticating/cleaning up. Pusher maintains its normal WebSocket connection. One capture runs at a time, duplicate request IDs are ignored, and starts have a ten-second minimum separation. A disposable SDK process has a hard deadline; cancellation kills that process without touching the original Desktop Bridge.

## Deployment configuration

Configure the following **only for the intended environment**:

- `STORE_CAMERAS_JSON`: array of `{storeId,id,name,bridgeDeviceId,bridgePlatform}`. `id` is a local key such as `parking`; `bridgeDeviceId` must be the enabled `local_bridge_devices.id` matching this MBA's existing token; platform is one of `desktop`, `uber_eats`, `rocket_now`, `demae_can`. The current Kitchen MacBook Air enrollment uses `desktop`. No account-wide fallback/master token is accepted by camera endpoints.
- `CAMERA_BLOB_READ_WRITE_TOKEN`: token for a dedicated **private** Blob store. The normal public image store is not reused. Private uploads fail closed if configured with a public store.
- `STORE_CAMERA_SECRET` or existing `AUTH_SECRET`: at least 32 characters. Tickets use a purpose-separated HMAC. Never use the development fallback secret.
- Existing `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`.

Camera setup is deployment configuration, not a business database migration. An unconfigured environment returns an empty camera list and keeps the existing SwitchBot panel usable. The CSP explicitly permits local `blob:` video and Pusher's secure WebSocket hosts.

## Mac setup

Use a stable directory on the Mac, not a disposable verification checkout. Node 24.5+ and Apple command-line build tools are needed. The SDK is pinned at `@mega-yfue/eufy-sdk@0.3.0` (unofficial).

```sh
cd camera-bridge
npm ci --ignore-scripts
cp config.example.json config.local.json
# Set desktopBridgeConfig to the existing Desktop Bridge config's absolute path.
npm run install:mac -- --prepare-only
npm run setup
# After the web deployment/configuration has been verified:
npm run install:mac
```

Setup prompts for existing eufy credentials, handles email verification and an optional local CAPTCHA image, discovers the S340, and checks a real capture. It asks before saving credentials/session to the current user's Keychain. `npm run setup -- --check-only` tests without saving. Account data enters the Keychain helper through stdin, never process arguments or config files. The local config contains only the camera binding and existing Bridge config path. Protect it with mode 0600. Do not commit config, Keychain helper outputs, logs, or any capture.

The LaunchAgent is `jp.foundr1.camera-bridge`; it starts on login. Logs under `~/Library/Logs/Foundr1 Camera Bridge` contain only generic service state. The service does not repeatedly retry eufy authentication after a verification challenge; it pauses login attempts for thirty minutes and reports that an administrator must reconnect.

To stop this integration, disable that LaunchAgent and remove this store's camera configuration. The independent original Desktop Bridge continues running. Keychain items use service `jp.foundr1.camera-bridge.<storeId>` and accounts `credentials` / `session`.

## Verification

```sh
node --test scripts/tests/store-cameras.test.cjs
npm --prefix camera-bridge test
node scripts/tests/store-camera-ui.mjs --serve
npm run build
git diff --check
```

The UI fixture binds the real page/components/translations to local fake APIs and a synthetic video. It must never be deployed. Verify mobile, tablet and desktop, normal playback, close during capture, late results, timeout, decode failure, and Japanese/Simplified/Traditional Chinese. API tests cover access denial, session and device binding, CSRF, bounded media, private delivery and deletion. Real SDK capture and synthetic UI playback are separate evidence; the complete deployed Store → Pusher → MBA → private Blob → authorized Store playback still needs a live end-to-end check after deployment configuration.
