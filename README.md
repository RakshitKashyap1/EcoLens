# EcoLens

**EcoLens** is a Chromium-based browser extension designed to visualize the environmental impact of your digital footprint in real time. By estimating the CO₂ emissions associated with specific web activities, EcoLens raises awareness about the hidden carbon cost of the internet.

## 🌍 Features

-   **Real-time Carbon Tracking**: Automatically detects activity on supported high-traffic sites and calculates estimated CO₂ emissions.
-   **Interactive Badge**: Injects a non-intrusive, animated badge into the bottom-right of the webpage providing:
    -   CO₂ weight in grams (g).
    -   A visual impact bar comparing current usage against a high-impact benchmark (Netflix).
    -   Relatable real-world equivalents (e.g., "charging your phone 0.02%" or "driving ~150 metres").
-   **SPA Support**: Uses a `MutationObserver` to ensure the tracking badge functions correctly on Single Page Applications (SPAs) like YouTube, Google, and ChatGPT.
-   **Session Storage**: Tracks cumulative CO₂ data and site visit counts locally using `chrome.storage`.

## 📊 Supported Platforms

EcoLens currently provides specific metrics for:
-   **Google Search**: Estimates the cost of a standard query.
-   **ChatGPT**: Estimates the computational cost of an LLM interaction.
-   **Netflix**: Tracks high-bandwidth streaming impact (per hour).
-   **YouTube**: Estimates impact based on video playback (per 10 min).

## 🛠️ Technical Details

-   **Manifest V3**: Built using the latest Chrome extension standards.
-   **Vanilla JavaScript**: Core logic handled in `content.js` without external dependencies.
-   **Dynamic CSS**: Styles are injected dynamically to ensure the UI is encapsulated and doesn't conflict with site-native styling.
-   **Local Persistence**: Utilizes `chrome.storage.local` to maintain a running total of the user's carbon footprint.

## 🚀 Installation

1.  Clone this repository to your local machine.
2.  Open your browser and navigate to the Extensions page (`chrome://extensions`).
3.  Enable **Developer mode** (toggle in the top-right corner).
4.  Click **Load unpacked** and select the project directory.

## 📂 File Structure

-   `manifest.json`: Extension configuration and permissions.
-   `content.js`: Main logic for site detection, CO₂ calculation, and UI injection.
-   `popup.html`: The dashboard view for overall carbon statistics.
-   `background.js`: Service worker for background state management.

## 📄 License
MIT