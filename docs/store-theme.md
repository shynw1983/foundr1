# Store theme colors

Store appearance belongs to the selected active store. Four independent targets share
one permission boundary: `operations`, `pickup`, `customer` (POS customer display),
and `courier`. The operation UI keeps its existing `#245d49` default. Customer screens
default to brand mode, independent of the operation UI. This changes the Store web interface;
it does not change OS, Staff, brand websites, product images, platform logos or the
Android native shell and widgets.

## Management and permissions

- Open **表示設定** in Store navigation (`/store/settings/appearance`). The entry is
  visible only when the authenticated theme API grants `canManageTheme`.
- `store.theme.manage` is a separate role permission, enabled and locked for owner
  by default. Managers and store managers/owners may be explicitly authorized.
  Staff and shared terminal accounts cannot save themes, even if a role permission
  is accidentally assigned to them.
- Every save validates the current active employee session, permission, active
  store and store scope, as well as same-origin requests. An authorized manager
  can enter the appearance route without gaining the rest of the Store workbench.
- The page selects a store and target. Every draft stays inside its preview;
  editing customer screens never recolors the Store navigation or avatar. Saving
  publishes only the selected target. Switching stores/targets discards the local
  draft. Customer targets offer brand and custom modes; operations uses custom color.

## Persistence and concurrent editing

`GET /api/store/theme?storeId=<id>&target=<target>` returns a verified store context, theme, edit
capability and revision. Without a store ID it selects the first active accessible
store. Explicit inaccessible URL targets are rejected rather than silently switched.

`POST /api/store/theme` accepts `storeId`, `target`, `mode`, a six-digit opaque
`primaryColor` for custom mode, and `expectedRevision` (`null` for an initial setting).
Missing target remains `operations` for deployed older clients; explicit invalid
values fail. Operations accepts only custom mode (omitted mode supports old clients).
Customer writes must supply a mode. Brand mode stores the policy without freezing a
color snapshot. Existing `module_settings` uses `scope_key = store:<id>` and independent
module keys `store_theme`, `store_theme_pickup`, `store_theme_customer`, and
`store_theme_courier`. Each target has its own revision, CAS and audit metadata.
Old operation clients cannot overwrite customer settings.
No new table or migration is required. The revision comparison and the audit entry
commit in one SQL statement. An outdated revision returns 409 without changing the
theme or audit history; the editor retains the draft and asks the user to review the
latest saved setting before trying again. Audit metadata records old/new settings,
actor and modification time.

## Palette and delivery

`lib/store-theme.ts` derives all tokens from a validated hex color. The chosen color
is retained for filled actions and display accents. Action foregrounds, hover/pressed
states, readable text accents, selection backgrounds, borders and neutral surfaces
are derived together. Success, information, warning and danger remain independent.
Changing the theme never changes stock, order or payment state.

`StoreThemeProvider` attaches tokens to `body[data-store-theme]`, covering shared
menus, fixed dialogs and root-level feedback. It restores previous properties and
the browser theme-color on exit. Login uses the default palette. Themes cached by
employee, store and target provide the last valid color when offline; cached colors never
grant edit rights. Visible online pages refresh every minute, on focus and after
reconnection. Same-browser tabs also react to saved-theme storage changes.

The provider maps only exact customer routes to their target: `/store/display/pickup`,
`/store/pos/customer-display`, `/store/display/courier`. Kitchen and seating continue
to use operations. Moving between routes reloads the matching record and rejects
stale responses from another target.

`lib/store-display-brand.ts` resolves a single active, known brand associated with
the store. maamaa uses the established pickup/logo red `#c30d23`; nanacha uses its
logo ink `#231916`. These are explicit brand identities, not image pixel extraction.
Multi-brand and unknown-brand stores use screen defaults (pickup red `#c30d23`,
customer/courier neutral `#262827`) until an authorized user sets a custom color.
The provider never falls back to the operations color for these targets.

Store-specific CSS maps existing tokens and independently styled screen surfaces
to their active target palette. Third-party identity colors,
business state colors and media retain their own meaning. Native Android system
bars, native dialogs, launch assets and widgets need a separate APK implementation
and device validation if they are to follow the web setting.

## Verification

- Palette tests sample the sRGB cube, including near-white, near-black and yellow,
  checking action, selected-text and focus contrast as well as independent status colors.
- API/access and isolated PostgreSQL tests cover denied roles, store scope, malformed
  colors, same-origin enforcement, revision conflicts, concurrent saves and audit rollback.
- Browser checks use the actual provider, editor and CSS against an isolated local
  fixture. Production settings are not changed by these checks.
