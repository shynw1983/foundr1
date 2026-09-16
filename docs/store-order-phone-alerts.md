# STORE phone alerts when away from a store

## Scope and current rollout

### Rule save feedback update (2026-09-16)

The management form now shows saving, success and validation/server/network errors beside its save button. Empty selections and invalid distance values produce explicit feedback instead of a disabled button with no explanation. Saving a disabled rule clearly says notifications remain off. The page lists all saved rules within the manager's permitted scope, including disabled rules, with user/store names, distances, last-save time and an edit action. Managers do not receive owner-account rules.

`save_rule` returns the persisted row so the list updates immediately without waiting for a native status round trip. Reload reads the same records from the server. Stale background refreshes cannot overwrite an in-flight save; failed saves preserve existing records. A store missing attendance coordinates returns a specific message. No live rule is changed by this repair, and no APK upgrade or schema change is required. Validation covers SQL persistence/readback, disabled rules, ownership/scope enforcement, mobile feedback, reload/edit and error states.

### Continuous alarm update (2026-09-16)

STORE 0.2.10 (code 22) adds an opt-in setting on each phone: keep ringing and vibrating until an order alert is acknowledged. Two original synthesized tones, urgent order bells and a two-tone alert, are bundled in the APK. They are not recordings from delivery apps. Playback uses the phone's **alarm volume**, with a direct volume-settings button and a ten-second preview that can be stopped immediately. The preview uses a monotonic clock and is not restored after process restart. Ordinary system notification tones remain available when continuous mode is off.

A received high-priority FCM order starts a visible `mediaPlayback` foreground service and one looping player. Duplicate messages and multiple pending orders share the player. Closing the WebView does not stop it; transient audio-focus loss pauses playback. A downgraded message or rejected service start falls back to the ordinary notification channel, while an explicitly blocked alarm channel stays blocked. No full-screen intent, overlay, volume override or DND bypass is added.

The notification and STORE page provide a confirmation action for exactly the displayed order IDs. A newly arrived order is not acknowledged by an older button. Confirmation immediately silences those orders locally and queues a network-constrained acknowledgement worker; it does not accept, start, finish or change any order. While ringing, the service checks the new device-authenticated `/api/store/order-notifications/alarm` endpoint approximately every 15 seconds. Remote acknowledgement, cancellation, kitchen progress, loss of scope and return to the store stop the corresponding alarm when observed. Already received alarms continue through network failures and beyond the five-minute initial delivery window. Local sign-out, permission loss or disabling the mode clears active alarms. Late messages cannot restart a locally or remotely acknowledged alert.

The narrow device credential now also permits status/acknowledgement of alert IDs delivered to that device, subject to the live login, employee scope and enabled store rules. It cannot enumerate orders or modify production state. The API rejects an entire acknowledgement batch if any ID is unauthorized. No schema or Firebase configuration change is required.

Validation: 18 Robolectric tests (including looping playback, no overlapping players, tone replacement, ten-second automatic preview stop, duplicate delivery, snapshot acknowledgement and blocked/downgraded fallback), ten isolated PostgreSQL API tests, signed APK build and Next.js production build. Browser checks use the actual page with simulated native/API state at 390, 768 and 1440 px. OPPO lock-screen playback and background delivery remain unverified on the physical phone. A force-stopped app, missing network before delivery, muted alarm stream, DND or vendor battery restrictions can still prevent alerts; this is not a guaranteed wake-up system.

References: [foreground service background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [media playback foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#media), [audio focus](https://developer.android.com/media/optimize/audio-focus).

### Notification presentation update (2026-09-16)

STORE 0.2.8 (code 20) adds an Android system ringtone picker, separate app-wide and order-category notification settings, and an on-device preview using the same channel and builder as received orders. The preview creates no order, changes no presence state and does not update the last FCM receipt timestamp. `VIBRATE` is now declared in the STORE manifest; the previous APK omitted it.

New installs use the system default notification sound on a high-importance channel. Upgrades keep the existing channel and user preferences. Android channel sound is immutable: an explicit ringtone selection replaces the channel while retaining importance (including blocked/low), vibration and lock-screen preferences. Unread notifications retain their old channel until dismissed. Sound preferences are separate from account/geofence preferences and survive re-registration/sign-out. A user's cancellation of the picker makes no change. No DND bypass, full-screen intent or overlay permission is introduced.

The page reports the actual channel importance, selected tone, notification volume, ringer mode and DND state. High importance is not proof that ColorOS allows banners: users must also check app-wide banner/lock-screen permissions. Older APKs see an upgrade link instead of unsupported controls. Settings/picker return refreshes status on focus, visibility changes and the existing periodic refresh.

Validation: eight Robolectric Android channel/picker/settings/preview tests, seven isolated PostgreSQL notification flow tests, signed release build and Next.js production build. Browser checks cover 390, 768 and 1440 px, Chinese labels, mute/DND warnings and old-APK fallback. Actual OPPO sound/banner presentation remains to be verified on the user's phone; only the Uber tablet was connected during preparation.

References: [Android notification channels](https://developer.android.com/develop/ui/views/notifications/channels), [ringtone picker](https://developer.android.com/reference/android/media/RingtoneManager#ACTION_RINGTONE_PICKER), [app notification settings](https://developer.android.com/reference/android/provider/Settings#ACTION_APP_NOTIFICATION_SETTINGS).

### Initial push rollout (2026-09-16)

The requested primary device is an OPPO Find N6 with working Google Play services. This implementation uses Firebase Cloud Messaging (FCM) in **Foundr1 STORE**, package `jp.foundr1.store`. It does not add push SDKs or background location permission to OS, Bridge, Member or Staff app flavors.

The production release was authorized on 2026-09-16. Firebase and Vercel setup was completed on 2026-09-15 as described below; the additive notification migration has now been applied and verified, and the production feature flag is enabled for this release. The initial signed public STORE APK was version 0.2.7 (code 19), using the existing release certificate. No phone or employee rule was activated by that rollout. The target employee and preferred distances are selected in the app before activation. The settings editor starts with a proposed 500 m exit / 300 m return rule; these are editable defaults, not an approved live employee rule.

The iPhone/browser version can view and acknowledge alerts, but cannot enable automatic background departure detection. This version therefore does not enroll those browsers in away-only push. An iOS native implementation is a separate requirement if automatic location-based alerts are needed there.

## Business behavior

- Applies to new Uber Eats, Rocket Now and Demae-can orders imported by Bridge. Web予約/POS checkout behavior and the two brand websites are unaffected.
- Creates an alert only after an active order, its items and a waiting kitchen task exist. Rocket orders already marked `preparing` by the delivery platform still qualify while their kitchen task has not started.
- Rejects old observations (over two minutes), old order imports (over ten minutes), terminal/cancelled orders, orders without kitchen tasks and orders already acknowledged or started in the kitchen.
- Each employee/store rule is opt-in and defaults off. Management uses `/store/notifications`; configuration is restricted to owners/managers and their accessible stores. Only roles already permitted to use STORE (`owner`, `manager`, `store_terminal`) are selectable. A manager cannot change an owner rule. Sending rechecks the recipient's live account, login session and store scope.
- Each phone independently maintains two geofences. Exiting the larger circle enables away status; entering the smaller circle disables it. A position between the circles retains the last confirmed state. A fresh initial position in the gap stays unknown. Location samples with poor accuracy do not establish a new inside/outside state.
- The center is the store's **attendance** latitude/longitude, not its weather coordinate. A rule cannot be enabled without the attendance coordinate.
- Only phones whose current rule is confirmed outside on the server receive an FCM order message. The native receiver checks the local state and permissions again before displaying it.
- Ordinary notification mode: initial notification plus up to three additional notifications, spaced 30 seconds apart. Every send rechecks acknowledgement, cancellation, kitchen progress and recipients. Late scheduler recovery skips missed slots instead of issuing a burst. The overall alert window is five minutes; each FCM message has a 60-second TTL.
- Any authorized user can mark the alert as acknowledged. This changes **only** the alert row, never order acceptance, cooking time, preparation or completion status. Already transmitted messages can race with acknowledgement.
- Notification copy contains store, platform, order code and total. Platform preparation time is not fabricated when it is absent from the imported order data.

## Data flow and privacy

`Bridge import → kitchen task persisted → store_order_alert_events → durable workflow → outside devices → FCM → native notification`

`Phone geofence transition → WorkManager → narrow device credential → store_order_push_presence`

The migration adds `store_order_push_preferences`, `store_order_push_devices`, `store_order_push_presence` and `store_order_push_deliveries`. It reuses `store_order_alert_events` with phase `bridge_order_received`, isolated from the existing reservation reminder phase. A unique order/phase key and event/device/attempt delivery keys protect against duplicate snapshots and workflow retries. Native delivery keys provide a second deduplication layer after ambiguous provider/network responses.

Only `inside`, `outside` or `unknown`, rule identity and observation time leave the phone. GPS samples and travel history are not stored on the server. Push registration binds to an active employee session. The background API receives an opaque device capability; its hash is stored in the database, and it can refresh that device's token and presence. From STORE 0.2.10 it can also check and acknowledge specific alerts already delivered to that device, under current store rules and scope; it cannot enumerate orders, change rules or modify orders. Logout/revoked sessions prevent further dispatch. Backup is disabled for the STORE flavor so these credentials are not restored to another phone.

The native web-message bridge permits only the exact production HTTPS origins and the main frame. Firebase administrative credentials never enter the WebView or APK. Rule changes invalidate old presence until the phone synchronizes the new rule. Background workers refresh configuration periodically; opening STORE refreshes it immediately.

## Configured cloud resources

- Firebase project `foundr1-store` (Foundr1 STORE), project number `866443103733`, in the `maru-kyu.jp` organization. The project uses Spark; Analytics was not enabled.
- Android app `jp.foundr1.store`, app ID `1:866443103733:android:5accd74eebcfc9913124bc`. FCM HTTP v1 and IAM Service Account Credentials API are enabled.
- Dedicated service account `foundr1-order-push@foundr1-store.iam.gserviceaccount.com`. Its project role `projects/foundr1-store/roles/foundr1OrderPushSender` contains exactly `cloudmessaging.messages.create`.
- Google organization policy `iam.disableServiceAccountKeyCreation` prohibited creating a private key. It was left enforced. The application uses Vercel OIDC and Google Workload Identity Federation instead of a private key.
- Pool `foundr1-vercel-push`, provider `vercel-production`, issuer `https://oidc.vercel.com/seigin1983s-projects`, allowed audience `https://vercel.com/seigin1983s-projects`, mapping `google.subject=assertion.sub`.
- Provider condition requires `owner_id == team_EriAi05D5ra5vOK3HPtk2BBv`, `project_id == prj_bQ8RQtf4EoKUGU9pN2XGXTFDLOpJ`, and `environment == production`.
- Only the exact subject `owner:seigin1983s-projects:project:foundr1:environment:production` has Workload Identity User on the dedicated service account. No pool-wide impersonation grant was added. Team/project renames require updating the issuer, audience and subject binding.
- All seven configuration variables below are saved for the existing Vercel `foundr1` project's **production** environment; `STORE_ORDER_PUSH_ENABLED=true` for the authorized 2026-09-16 release. No `FCM_PRIVATE_KEY` is used or stored.

At dispatch time, `@vercel/oidc` reads the current Vercel runtime identity. Google STS validates its team/project/environment, then IAM Credentials issues a 15-minute token scoped to Firebase messaging for the dedicated service account. Concurrent sends share the short-lived token; it refreshes before expiry. Preview/development identities do not receive production send access. The initial STS exchange uses the Cloud Platform OAuth scope required for impersonation; effective resource permissions still come from the narrowly bound IAM roles.

## Setup and release sequence

1. In the approved Firebase project, register Android package `jp.foundr1.store`, enable FCM HTTP v1 and IAM Credentials, and configure the production-only Workload Identity Federation binding above. FCM does not require distributing this APK through Google Play.
2. Configure the target server environment:

   ```text
   FCM_PROJECT_ID
   FCM_ANDROID_APP_ID
   FCM_ANDROID_API_KEY
   FCM_SENDER_ID
   FCM_CLIENT_EMAIL
   FCM_WIF_PROVIDER
   STORE_ORDER_PUSH_ENABLED=false
   ```

   The first four values are client configuration. The final two FCM values identify the dedicated service account and federation provider on the server. `FCM_WIF_PROVIDER` is `projects/866443103733/locations/global/workloadIdentityPools/foundr1-vercel-push/providers/vercel-production`. Vercel supplies a fresh runtime OIDC token; do not manually store an OIDC token as a permanent deployment variable. Existing `CRON_SECRET` protects scheduler recovery.
3. Apply only [the additive notification migration](../db/migrations/20260915-store-order-push.sql) to the authorized database. `db/schema.sql` includes the same definitions. Do not apply unrelated pending migrations or the entire schema to enable this feature.
4. Build and publish the signed STORE APK within the approved release. Use the existing release signing key to preserve an installed STORE app's data. The 2026-09-16 release publishes STORE 0.2.7 (code 19); its SHA-256 is `dd9b7979e1650b56fb4297f560934b31d0ec7e98ab76a1b9a8600b91bd4e46cc`.
5. Set `STORE_ORDER_PUSH_ENABLED=true` in the approved environment and deploy. Verify the production transport using an authenticated `POST /api/cron/store-order-push` with the existing `CRON_SECRET`. This endpoint always uses FCM `validate_only`, exercising runtime OIDC, STS, service-account impersonation and FCM authorization without delivering a notification. Unauthenticated requests return 401. When `CRON_SECRET` is stored as a non-readable sensitive variable, an already logged-in owner/manager can use `GET /api/store/order-notifications/health` for the same validation-only check; other roles return 403. This preserves the existing cron secret and avoids exporting credentials. Then create the approved user/store/distance rule at `/store/notifications`.
6. On the phone, open STORE with that user, allow notifications and **precise location all the time**, then register the phone. The page distinguishes unconfigured, unregistered, permission missing, inside, pending location/sync and outside states. Use the phone's notification channel settings for sound/vibration/lock-screen behavior.
7. Send a user-requested test notification. The test deliberately works inside the store and checks transport/display independently of geofencing. Provider acceptance is not proof of receipt; confirm sound and `lastReceivedAt` on the phone.
8. Test actual departure/return and a fresh delivery order while locked/backgrounded before relying on this alert.

Android may batch background geofence transitions by a few minutes. Force-stop, no network, missing location permission, disabled location, muted notification channels or battery restrictions can prevent/delay alerts. This implementation does not claim exact boundary timing, automatic DND bypass or guaranteed delivery. Continuous alarm playback requires the opt-in STORE 0.2.10 mode described above. A location-unknown device is not reported as an active away recipient.

## Validation

Verified for the isolated 2026-09-16 release: seven SQL/API tests, 37 Bridge/FCM/health regression tests and the final Next.js production build passed. The Java distance-policy test passed during implementation. The production migration added the four notification tables, verified with no preconfigured rules or devices. The signed STORE 0.2.7 (code 19) build and signature verification passed. Earlier verification on 2026-09-15 included: The signed STORE `0.2.7-test` (version code 18) release build and Bridge Java compilation passed. APK inspection confirmed `jp.foundr1.store`, the push/location components, and the existing quick-inventory activity/widget. The test APK SHA-256 is `4a378889d3ab6a515582f98baa6d2da696466eb0062eb750ede757891b02e393`.

The actual notification page was inspected at 390, 768 and 1440 px with simulated native/API states (outside, inside, unknown, browser and unconfigured), with no horizontal overflow. Acknowledgement issued only the alert acknowledgement action. The existing database readiness check passed before migration; the four new notification tables were separately verified after migration. Google IAM bindings and enabled APIs were verified in the console. A real Vercel development identity was rejected by Google STS with `unauthorized_client` and an attribute-condition rejection, confirming the environment restriction. The CLI supplies a development identity even when pulling production variables; it cannot validate the production success path. Run the authenticated production validation endpoint after deployment to verify the production token exchange and FCM authorization. Real phone delivery, OPPO background geofencing and lock-screen sound require phone setup and an explicit test; the server validation does not prove those behaviors. No actual message was sent during build verification.

Local PostgreSQL tests use an isolated PGlite database; they do not use `DATABASE_URL`:

```bash
npm install --prefix /tmp/foundr1-order-push-test --no-audit --no-fund @electric-sql/pglite
node --test scripts/tests/store-order-push.test.mjs
node --experimental-strip-types --test lib/store-order-push-transport.test.ts lib/store-order-push-health.test.ts lib/rocket-bridge-import.test.ts lib/rocket-now-bridge.test.ts lib/uber-bridge.test.ts lib/demae-can-bridge.test.ts
mkdir -p /tmp/foundr1-push-java-tests
javac -d /tmp/foundr1-push-java-tests Foundr1Android/app/src/store/java/jp/foundr1/store/StorePresencePolicy.java Foundr1Android/tests/StorePresencePolicyTest.java
java -cp /tmp/foundr1-push-java-tests jp.foundr1.store.StorePresencePolicyTest
npm run build
```

Set `PGLITE_MODULE` if using another PGlite installation. The tests exercise actual SQL and routes for persistence, duplicate processing, authorization, session revocation, stale/inside/unknown states, acknowledgement, provider failure and stale presence updates. OIDC exchange, scoped impersonation, HTTP payloads, concurrent token caching, expiry, authentication failures and unregistered devices are tested with mocked transport. Browser checks use the actual React page with simulated API/native responses at phone, tablet and desktop widths; those checks do not prove real GPS or push delivery.

Official references: [FCM Android setup](https://firebase.google.com/docs/cloud-messaging/android/get-started), [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api), [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp), [Android geofencing and background limits](https://developer.android.com/develop/sensors-and-location/location/geofencing).
