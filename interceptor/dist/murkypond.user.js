// ==UserScript==
// @name         MurkyPond (Okoun Bunker)
// @namespace    http://tampermonkey.net/
// @version      0.1.6
// @description  Client-side failover system for okoun.cz 502 timeouts.
// @author       hanenashi
// @match        http://*.okoun.cz/*
// @match        https://*.okoun.cz/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    const CONFIG = {
        firebaseProjectId: 'murkypond-vault-fc61c', // Your live Vault
        defaultBoard: '12214', 
        logLevel: 3 
    };

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
    // DEV TOOLS: THE 502 TOGGLE
    // ==========================================
    const isForceMode = Storage.get('force_502', false);

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand(isForceMode ? "🟢 Disable 502 Simulation" : "🔴 Enable 502 Simulation", () => {
            Storage.set('force_502', !isForceMode);
            location.reload();
        });
    }

    window.MurkyPond = {
        toggle502: () => {
            Storage.set('force_502', !Storage.get('force_502', false));
            location.reload();
        }
    };

    // ==========================================
    // MODULE 2: FIREBASE ADAPTER
    // ==========================================
    class Vault {
        constructor(projectId) {
            this.restBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
            // Realtime Database defaults to europe-west1 if selected in EU
            this.rtdbBase = `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app`;
            this.wsUrl = `wss://${projectId}-default-rtdb.europe-west1.firebasedatabase.app/.ws?v=5`;
        }

        async fetchArchive(clubId) {
            // Clean the clubId to ensure no trailing slashes from the Regex break the path
            const cleanId = clubId.replace(/\/$/, "");
            const url = `${this.restBase}/clubs/${cleanId}/posts?orderBy=ts desc&pageSize=50`;
            
            Log.info(`[Vault] Attempting REST pull: ${url}`);
            
            try {
                const res = await fetch(url);
                if (!res.ok) {
                    Log.error(`[Vault] Server returned ${res.status}. Check if collection 'clubs/${cleanId}/posts' exists.`);
                    return [];
                }
                const data = await res.json();
                Log.debug(`[Vault] Received ${data.documents ? data.documents.length : 0} documents.`);
                
                return (data.documents || []).map(doc => ({
                    id: doc.fields.p_id.integerValue,
                    author: doc.fields.auth.stringValue,
                    html: doc.fields.html.stringValue
                }));
            } catch (err) {
                Log.error('[Vault] Fetch encountered a network error:', err);
                return [];
            }
        }

        connectChat(clubId, onMsg) {
            Log.info(`[Chat] Connecting WS for club: ${clubId}`);
            const ws = new WebSocket(this.wsUrl);
            ws.onopen = () => {
                Log.info('[Chat] WS connected successfully.');
                ws.send(JSON.stringify({t: "d", d: {r: 1, a: "auth", b: {cred: "anonymous"}}}));
                ws.send(JSON.stringify({t: "d", d: {r: 2, a: "q", b: {p: `/chat/${clubId}`, h: ""}}}));
            };
            ws.onmessage = (e) => {
                const p = JSON.parse(e.data);
                if (p.t === 'd' && p.d.b.p) {
                    Log.debug('[Chat] Incoming payload:', p.d.b.d);
                    onMsg(p.d.b.d);
                }
            };
            ws.onclose = () => {
                Log.error('[Chat] WS disconnected. Retrying in 5s...');
                setTimeout(() => this.connectChat(clubId, onMsg), 5000);
            };
            return ws;
        }

        async sendChat(clubId, user, text) {
            Log.info(`[Chat] Transmitting message...`);
            const url = `${this.rtdbBase}/chat/${clubId}.json`;
            try {
                await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify({ user, text, ts: Date.now() })
                });
                Log.info('[Chat] Transmission successful.');
            } catch (err) {
                Log.error('[Chat] Transmission failed.', err);
            }
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
                #chat-msgs { flex: 1; padding: 1rem; overflow-y: auto; font-size: 0.9rem; word-break: break-word; }
                .sys-msg { color: #888; font-style: italic; margin-bottom: 0.5rem; }
                .chat-msg { margin-bottom: 0.5rem; background: #222; padding: 0.5rem; border-radius: 4px; border-left: 2px solid #ffaa00; }
                .chat-author { color: #ffaa00; font-weight: bold; }
                #chat-input-area { display: flex; padding: 0.5rem; background: #222; }
                input { flex: 1; padding: 0.6rem; background: #111; color: #eee; border: 1px solid #444; border-radius: 4px; outline: none; }
                input:focus { border-color: #00ffcc; }
                button { background: #00ffcc; color: #111; border: none; padding: 0.6rem 1rem; margin-left: 0.5rem; cursor: pointer; font-weight: bold; border-radius: 4px; transition: background 0.2s; }
                button:active { background: #00ccaa; }
                @media (max-width: 768px) { main { flex-direction: column; } #archive { flex: 1; border-right: none; border-bottom: 1px solid #333; } #chat { flex: 1; min-width: 100%; } }
            </style>
            <div style="display: flex; flex-direction: column; height: 100%;">
                <header>
                    <h1>🌊 MurkyPond // Club: ${boardId}</h1>
                    <div class="status">⚡ 502 ${isForceMode ? '(SIMULATED)' : 'INTERCEPTED'}</div>
                </header>
                <main>
                    <div id="archive"><div style="text-align:center; color:#666; padding: 2rem;">Connecting to Vault...</div></div>
                    <div id="chat">
                        <div id="chat-msgs"><div class="sys-msg">Initializing emergency comms...</div></div>
                        <div id="chat-input-area">
                            <input type="text" id="tx-input" placeholder="Broadcast..." autocomplete="off"/>
                            <button id="tx-btn">TX</button>
                        </div>
                    </div>
                </main>
            </div>
        `;

        // 1. Fetch the Archive
        const archiveEl = shadow.getElementById('archive');
        vault.fetchArchive(boardId).then(posts => {
            if (!posts || posts.length === 0) {
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

        // 2. Initialize the Chat Engine (FORCED & DEDUPLICATED)
        const chatMsgs = shadow.getElementById('chat-msgs');
        const renderedMsgs = new Set(); // The "Bouncer" memory bank

        vault.connectChat(boardId, (msgData) => {
            if(!msgData) return;
            
            // Handle bulk sync vs individual new messages
            const messages = msgData.user ? [msgData] : Object.values(msgData);
            
            // Clear the "Initializing" system message on first payload
            if(chatMsgs.innerHTML.includes('Initializing')) chatMsgs.innerHTML = '';
            
            messages.forEach(msg => {
                if(!msg || !msg.text) return;
                
                // Create a unique fingerprint for the message
                const signature = `${msg.user}-${msg.ts || msg.text}`;
                
                // If the Bouncer has already seen this fingerprint, skip it!
                if (renderedMsgs.has(signature)) return; 
                renderedMsgs.add(signature); // Add to memory bank

                // Basic sanitization
                const safeUser = (msg.user || 'Anon').replace(/</g, "&lt;");
                const safeText = (msg.text || '').replace(/</g, "&lt;");
                
                // Insert efficiently without redrawing the whole DOM
                chatMsgs.insertAdjacentHTML('beforeend', `<div class="chat-msg"><span class="chat-author">${safeUser}:</span> ${safeText}</div>`);
            });
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        });

        // 3. Bind the Transmit Button
        const txInput = shadow.getElementById('tx-input');
        const txBtn = shadow.getElementById('tx-btn');

        const sendMessage = () => {
            const text = txInput.value.trim();
            if (!text) return;
            vault.sendChat(boardId, 'kokochan', text);
            txInput.value = '';
        };

        txBtn.addEventListener('click', sendMessage);
        txInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    };

    // ==========================================
    // MODULE 4: HIJACK LOGIC
    // ==========================================
    const extractBoardId = () => {
        // 1. Try URL parameters first (e.g., ?boardId=12214)
        const params = new URLSearchParams(window.location.search);
        if (params.get('boardId')) return params.get('boardId');

        // 2. Fallback to URL path using Regex (e.g., /boards/prezident_donald...)
        const match = window.location.pathname.match(/\/boards\/([^\/]+)/);
        if (match) return match[1]; // Returns exactly the club name
        
        return null;
    };

    const trackLocation = () => {
        const bId = extractBoardId();
        if (bId) {
            Storage.set('last_board_id', bId);
            Log.debug(`Healthy page. Tracking board: ${bId}`);
        }
    };

    const detectCrash = () => {
        if (isForceMode) return true;
        const title = document.title || '';
        const bodyText = document.body ? document.body.innerText : '';
        
        const is502Title = /502.*bad gateway/i.test(title) || /504.*gateway/i.test(title);
        const hasCFErrorDiv = !!document.getElementById('cf-error-details');
        const isCFBody = bodyText.includes('Error code 502') || bodyText.includes('cloudflare-nginx');

        return is502Title || hasCFErrorDiv || isCFBody;
    };

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

    // --- EXECUTION FLOW ---
    
    // 1. Always try to save the current location first
    trackLocation(); 

    // 2. Then check if we need to nuke the page
    if (detectCrash()) {
        initiateHijack();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (detectCrash()) initiateHijack();
        });
    }

})();
