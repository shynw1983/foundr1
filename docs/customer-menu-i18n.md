# Customer Menu I18n

This guide defines the multilingual menu and customer-display contract for Foundr1 OS, brand websites, POS, member cards, and future customer-facing projects.

## Principle

Foundr1 OS is the source of truth for customer-facing menu data. Brand websites and POS surfaces must not maintain separate translated menu catalogs.

The backoffice UI may stay Japanese for staff operation, but anything shown to customers must be rendered from stable menu/member/order IDs and translated display data from Foundr1 OS.

## Language Source

- If no member/customer language is known, show Japanese.
- If a member card has been scanned or a customer context includes a language, use that language for customer-facing surfaces.
- The member card language is the global language selector encoded with the member identity. Do not read a removed or legacy profile preference field.
- Keep the language consistent across headings, product names, option names, tax labels, coupons, rewards, payment instructions, thank-you pages, and member greetings.

Current customer-facing menu languages:

- `en` English
- `zh` Simplified Chinese
- `zh-Hant` Traditional Chinese
- `ko` Korean
- `vi` Vietnamese
- `ne` Nepali

Japanese is the source/default language and does not need to be duplicated into `displayNames`.
Simplified Chinese (`zh`) and Traditional Chinese (`zh-Hant`) are separate customer languages. Do not populate `zh-Hant` by copying `zh`; leave it empty until a real Traditional Chinese translation is available.

## Menu Data Contract

Menu records that can appear to customers must carry translated display names:

- `menu_catalog_items.display_names`
- `menu_catalog_items.description_display_names`
- `menu_option_groups.display_names`
- `menu_options.display_names`
- Coupon, reward, discount, and exchange-ticket customer labels should use the same pattern when they have stable IDs.

Use this shape:

```ts
type DisplayNames = Partial<Record<"en" | "zh" | "zh-Hant" | "ko" | "vi" | "ne", string>>;
```

Public APIs should expose `displayNames` next to the Japanese/source `name` or `label`:

```ts
type PublicMenuItem = {
  id: string;
  name: string;
  displayNames: DisplayNames;
  description: string;
  descriptionDisplayNames: DisplayNames;
};

type PublicMenuOptionGroup = {
  id: string;
  name: string;
  displayNames: DisplayNames;
  options: PublicMenuOption[];
};

type PublicMenuOption = {
  id: string;
  name: string;
  displayNames: DisplayNames;
};
```

## Fallback Order

Every customer-facing renderer should resolve menu text in this order:

1. `displayNames[requestedLanguage]`
2. `displayNames.en`
3. Japanese/source `name`

Never map English to Chinese as a fallback. Never translate only product names while leaving options, tax labels, member suffixes, or payment text in a different language.

## AI Translation Workflow

OS menu management can generate missing customer-facing translations with AI. The workflow must stay review-first:

1. Scan menu items, item descriptions, option groups, and options for missing language fields.
2. Call OpenAI via `OPENAI_API_KEY` to create candidate translations. The menu translation model defaults to `gpt-5.4-mini` and can be overridden with `OPENAI_MENU_TRANSLATION_MODEL`.
3. Show candidates in a preview UI where staff can edit or exclude each row.
4. Write to `displayNames` / `descriptionDisplayNames` only after explicit confirmation.

Do not write AI output directly into menu tables without a preview and manual confirmation step.

## Public Menu API

Brand websites and new customer-facing projects must consume the standard Foundr1 OS public menu API:

```txt
/api/public/menus?brand=<brandKey>
```

Do not build new projects on brand-specific `*-compatible` menu endpoints. Those endpoints are not the long-term contract for new customer-facing work.

Expected usage:

- Read `items` and `optionGroups` from the standard API.
- Keep item and option IDs in the order payload.
- Render labels with the fallback order above.
- Send structured choices back to Foundr1 OS checkout APIs so POS, kitchen, customer display, receipts, and member order history can all resolve the same menu data.

## Brand Website Integration

When building or changing a brand website:

- Use Foundr1 OS menu IDs as the canonical product/option identity.
- Transform the standard menu payload into the website's UI model only at the edge of the frontend/server adapter.
- Preserve `displayNames` through that transform.
- Use local translation files only for UI chrome such as buttons, validation, pickup time labels, and help text.
- Do not create local translated copies of product names, toppings, sizes, heat/numb levels, sweetness, ice, or drink options.
- If a required customer-facing label cannot be translated from menu data, add it to `/os/menus` or the relevant OS master data first.

## Brand Project Ownership Boundary

Brand websites may own their non-menu UI translations directly in their own projects. This includes navigation, page headings, reservation form labels, checkout help text, validation messages, member-card UI, legal/static copy, and other text that is not a menu/catalog entity.

Menu/catalog translations must stay owned by Foundr1 OS. Drink names, malatang ingredients, sizes, sweetness, ice, heat/numb levels, toppings, categories, coupons/rewards with stable IDs, and any customer-facing product option labels must be edited in OS menu/master data and delivered through `displayNames`.

The current brand-site locale dictionaries may contain menu-label seed data only to bootstrap/import Foundr1 OS menu translations. After menu data exists in OS, those seed dictionaries are not the long-term source of truth and must not be treated as separate website-owned catalogs.

If a brand project changes UI translation independently, it must keep rendering menu text from the OS public menu API. If a menu translation looks wrong on the website, fix the OS menu translation/import source rather than patching the website UI dictionary.

## POS Customer Display

The POS customer display must follow the same language contract:

- Default to Japanese until a member/customer language is known.
- After scanning a member card, use the encoded member-card language.
- Product names and selected options must come from menu item/group/option IDs and `displayNames`.
- Non-Japanese member greetings should not append Japanese-only honorifics such as `様`; use the target language's greeting pattern.
- Tax, discount, coupon, reward, exchange-ticket, payment, and thank-you labels must be translated as UI/customer copy, not left in Japanese while product names change language.
- If POS is opened but no transaction activity occurs for 10 seconds, the customer display should return to the advertising/standby state.

## Adding A New Language

When adding another customer-facing language:

1. Add the language code to the customer menu language list in OS menu management.
2. Add input fields for item, option group, option, coupon/reward/discount display names.
3. Ensure `/api/public/menus?brand=...` returns the new language in `displayNames`.
4. Update POS customer display UI strings and member-card language encoding/decoding.
5. Update nanacha and maamaa website language selectors/renderers in the same pass unless the change is explicitly scoped to one brand.
6. Test web checkout, POS checkout, customer display, member order history, and kitchen/production summaries.

## Anti-Patterns

Avoid these patterns:

- Hard-coding translated product names in a brand website.
- Translating only product names but not option names.
- Reading member language from an old profile preference after the member card already carries the selected language.
- Using browser locale to override the member/customer language.
- Returning different menu structures per language.
- Preserving old compatibility endpoints for new projects when the system is not live yet.
- Sending only human-readable summary text to Foundr1 OS instead of structured item and option IDs.
