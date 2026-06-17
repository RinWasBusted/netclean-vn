# AI Agent instructions: Threads Web Cleaner & Scraper

This file is designed for AI agents working on this repository to quickly understand context, structure, and execution rules.

## Core Objective
The project aims to build a modular Chrome Extension (Manifest V3) running on `https://*.threads.net/*` to filter out specific posts/replies, highlight critical keywords, scrape post captions dynamically during infinite scrolls, and temporarily store them for viewing inside the extension popup UI.

## Context & Constraints
1. **Threads UI Structure**: Threads uses React and dynamically shifts CSS class names. Therefore, targeting elements relies on structural heuristics (`article`, `[role="article"]`, connecting line divs) rather than static class selectors. Caption extraction targets general text containers inside the post structure while excluding metadata elements like usernames, timestamps, and action buttons.
2. **Execution Timing**: Content scripts run with `"run_at": "document_idle"`.
3. **No External Dependencies**: Keep content scripts lightweight and written in plain ES6 JavaScript.
4. **Storage limits**: Scraped posts are stored as objects in `chrome.storage.local` with a rolling limit (currently 100 items) to avoid storage capacity exhaustion.

## Code Map
- **`manifest.json`**: Standard Manifest V3. Defines script injection matches and permissions.
- **`content.js`**: Core UI crawler. Monitors document changes using `MutationObserver`, parses post nodes, extracts text content, detects replies, and updates the style elements on target nodes.
- **`popup.html` & `popup.js`**: Provides the options interface to customize filtering settings. Saves preferences to `chrome.storage.local` and sends runtime configuration updates using `chrome.tabs.sendMessage`.

## Future Expansion Areas
- **Deep Scraper**: Expanding content extraction to include user handle, likes, timestamp, and media URLs.
- **Backend API**: Sending scraped data payloads to a remote server.
- **Robust UI Selectors**: Improving heuristics to differentiate posts, replies, ads, and sponsored content.
