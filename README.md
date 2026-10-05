# D&D Beyond Product Ownership

Chrome extension that shows which D&D Beyond marketplace products you don't own yet.

## Goals

- Show a clear list of unowned products, filterable by format (Digital/Physical), category, and publisher
- Treat starter packs whose listed source books are already owned as covered, while keeping them revealable
- Cross-reference multiple ownership data sources to minimize false "not owned" results
- Stay up to date with daily caching and version-based cache busting

## Install

1. Download or clone this repo
2. Run `npm install`
3. Run `npm run build`
4. Go to `chrome://extensions/` and enable Developer Mode
5. Click **Load Unpacked** and select the repo folder
6. Navigate to [marketplace.dndbeyond.com](https://marketplace.dndbeyond.com) while logged in
7. Click the extension icon to open the side panel

## Usage

- The extension syncs automatically when you visit the marketplace
- Click the extension icon to open the side panel
- Use **First-party digital** for the ownership-audit view
- Open the filter menu for format, publisher, and category controls
- Expand or collapse category sections individually or all at once
- Audit totals continue to count hidden and dismissed products
- Click any product to open its marketplace page
- Hit **Refresh** to re-sync from all sources

## Development

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

The side panel uses Vue 3, TypeScript, and Vite. Pure ownership rules use Node's test runner, and side-panel behavior uses Vitest with jsdom. Lefthook runs the full local quality gate before commits.

## Documentation

- [Architecture](./docs/architecture.md) - data flow, fetch patterns, pipeline stages, storage schema
- [Ownership Resolution](./docs/ownership-resolution.md) - how products are matched, categorized, and filtered
