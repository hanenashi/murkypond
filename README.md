# 🌊 MurkyPond (Okoun.cz Emergency Bunker)

> **[🔥 INSTALL / UPDATE USERSCRIPT 🔥](https://raw.githubusercontent.com/hanenashi/murkypond/main/interceptor/dist/murkypond.user.js)** > *(Tap the link above in Chrome, Firefox, or Kiwi Browser with Tampermonkey/Violentmonkey installed)*

MurkyPond is a distributed, client-side failover system designed to intercept Cloudflare 502 backend timeouts on the legacy okoun.cz message board and replace them with a read-only archive and live emergency chat.

## Repository Architecture

This monorepo is divided into three main operational components:

```text
murkypond/
├── harvester/              # PIKER v3.2+ (Python/Playwright) - Autonomous sync engine
├── interceptor/            # The Userscript (JS) - Cross-browser 502 hijacker
│   ├── dist/               # Compiled script (murkypond.user.js)
│   └── src/                # Modular source files (adapter, ui, main logic)
├── schema/                 # Shared JSON schemas for Python and JS
├── tools/                  # Build scripts (JS bundler)
└── vault/                  # Infrastructure (Firebase rules & future Node/Docker config)
