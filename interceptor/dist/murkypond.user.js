// ==UserScript==
// @name         MurkyPond (Okoun Bunker)
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Client-side failover system for okoun.cz 502 timeouts.
// @author       hanenashi
// @match        http://*.okoun.cz/*
// @match        https://*.okoun.cz/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    const CONFIG = {
        firebaseProjectId: 'YOUR-FIREBASE-PROJECT-ID', // <-- UPDATE THIS
        defaultBoard: '12214', // Fallback club if local storage is empty
        logLevel: 3 // 0: Silent, 1: Error, 2: Info, 3: Debug
    };

    // ==========================================
    // MODULE 1: LOGGER & STORAGE
    // ==========================================
    const Log = {
        prefix: '[🌊 MurkyPond]',
        debug: (...args) => CONFIG.logLevel >= 3 && console.debug(Log.prefix, ...args),
        info:  (...args) => CONFIG.logLevel >= 2 && console.info(Log.prefix, ...args),
        error: (...args) => CONFIG.logLevel >= 1 && console.error(Log.prefix, ...args)
    };

    const Storage = {
        set: (key, val) => {
            try { typeof GM_setValue !== 'undefined' ? GM_setValue(key, val) : localStorage.setItem(`mp_${key}`, JSON.stringify(val)); } 
            catch (e) { Log.error(`Storage write failed: ${key}`, e); }
        },
        get: (key, fallback) => {
            try { return typeof GM_getValue !== 'undefined' ? GM_getValue(key, fallback) : (JSON.parse(localStorage.getItem(`mp_${key}`)) || fallback); } 
            catch (e) { return fallback; }
        }
    };

    // ==========================================
    // MODULE 2: FIREBASE ADAPTER
    // ==========================================
    class Vault {
        constructor(projectId) {
            this.restBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
            this.wsUrl = `wss://${projectId}-default-rtdb.europe-west1.firebasedatabase.app/.ws?v=5`;
        }

        async fetchArchive(clubId) {
            Log.info(`Fetching archive for club: ${clubId}`);
            try {
                // Warning: Requires Firestore security rules to allow unauthenticated reads during prototype phase
                const res = await fetch(`${this.restBase}/clubs/${clubId}/posts?orderBy=ts desc&pageSize=50`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                return (data.documents || []).map(doc => ({
                    id: doc.fields.p_id.integerValue,
                    author: doc.fields.auth.stringValue,
                    html: doc.fields.html.stringValue
                }));
            } catch (err) {
                Log.error('Archive fetch failed:', err);
                return [];
            }
        }

        connectChat(clubId, onMsg) {
            Log.info(`Connecting WS for club: ${clubId}`);
            const ws = new WebSocket(this.wsUrl);
            ws.onopen = () => {
                Log.info('WS connected.');
                ws.send(JSON.stringify({t: "d", d: {r: 1, a: "auth", b: {cred: "anonymous"}}}));
                ws.send(JSON.stringify({t: "d", d: {r: 2, a: "q", b: {p: `/chat/${clubId}`, h: ""}}}));
            };
            ws.onmessage = (e) => {
                const p = JSON.parse(e.data);
                if (p.t === 'd' && p.d.b.p) onMsg(p.d.b.d);
            };
            ws.onclose = () => setTimeout(() => this.connectChat(clubId, onMsg), 5000);
            return ws;
        }
    }

    // ==========================================
    // MODULE 3: SHADOW DOM UI
    // ==========================================
    const mountBunker = (boardId, vault) => {
        Log.info('Mounting Shadow DOM...');
        const host = document.createElement('div');
        host.id = 'murkypond-host';
        document.body.appendChild(host);
        
        const shadow = host.attachShadow({ mode: 'open' });
        
        shadow.innerHTML = `
            <style>
                :host { display: flex; flex-direction: column; height: 100vh; background: #111; color: #eee; font-family: system-ui, sans-serif; margin: 0; }
                header { background: #222; padding: 1rem; border-bottom: 2px solid #00ffcc; display: flex; justify-content: space-between; align-items: center; }
                h1 { margin: 0; font-size: 1.2rem; color: #00ffcc; }
                .status { color: #ff4444; font-weight: bold; animation: pulse 2s infinite; font-size: 0.9rem; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
                main { display: flex; flex: 1; overflow: hidden; }
                #archive { flex: 2; padding: 1rem; overflow-y: auto; border-right: 1px solid #333; }
                #chat { flex: 1; display: flex; flex-direction: column; background: #1a1a1a; min-width: 320px; }
                .post { background: #222; padding: 1rem; margin-bottom: 1rem; border-left: 3px solid #555; border-radius: 4px; }
                .post-author { color: #00ffcc; font-weight: bold; margin-bottom: 0.5rem; }
                #chat-msgs { flex: 1; padding: 1rem; overflow-y: auto; font-size: 0.9rem; }
                .sys-msg { color: #888; font-style: italic; margin-bottom: 0.5rem; }
                .chat-msg { margin-bottom: 0.5rem; }
                .chat-author { color: #ffaa00; font-weight: bold; }
                #chat-input-area { display: flex; padding: 0.5rem; background: #222; }
                input { flex: 1; padding: 0.6rem; background: #111; color: #eee; border: 1px solid #444; border-radius: 4px; }
                button { background: #00ffcc; color: #111; border: none; padding: 0.6rem 1rem; margin-left: 0.5rem; cursor: pointer; font-weight: bold; border-radius: 4px; }
                @media (max-width: 768px) { main { flex-direction: column; } #archive { border-right: none; border-bottom: 1px solid #333; } #chat { min-width: 100%; } }
            </style>
            <div style="display: flex; flex-direction: column; height: 100%;">
                <header>
                    <h1>🌊 MurkyPond // Club: ${boardId}</h1>
                    <div class="status">⚡ 502 INTERCEPTED</div>
                </header>
                <main>
                    <div id="archive"><div style="text-align:center; color:#666; padding: 2rem;">Connecting to Vault...</div></div>
                    <div id="chat">
                        <div id="chat-msgs"><div class="sys-msg">Initializing emergency comms...</div></div>
                        <div id="chat-input-area">
                            <input type="text" id="tx-input" placeholder="Broadcast..." />
                            <button id="tx-btn">TX</button>
                        </div>
                    </div>
                </main>
            </div>
        `;

        // Load Archive Data
        const archiveEl = shadow.getElementById('archive');
        vault.fetchArchive(boardId).then(posts => {
            if (posts.length === 0) {
                archiveEl.innerHTML = '<div style="text-align:center; color:#ff4444; padding: 2rem;">No archive data found for this club.</div>';
                return;
            }
            archiveEl.innerHTML = posts.map(p => `
                <div class="post">
                    <div class="post-author">${p.author} #${p.id}</div>
                    <div class="post-body">${p.html}</div>
                </div>
            `).join('');
        });

        // Initialize Chat (Read-only for now until write logic is added)
        const chatMsgs = shadow.getElementById('chat-msgs');
        if(CONFIG.firebaseProjectId !== 'YOUR-FIREBASE-PROJECT-ID') {
            vault.connectChat(boardId, (msgData) => {
                if(!msgData) return;
                // Basic render for incoming RTDB objects
                Object.values(msgData).forEach(msg => {
                    chatMsgs.innerHTML += `<div class="chat-msg"><span class="chat-author">${msg.user || 'Anon'}:</span> ${msg.text || ''}</div>`;
                });
                chatMsgs.scrollTop = chatMsgs.scrollHeight;
            });
        }
    };

    // ==========================================
    // MODULE 4: HIJACK LOGIC & LIFECYCLE
    // ==========================================
    
    // 1. Healthy State Tracking
    const trackLocation = () => {
        const params = new URLSearchParams(window.location.search);
        const bId = params.get('boardId');
        if (bId) {
            Storage.set('last_board_id', bId);
            Log.debug(`Healthy page. Tracking board: ${bId}`);
        }
    };

    // 2. Crash Detection
    const detectCrash = () => {
        const title = document.title || '';
        const bodyText = document.body ? document.body.innerText : '';
        return title.includes('502 Bad Gateway') || title.includes('504 Gateway') || bodyText.includes('cloudflare-nginx');
    };

    // 3. The Nuke
    const initiateHijack = () => {
        Log.info('💥 502 DETECTED. INITIATING HIJACK.');
        window.stop();
        document.documentElement.innerHTML = '';

        const newHead = document.createElement('head');
        newHead.innerHTML = `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><title>🌊 Bunker</title>`;
        document.documentElement.appendChild(newHead);
        document.documentElement.appendChild(document.createElement('body'));

        const targetBoard = Storage.get('last_board_id', CONFIG.defaultBoard);
        const vault = new Vault(CONFIG.firebaseProjectId);
        mountBunker(targetBoard, vault);
    };

    // 4. Execution Flow
    
    
    trackLocation();

    if (detectCrash()) {
        initiateHijack();
    } else {
        // Fallback for slower DOM loads
        document.addEventListener('DOMContentLoaded', () => {
            if (detectCrash()) initiateHijack();
        });
    }

})();
