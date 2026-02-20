# Prefix Time Limit Blocker (Chromium)

Lightweight Manifest V3 extension for Chrome and Edge that applies daily time limits to:
- Domains (example: `instagram.com` -> matches `instagram.com/*` and subdomains)
- URL prefixes (example: `youtube.com/shorts` -> matches `youtube.com/shorts*` path subtree)

Limits reset daily at **12:00 AM local time**.

## Load in Chrome / Edge

1. Open extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Open extension options page and add rules.

## Notes

- `0` seconds means fully blocked.
- Tracking is efficient:
  - Uses event-driven active-tab tracking.
  - Uses lightweight visible-page heartbeats (1s) for accurate in-tab enforcement.
  - Keeps 1-minute alarm checks for day rollover safety.
  - Uses `declarativeNetRequest` dynamic rules for low-overhead blocking.
