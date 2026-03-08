# BATTLEPLAN.MD
**CODENAME:** MurkyPond
**TARGET:** Okoun.cz (Legacy Czech Message Board)
**MISSION:** Engineer a distributed, client-side failover system ("Emergency Bunker") to intercept and replace Cloudflare 502 errors with a read-only archive, live chat, and eventual post-recovery.

## 1. TECHNICAL TL;DR
Okoun.cz suffers from frequent 502 backend timeouts. Project MurkyPond bypasses the server entirely during outages using a Monorepo architecture:
1.  **The Harvester (PIKER v3.2+):** An autonomous Python/Playwright headless scraper that continuously syncs the newest posts from top public clubs to the Vault.
2.  **The Vault (Backend):** A lightweight Firebase prototype (Firestore + RTDB) transitioning to a self-hosted Dockerized stack (PostgreSQL + Node).
3.  **The Interceptor (Client-Side JS):** A cross-browser (TM/GM/Kiwi) script that monitors for 502s, halts native execution, strips the DOM, and injects a Shadow DOM Bunker UI.
4.  **The Restorer (Reverse-Sync):** Once the 502 clears, PIKER harvests the emergency chat logs and injects them back into the live Okoun board as a permanent HTML-formatted archive post.

## 3. SKELETON ROADMAP (Updated)
* **Phase 1: Firebase & Harvester** (Piker v3.2 adapting to public scope & Firestore pushes).
* **Phase 2: The Interceptor** (DOM Hijack, Universal Adapter, Shadow DOM UI).
* **Phase 3: The Handoff** (Docker & Bare Metal migration from Firebase).
* **Phase 4: The Recovery** (Piker reads chat logs and executes automated Playwright posting to live boards).
* 
