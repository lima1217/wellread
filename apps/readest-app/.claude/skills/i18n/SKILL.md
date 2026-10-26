---
name: i18n
description: Extract and translate readest-app i18n strings, or add a new locale. Use when UI strings need translations (`__STRING_NOT_TRANSLATED__`) or a language is added.
---

Extract/translate i18n strings or add a new language for readest-app. Run from the app directory (either the main repo or a worktree).

## Step 0: Determine the mode

- If the user asks to **add a new language/locale**, go to **Adding a New Language** below.
- Otherwise, go to **Extracting & Translating Strings** below.

## Step 1: Determine the working directory

Use the checkout you are working in (main repo or a `pnpm worktree:new` worktree). The app directory is `<repo-root>/apps/readest-app`.

---

## Adding a New Language

When the user asks to add a new language (e.g., "add Hungarian", "add hu locale"):

### Step A1: Register the locale in two places

1. **`i18n-langs.json`** — Append the locale code to the array. Both `i18next-scanner.config.cjs` and `src/i18n/i18n.ts` import from this file, so they pick up the new entry automatically.
2. **`src/services/constants.ts`** — Add an entry to `TRANSLATED_LANGS` with the locale code and native language name (e.g., `hu: 'Magyar'`). If the locale already exists in `TRANSLATOR_LANGS`, remove the duplicate there since it will be inherited via the spread.

### Step A2: Generate the translation file

```bash
cd <app-dir>
pnpm run i18n:extract
```

This creates `public/locales/<code>/translation.json` with all keys set to `__STRING_NOT_TRANSLATED__`.

### Step A3: Translate all strings

Follow **Step 4** below to translate every `__STRING_NOT_TRANSLATED__` entry in the new locale file.

### Step A4: Verify

Follow **Step 5** below to confirm zero remaining untranslated strings for the new locale.

---

## Extracting & Translating Strings

### Step 2: Extract i18n strings

```bash
cd <app-dir>
pnpm run i18n:extract
```

This runs `i18next-scanner` which scans source files for translation keys and adds any new keys to all locale files with `__STRING_NOT_TRANSLATED__` as the placeholder value.

### Step 3: Find untranslated strings

```bash
grep -r "__STRING_NOT_TRANSLATED__" <app-dir>/public/locales/
```

If no results, report that all strings are already translated and stop.

### Step 4: Translate missing strings

For each `__STRING_NOT_TRANSLATED__` found:

1. Identify the English key (e.g., `"Hide Scrollbar"`)
2. Identify the target locale from the file path (e.g., `locales/ja/translation.json` -> Japanese)
3. Provide an accurate translation for each locale

Replace in place with `sed -i ''` (macOS) or `sed -i` (GNU). Handle all locales in one batch:

```bash
cd <app-dir>/public/locales
sed -i '' 's/"<Key>": "__STRING_NOT_TRANSLATED__"/"<Key>": "<translation>"/' <locale>/translation.json
```

### Locale reference

The canonical, complete list of supported locales lives in `i18n-langs.json` (codes only) and `TRANSLATED_LANGS` in `src/services/constants.ts` (codes → native display names). Translate every locale that appears in `i18n-langs.json`, `pt-BR` and `uz` included: if it is listed, it ships.

### Step 5: Verify

```bash
grep -r "__STRING_NOT_TRANSLATED__" <app-dir>/public/locales/
```

Confirm zero remaining untranslated strings. Report the number of keys translated and locales updated.
