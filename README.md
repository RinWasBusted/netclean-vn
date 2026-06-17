# Threads Web Cleaner & Scraper (netclean-vn)

A Chrome Extension specifically designed to scrape and modify the user interface of the Threads web application (`threads.net`).

## Features
- **Post Scraping & Processing**: Identifies post cards dynamically using MutationObserver as they scroll into view.
- **UI Modification**: Hides replies or highlights posts containing specified keywords.
- **Settings Dashboard (Popup)**: Simple interface to toggle configuration settings and view the current scraped post counts.
- **Chrome Storage Integration**: Saves settings and counts locally.

## Project Structure
- `manifest.json`: Configuration for the Chrome extension (v3).
- `popup.html`: The HTML layout for the extension toolbar popup.
- `popup.js`: Script driving UI toggle state and communication.
- `content.js`: Content script that runs in the context of `threads.net` to query, scrape, and modify posts.
- `icons/`: Extension icon assets.

## Getting Started
1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select this directory (`/home/thaian0609asd/Documents/Project/netclean-vn`).
5. Open `https://www.threads.net/` to see the extension in action.
