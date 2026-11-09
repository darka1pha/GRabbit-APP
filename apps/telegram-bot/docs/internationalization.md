# Internationalization (i18n) — g(Rabbit)

Multilingual support is a first-class architectural requirement in g(Rabbit). The application ships with comprehensive support for **English (`en`)** and **Persian (`fa`)**, engineered to seamlessly welcome additional languages.

---

## 1. Directory Structure

```
locales/
  en.ftl    # Reference catalog (English)
  fa.ftl    # Persian translation catalog
```

## 2. Language Resolution Priority

When processing an incoming Telegram update:
1. **Explicit Preference**: User preference stored in PostgreSQL `users.language_code`.
2. **Telegram Client Language**: `ctx.from.language_code` normalized (e.g., `fa-IR` -> `fa`, `en-US` -> `en`).
3. **Application Default**: Configured `DEFAULT_LANGUAGE` from environment variables.
4. **Fallback**: English (`en`).

## 3. How to Add a New Language

Adding a new language (e.g., Arabic `ar`, Spanish `es`, or German `de`) takes 5 simple steps:

1. **Create the translation file**:
   Duplicate `locales/en.ftl` to `locales/<lang_code>.ftl` (e.g., `locales/ar.ftl`).

2. **Translate the keys**:
   Translate every string value while preserving named variable placeholders (e.g., `{ $appName }`, `{ $title }`, `{ $percent }`).

3. **Register the language code**:
   Add the language code to `SUPPORTED_LOCALES` in `src/config/constants.ts` and add its button in `src/bot/keyboards/index.ts`.

4. **Run the translation validator**:
   ```bash
   pnpm validate:translations
   ```
   The validator confirms that all 45+ reference keys and all variables exist and match.

5. **Run tests**:
   ```bash
   pnpm test
   ```

## 4. Persian (RTL) Implementation Notes

- Persian messages are rendered naturally with culturally native idioms.
- Technical parameters (e.g., URLs, formats `MP3`, `MP4`, file sizes, and command names `/start`) remain untouched.
- Numbers are formatted using standard `Intl.NumberFormat('fa-IR')`.
- Fluent directional isolate characters are normalized by `stripFluentIsolates` to prevent markdown rendering issues in Telegram clients.
- Background workers utilize the `localeSnapshot` persisted with each job, guaranteeing consistent language across status updates, download progress, and delivery.
