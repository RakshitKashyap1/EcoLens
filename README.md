# EcoLens

EcoLens is a Manifest V3 Chrome extension that makes the carbon cost of everyday browsing visible in real time. It tracks supported searches, AI prompts, and streaming sessions, then turns that activity into estimated CO2 emissions using network transfer, device energy use, and grid carbon intensity.

## What It Does

- Tracks emissions on supported sites while you browse.
- Shows an in-page badge with live CO2 estimates, grid intensity, data transferred, and familiar real-world equivalents.
- Detects AI model variants on supported assistants and keeps a model-level emissions breakdown.
- Stores daily totals, per-site totals, charts, and recent activity locally in `chrome.storage.local`.
- Offers an extension popup with summaries, trend charts, budgets, and personalized reduction tips.
- Optionally syncs recent stats to a backend for signed-in experiences like social features, challenges, and leaderboards.

## Supported Platforms

EcoLens currently injects tracking on:

- Google Search
- ChatGPT
- Claude
- Gemini
- Netflix
- YouTube

## Core Features

### Real-time tracking

- Google searches are counted per visit/query.
- ChatGPT, Claude, and Gemini prompts are tracked when you submit a message.
- Netflix and YouTube sessions update continuously while media is visible and playing in the tab.

### Grid-aware estimates

- Uses live carbon intensity from Electricity Maps when configured.
- Falls back to regional averages based on detected country.
- Stores the active grid zone and source so the popup can show whether data is live or fallback.

### Data + device energy model

- Measures transferred bytes with `chrome.webRequest` when available.
- Falls back to site-specific baseline energy estimates when transfer data is too small or unavailable.
- Includes device energy based on either battery-derived heuristics or a user-selected device type:
  `phone`, `laptop`, `desktop`, or `tv`.

### AI model detection

EcoLens attempts heuristic model detection for:

- ChatGPT: `GPT-3.5`, `GPT-4o mini`, `GPT-4.1 mini`, `o4-mini`, `GPT-4o`, `GPT-4.1`, `o3`
- Claude: `Haiku`, `Sonnet`, `Opus`
- Gemini: `Flash`, `Pro`, `Ultra`, `Gemini 2.5 Pro`

If no model can be identified, EcoLens falls back to a provider default estimate.

### In-page badge

The injected badge shows:

- Current CO2 estimate
- Measured vs estimated mode
- Detected AI model, when applicable
- Grid intensity and region
- Data transferred
- Streaming watch time, for video sites
- A comparison bar against a Netflix-per-hour benchmark
- A quick "that's like..." equivalence

### Popup dashboard

The popup includes:

- Today's total emissions
- Per-platform breakdown
- Model breakdown
- Greener suggestions based on recent usage
- 7-day and 30-day charts
- Device selector
- Account naming
- Reset-today control

### Daily budgets and alerts

- Set a daily CO2 budget in grams.
- Enable warning notifications at 80% of budget.
- Receive a second notification when the budget is reached.

### Local history and retention

- Daily totals are retained for 180 days.
- Activity events are retained for 90 days.
- Daily totals reset automatically on a new day.

### SPA-friendly behavior

- Handles route changes on single-page apps with a `MutationObserver`.
- Re-initializes tracking when supported apps change URLs without a full reload.

### Optional cloud sync

If a backend is configured, users can:

- Sign in with email code auth
- Sync the last 30 days of daily totals
- Sync recent activity events
- Refresh profile details
- Keep local-first tracking with background sync every 30 minutes

## How It Works

At a high level, EcoLens combines:

- Site-specific baseline energy estimates
- Network transfer volume
- Device energy usage
- Carbon intensity of the current electricity grid

The extension then converts energy use into grams of CO2 and stores the result per site, per day, and per AI model where available.

## Project Structure

- `manifest.json`: extension manifest, permissions, content script targets
- `content.js`: site detection, AI model detection, badge UI, event tracking
- `background.js`: grid lookup, storage maintenance, budget alerts, cloud sync, byte counting
- `popup.html`: popup UI markup and styles
- `popup.js`: popup rendering, charts, settings, auth controls
- `shared.js`: shared account, sync, and date helpers
- `auth.js`: auth state helpers
- `api.js`: backend API client for auth and sync
- `config.example.js`: sample config for external services
- `config.js`: local config file loaded by the extension

## Installation

1. Clone this repository.
2. Copy `config.example.js` to `config.js`.
3. Fill in any keys you want to use.
4. Open `chrome://extensions`.
5. Enable Developer mode.
6. Click Load unpacked.
7. Select the project folder.

There is no build step. This extension runs directly from the source files.

## Configuration

Create or update `config.js` with:

```js
globalThis.CONFIG = {
  ELECTRICITY_MAPS_KEY: "YOUR_ELECTRICITY_MAPS_KEY",
  API_BASE_URL: "https://YOUR_PROJECT.supabase.co/functions/v1/ecolens",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};
```

### `ELECTRICITY_MAPS_KEY`

Optional. If omitted, EcoLens uses regional fallback carbon intensity values instead of live grid data.

### `API_BASE_URL`

Optional. Required only if you want cloud sync, sign-in, and backend-powered social features.

### `SUPABASE_ANON_KEY`

Optional in the current client logic, but typically needed for authenticated backend calls when using Supabase-backed endpoints.

## Permissions Used

- `storage`: save totals, settings, auth state, sync metadata
- `alarms`: refresh grid data, maintain daily history, periodic sync
- `webRequest`: estimate transfer size for tracked browsing activity
- `notifications`: budget alerts

## Notes and Limitations

- Emissions are estimates, not direct measurements.
- AI model detection is heuristic and depends on visible UI labels.
- Streaming estimates are strongest on the specifically supported watch pages.
- Cloud sync UI is present, but backend routes must exist and match the expected API contract.
- The extension targets Chromium-based browsers that support Manifest V3.

## License

MIT
