# D&D Beyond Product Ownership

Chrome extension that shows which D&D Beyond marketplace products you don't own yet.

## Goals

- Show a clear list of unowned products, filterable by format (Digital/Physical), category, and publisher
- Cross-reference multiple ownership data sources to minimize false "not owned" results
- Stay up to date with daily caching and version-based cache busting

## Install

1. Download or clone this repo
2. `npm install`
3. Go to `chrome://extensions/` and enable Developer Mode
4. Click **Load Unpacked** and select the repo folder
5. Navigate to [marketplace.dndbeyond.com](https://marketplace.dndbeyond.com) while logged in
6. Click the extension icon to open the side panel

## Usage

- The extension syncs automatically when you visit the marketplace
- Click the extension icon to open the side panel
- Use the format toggle (Digital / Physical / All) to filter by product type
- Use the publisher toggle (Official / Third-Party / All) to filter by publisher
- Click category chips to hide/show groups (preferences persist)
- Click any product to open its marketplace page
- Hit **Refresh** to re-sync from all sources

## Documentation

- [Ownership Resolution](./ownership-resolution.md) - how products are matched, categorized, and filtered
