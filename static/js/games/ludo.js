/**
 * static/js/games/ludo.js
 * Ludo - 15x15 Classic Board Game (AI 1v1, 4P AI, Pass & Play, and Firebase RTDB Real-Time Online Multiplayer)
 */
(function () {
    'use strict';

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
    const csrftoken = getCookie('csrftoken');

    // Config passed from backend
    const cfg = window.XPY_GAME_CONFIG || {};
    const currentUser = cfg.currentUser || { id: 0, name: 'Player', avatar: '/static/images/avatars/default.png' };
    const initialRoomCode = cfg.initialRoomCode || (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();

    // Firebase RTDB Database accessor
    function getFirebaseDb() {
        let app;
        try {
            app = firebase.app('xapyx-games-app');
        } catch (e) {
            app = firebase.initializeApp({
                databaseURL: 'https://xapyx-chat-default-rtdb.firebaseio.com'
            }, 'xapyx-games-app');
        }
        return firebase.database(app);
    }

    const canvas = document.getElementById('ludoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const arenaContainer = document.getElementById('ludoArenaContainer');

    const GRID = 15;
    const SIZE = 600;
    const C = SIZE / GRID; // 40px per tile
    canvas.width = SIZE;
    canvas.height = SIZE;

    // Audio effects
    let audioCtx = null;
    let soundEnabled = localStorage.getItem('ludo_sound') !== 'false';
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playTone(freq, dur, type = 'sine') {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ac.currentTime);
            gain.gain.setValueAtTime(0.12, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
            osc.start();
            osc.stop(ac.currentTime + dur + 0.02);
        } catch (e) {}
    }

    // Floating Toast Notification
    function showFloatingToast(message, title = 'Arcade', icon = '\uD83C\uDFAE') {
        let container = document.getElementById('gameToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'gameToastContainer';
            container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'game-floating-toast';
        toast.style.cssText = 'background:rgba(15,23,42,0.95);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:12px 18px;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,0.5);font-size:0.875rem;display:flex;align-items:center;gap:12px;pointer-events:auto;min-width:280px;max-width:380px;animation:slideInUp 0.3s ease;backdrop-filter:blur(8px);';
        toast.innerHTML = `
            <div style="font-size:1.6rem;line-height:1;">${icon}</div>
            <div style="flex:1;">
                <div style="font-weight:700;font-size:0.85rem;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;">${title}</div>
                <div style="color:#e2e8f0;margin-top:2px;">${message}</div>
            </div>
            <button type="button" style="background:none;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;padding:0;line-height:1;" aria-label="Close">&times;</button>
        `;

        toast.querySelector('button').addEventListener('click', () => {
            toast.remove();
        });

        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(10px)';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }
        }, 4500);
    }

    // Players: Red (Top-Left), Green (Top-Right), Yellow (Bottom-Right), Blue (Bottom-Left)
    const PLAYERS = ['red', 'green', 'yellow', 'blue'];
    const PLAYER_COLORS = {
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6'
    };

    // 52-step perimeter track indices (r, c)
    const TRACK = [
        // Red start (6, 1) -> moves right
        [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
        // moves up into green arm
        [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
        // across top
        [0, 7], [0, 8],
        // down yellow left arm
        [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
        // right into yellow track
        [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
        // across right edge
        [7, 14], [8, 14],
        // left along blue arm
        [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
        // down into blue bottom
        [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
        // across bottom
        [14, 7], [14, 6],
        // up along red left
        [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
        // left into red start
        [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
        // across left edge
        [7, 0], [6, 0]
    ];

    // Player track offsets
    const START_OFFSET = {
        red: 0,
        green: 13,
        yellow: 26,
        blue: 39
    };

    // Home paths (5 tiles before center)
    const HOME_PATHS = {
        red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
        green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
        yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
        blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]
    };

    // Base coordinates for 4 tokens (r, c)
    const BASE_POSITIONS = {
        red: [[2, 2], [2, 4], [4, 2], [4, 4]],
        green: [[2, 11], [2, 13], [4, 11], [4, 13]],
        yellow: [[11, 11], [11, 13], [13, 11], [13, 13]],
        blue: [[11, 2], [11, 4], [13, 2], [13, 4]]
    };

    // Safe squares (Stars)
    const SAFE_SQUARES = [
        [6, 1], [2, 6], [1, 8], [6, 12], [8, 13], [12, 8], [13, 6], [8, 2]
    ];

    // Game state
    let mode = '1v1'; // '1v1' | '4p' | 'pass_play' | 'online'
    let activePlayers = ['red', 'yellow'];
    let currentTurnIndex = 0;
    let diceValue = null;
    let isRolling = false;
    let mustMoveToken = false;
    let isGameOver = false;

    // Tokens: { color: [{ color, id, step }] }
    let tokens = {};

    // Online Multiplayer State
    let currentRoom = null;
    let currentRoomRef = null;
    let currentRoomState = null;
    let myColor = null; // 'red' | 'yellow' | 'spectator'

    // DOM Elements
    const diceBox = document.getElementById('ludoDiceBox');
    const turnDot = document.getElementById('ludoTurnDot');
    const turnName = document.getElementById('ludoTurnName');
    const hintText = document.getElementById('ludoHintText');
    const homeCountEl = document.getElementById('ludoHomeCount');
    const diceValEl = document.getElementById('ludoDiceVal');
    const gameOverOverlay = document.getElementById('ludoGameOverOverlay');
    const winnerText = document.getElementById('ludoWinnerText');
    const subText = document.getElementById('ludoSubText');
    const playAgainBtn = document.getElementById('ludoPlayAgainBtn');
    const restartHeaderBtn = document.getElementById('ludoRestartHeaderBtn');
    const soundBtn = document.getElementById('ludoSoundBtn');
    const soundIcon = document.getElementById('ludoSoundIcon');
    const fullscreenBtn = document.getElementById('ludoFullscreenBtn');
    const fullscreenIcon = document.getElementById('ludoFullscreenIcon');

    // Modes & Online Lobby DOM Elements
    const btnMode1v1 = document.getElementById('btnMode1v1');
    const btnMode4p = document.getElementById('btnMode4p');
    const btnModePassPlay = document.getElementById('btnModePassPlay');
    const btnModeOnline = document.getElementById('btnModeOnline');

    const onlineLobbyEl = document.getElementById('ludoOnlineLobby');
    const btnCreateRoom = document.getElementById('btnLudoCreateRoom');
    const btnJoinRoom = document.getElementById('btnLudoJoinRoom');
    const inputRoomCode = document.getElementById('inputLudoRoomCode');
    const roomInfoPill = document.getElementById('ludoRoomInfo');
    const pillRoomCode = document.getElementById('pillLudoRoomCode');
    const valRoomCode = document.getElementById('valLudoRoomCode');
    const valLudoRed = document.getElementById('valLudoRed');
    const valLudoYellow = document.getElementById('valLudoYellow');
    const pillMyColor = document.getElementById('pillLudoMyColor');

    // Share & Invite Buttons
    const btnShareWhatsApp = document.getElementById('btnLudoShareWhatsApp');
    const btnCopyLink = document.getElementById('btnLudoCopyLink');
    const btnInviteFriends = document.getElementById('btnLudoInviteFriends');
    const btnNativeShare = document.getElementById('btnLudoNativeShare');

    const DICE_ICONS = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];

    function initGame() {
        if (mode === '1v1' || mode === 'online') activePlayers = ['red', 'yellow'];
        else activePlayers = ['red', 'green', 'yellow', 'blue'];

        tokens = {};
        for (let p of activePlayers) {
            tokens[p] = [
                { color: p, id: 0, step: -1 },
                { color: p, id: 1, step: -1 },
                { color: p, id: 2, step: -1 },
                { color: p, id: 3, step: -1 }
            ];
        }

        currentTurnIndex = 0;
        diceValue = null;
        isRolling = false;
        mustMoveToken = false;
        isGameOver = false;

        if (diceBox) diceBox.textContent = '\uD83C\uDFB2';
        updateTurnHUD();
        renderBoard();
        if (gameOverOverlay) gameOverOverlay.style.display = 'none';
    }

    function currentTurn() {
        return activePlayers[currentTurnIndex];
    }

    function isHumanTurn() {
        if (mode === 'online') {
            return currentTurn() === myColor;
        }
        if (mode === 'pass_play') return true;
        return currentTurn() === 'red';
    }

    function updateTurnHUD() {
        const p = currentTurn();
        const color = PLAYER_COLORS[p] || '#ffffff';
        if (turnDot) {
            turnDot.style.color = color;
            turnDot.style.background = color;
        }
        if (turnName) {
            turnName.style.color = color;
            let label;
            if (mode === 'online') {
                const isMe = (p === myColor);
                label = isMe ? `${p.toUpperCase()} (You)` : `${p.toUpperCase()} (Opponent)`;
            } else if (mode === 'pass_play') {
                label = `${p.toUpperCase()}`;
            } else {
                label = isHumanTurn() ? `${p.toUpperCase()} (You)` : `${p.toUpperCase()} (AI)`;
            }
            turnName.textContent = `${label} Turn`;
        }
        if (hintText) {
            if (isGameOver) {
                hintText.textContent = 'Game Over';
            } else if (isRolling) {
                hintText.textContent = 'Rolling...';
            } else if (mustMoveToken) {
                hintText.textContent = isHumanTurn() ? 'Select a token to move' : 'Waiting for move...';
            } else {
                hintText.textContent = isHumanTurn() ? 'Click dice to roll' : (mode === 'online' ? "Opponent's turn to roll" : 'AI thinking...');
            }
        }

        // Count home tokens for Red (or myColor in online mode)
        const trackColor = (mode === 'online' && myColor && myColor !== 'spectator') ? myColor : 'red';
        const homeCount = (tokens[trackColor] || []).filter(t => t.step === 56).length;
        if (homeCountEl) homeCountEl.textContent = `${homeCount} / 4`;
        if (diceValEl) diceValEl.textContent = diceValue ? diceValue : '-';
    }

    function getTokenCoordinates(token) {
        if (token.step === -1) {
            // In base
            const basePos = BASE_POSITIONS[token.color][token.id];
            return { x: basePos[1] * C, y: basePos[0] * C };
        }
        if (token.step === 56) {
            // Center triangle home
            return { x: 7.5 * C, y: 7.5 * C };
        }
        if (token.step >= 51 && token.step <= 55) {
            // Home path
            const homeIdx = token.step - 51;
            const cell = HOME_PATHS[token.color][homeIdx];
            return { x: (cell[1] + 0.5) * C, y: (cell[0] + 0.5) * C };
        }
        // Main track
        const trackIdx = (START_OFFSET[token.color] + token.step) % TRACK.length;
        const cell = TRACK[trackIdx];
        return { x: (cell[1] + 0.5) * C, y: (cell[0] + 0.5) * C };
    }

    function getMovableTokens(color, roll) {
        const list = tokens[color] || [];
        return list.filter(t => {
            if (t.step === 56) return false; // already home
            if (t.step === -1) return roll === 6; // can leave base only on 6
            return t.step + roll <= 56;
        });
    }

    async function saveScoreToApi(score) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'ludo',
                    score: score,
                    winner: 'red'
                })
            });
        } catch (e) {}
    }

    function checkWin(color) {
        const allHome = (tokens[color] || []).every(t => t.step === 56);
        if (allHome) {
            isGameOver = true;
            playTone(660, 0.4, 'triangle');
            if (winnerText) {
                winnerText.textContent = `${color.toUpperCase()} Wins!`;
                winnerText.style.color = PLAYER_COLORS[color];
            }
            if (subText) subText.textContent = 'All 4 tokens reached the home triangle!';
            if (gameOverOverlay) gameOverOverlay.style.display = 'flex';

            if (mode !== 'online' && color === 'red') {
                saveScoreToApi(500);
            }
            return true;
        }
        return false;
    }

    // ==========================================
    // DICE ROLLING & LOCAL TURN LOGIC
    // ==========================================
    function handleRollDice() {
        if (isRolling || mustMoveToken || isGameOver) return;
        if (!isHumanTurn()) return;

        if (mode === 'online') {
            handleOnlineDiceRoll();
            return;
        }

        isRolling = true;
        playTone(320, 0.08, 'square');
        if (diceBox) diceBox.classList.add('rolling');

        setTimeout(() => {
            if (diceBox) diceBox.classList.remove('rolling');
            diceValue = Math.floor(Math.random() * 6) + 1;
            if (diceBox) diceBox.textContent = DICE_ICONS[diceValue - 1];
            isRolling = false;

            const movable = getMovableTokens(currentTurn(), diceValue);

            if (movable.length === 0) {
                mustMoveToken = false;
                nextTurn();
            } else if (movable.length === 1 && !isHumanTurn()) {
                moveToken(movable[0], diceValue);
            } else if (movable.length === 1 && isHumanTurn() && movable[0].step === -1) {
                moveToken(movable[0], diceValue);
            } else {
                mustMoveToken = true;
                updateTurnHUD();
                renderBoard();

                if (!isHumanTurn()) {
                    setTimeout(stepAiTokenChoice, 600);
                }
            }
        }, 350);
    }

    function moveToken(token, roll) {
        mustMoveToken = false;
        let bonusRoll = (roll === 6);

        if (token.step === -1) {
            token.step = 0; // step onto track start
            playTone(480, 0.1, 'sine');
        } else {
            token.step += roll;
            playTone(400 + token.step * 6, 0.08, 'sine');
        }

        // Check capture on main track
        if (token.step >= 0 && token.step <= 50) {
            const trackIdx = (START_OFFSET[token.color] + token.step) % TRACK.length;
            const cell = TRACK[trackIdx];
            const isSafe = SAFE_SQUARES.some(sq => sq[0] === cell[0] && sq[1] === cell[1]);

            if (!isSafe) {
                for (let otherPlayer of activePlayers) {
                    if (otherPlayer === token.color) continue;
                    for (let otherTok of tokens[otherPlayer]) {
                        if (otherTok.step >= 0 && otherTok.step <= 50) {
                            const oIdx = (START_OFFSET[otherTok.color] + otherTok.step) % TRACK.length;
                            if (oIdx === trackIdx) {
                                otherTok.step = -1;
                                bonusRoll = true;
                                playTone(220, 0.25, 'sawtooth');
                            }
                        }
                    }
                }
            }
        }

        renderBoard();

        if (checkWin(token.color)) return;

        if (bonusRoll) {
            playTone(700, 0.12, 'sine');
            updateTurnHUD();
            if (!isHumanTurn()) {
                setTimeout(handleRollDice, 700);
            }
        } else {
            nextTurn();
        }
    }

    function nextTurn() {
        currentTurnIndex = (currentTurnIndex + 1) % activePlayers.length;
        diceValue = null;
        if (diceBox) diceBox.textContent = '\uD83C\uDFB2';
        updateTurnHUD();
        renderBoard();

        if (!isHumanTurn()) {
            setTimeout(handleRollDice, 650);
        }
    }

    // AI logic: Prioritize cuts, then entering home, then exiting base on 6
    function stepAiTokenChoice() {
        if (!mustMoveToken || isGameOver) return;
        const color = currentTurn();
        const movable = getMovableTokens(color, diceValue);
        if (movable.length === 0) {
            nextTurn();
            return;
        }

        let best = movable[0];
        let bestScore = -1;

        for (let tok of movable) {
            let tokScore = tok.step; // prefer advancing forward
            if (tok.step === -1 && diceValue === 6) tokScore = 25; // exit base high priority
            if (tok.step + diceValue === 56) tokScore = 50; // reach home high priority
            best = tokScore > bestScore ? tok : best;
            bestScore = Math.max(bestScore, tokScore);
        }

        moveToken(best, diceValue);
    }

    // ==========================================
    // FIREBASE RTDB REAL-TIME ONLINE MULTIPLAYER
    // ==========================================
    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let res = 'XPY';
        for (let i = 0; i < 3; i++) {
            res += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return res;
    }

    function getDirectJoinUrl(roomCode) {
        return `${window.location.origin}/games/ludo/?room=${encodeURIComponent(roomCode)}`;
    }

    function updateUrlRoomCode(code) {
        if (!code) return;
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        url.searchParams.set('game', 'ludo');
        window.history.replaceState({}, '', url.toString());
    }

    function detachFirebaseRoom() {
        if (currentRoomRef) {
            currentRoomRef.off();
            currentRoomRef = null;
        }
    }

    function copyToClipboard(text, successMessage = 'Copied to clipboard!') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showFloatingToast(successMessage, 'Copied', '\uD83D\uDCCB');
            }).catch(() => {
                fallbackCopy(text, successMessage);
            });
        } else {
            fallbackCopy(text, successMessage);
        }
    }

    function fallbackCopy(text, successMessage) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showFloatingToast(successMessage, 'Copied', '\uD83D\uDCCB');
        } catch (e) {
            prompt('Copy this URL/code manually:', text);
        }
        document.body.removeChild(textArea);
    }

    async function createOnlineRoom() {
        detachFirebaseRoom();
        const db = getFirebaseDb();
        const code = generateRoomCode();
        currentRoom = code;
        myColor = 'red';
        activePlayers = ['red', 'yellow'];

        const initialTokens = {
            red: [
                { color: 'red', id: 0, step: -1 },
                { color: 'red', id: 1, step: -1 },
                { color: 'red', id: 2, step: -1 },
                { color: 'red', id: 3, step: -1 }
            ],
            yellow: [
                { color: 'yellow', id: 0, step: -1 },
                { color: 'yellow', id: 1, step: -1 },
                { color: 'yellow', id: 2, step: -1 },
                { color: 'yellow', id: 3, step: -1 }
            ]
        };

        const roomData = {
            room_code: code,
            game_type: 'ludo',
            host_id: currentUser.id,
            status: 'waiting',
            created_at: firebase.database.ServerValue.TIMESTAMP,
            players: {
                red: {
                    id: currentUser.id,
                    name: currentUser.name,
                    avatar: currentUser.avatar,
                    online: true
                },
                yellow: null
            },
            turn: 'red',
            dice_value: null,
            must_move_token: false,
            tokens: initialTokens,
            winner: null
        };

        currentRoomRef = db.ref('/games/ludo/' + code);
        await currentRoomRef.set(roomData);

        // Disconnect handler
        currentRoomRef.child('players/red/online').onDisconnect().set(false);

        attachFirebaseListener();
        updateUrlRoomCode(code);
        showFloatingToast(`Room ${code} created! Share the code or invite your friend.`, 'Room Created', '\uD83C\uDFB2');
    }

    async function joinOnlineRoom(code) {
        detachFirebaseRoom();
        code = (code || '').trim().toUpperCase();
        if (!code || code.length < 4) {
            alert('Please enter a valid room code.');
            return;
        }

        const db = getFirebaseDb();
        currentRoom = code;
        currentRoomRef = db.ref('/games/ludo/' + code);

        const snap = await currentRoomRef.once('value');
        if (!snap.exists()) {
            alert(`Room "${code}" not found or has expired.`);
            currentRoom = null;
            currentRoomRef = null;
            return;
        }

        const data = snap.val();
        const pRed = data.players ? data.players.red : null;
        const pYellow = data.players ? data.players.yellow : null;

        if (pRed && pRed.id === currentUser.id) {
            myColor = 'red';
            currentRoomRef.child('players/red/online').set(true);
            currentRoomRef.child('players/red/online').onDisconnect().set(false);
        } else if (pYellow && pYellow.id === currentUser.id) {
            myColor = 'yellow';
            currentRoomRef.child('players/yellow/online').set(true);
            currentRoomRef.child('players/yellow/online').onDisconnect().set(false);
        } else if (!pYellow) {
            // Join as Yellow
            myColor = 'yellow';
            await currentRoomRef.child('players/yellow').set({
                id: currentUser.id,
                name: currentUser.name,
                avatar: currentUser.avatar,
                online: true
            });
            await currentRoomRef.child('status').set('playing');
            currentRoomRef.child('players/yellow/online').onDisconnect().set(false);
            showFloatingToast(`Joined room ${code}! Match is live!`, 'Match Started', '\u2694\uFE0F');
        } else {
            myColor = 'spectator';
            showFloatingToast(`Room is full. Spectating match.`, 'Spectating', '\uD83D\uDC40');
        }

        attachFirebaseListener();
        updateUrlRoomCode(code);
    }

    function attachFirebaseListener() {
        if (!currentRoomRef) return;
        currentRoomRef.on('value', snapshot => {
            if (!snapshot.exists()) {
                if (hintText) hintText.textContent = 'Room has been closed.';
                return;
            }
            const room = snapshot.val();
            renderFirebaseState(room);
        });
    }

    function renderFirebaseState(room) {
        currentRoomState = room;
        activePlayers = ['red', 'yellow'];

        // Sync Tokens
        if (room.tokens) {
            tokens['red'] = room.tokens.red ? Object.values(room.tokens.red) : [];
            tokens['yellow'] = room.tokens.yellow ? Object.values(room.tokens.yellow) : [];
        }

        // Sync turn & dice
        const turnColor = room.turn || 'red';
        currentTurnIndex = (turnColor === 'red') ? 0 : 1;
        diceValue = room.dice_value || null;
        mustMoveToken = Boolean(room.must_move_token);
        isGameOver = Boolean(room.winner);

        // Update Dice Box visual
        if (diceBox) {
            if (diceValue) {
                diceBox.textContent = DICE_ICONS[diceValue - 1];
            } else {
                diceBox.textContent = '\uD83C\uDFB2';
            }
        }

        // Update UI Pill
        if (roomInfoPill) {
            roomInfoPill.style.display = 'block';
            if (valRoomCode) valRoomCode.textContent = room.room_code || currentRoom;

            const pRed = room.players ? room.players.red : null;
            const pYellow = room.players ? room.players.yellow : null;

            if (valLudoRed) {
                valLudoRed.textContent = `Red: ${pRed ? pRed.name : 'Waiting...'}`;
                valLudoRed.className = `fw-bold ${pRed && pRed.online ? 'text-danger' : 'text-muted'}`;
            }
            if (valLudoYellow) {
                valLudoYellow.textContent = `Yellow: ${pYellow ? pYellow.name : 'Waiting...'}`;
                valLudoYellow.className = `fw-bold ${pYellow && pYellow.online ? 'text-warning' : 'text-muted'}`;
            }

            if (pillMyColor) {
                if (myColor === 'red') {
                    pillMyColor.className = 'badge bg-danger';
                    pillMyColor.textContent = 'You: Red';
                } else if (myColor === 'yellow') {
                    pillMyColor.className = 'badge bg-warning text-dark';
                    pillMyColor.textContent = 'You: Yellow';
                } else {
                    pillMyColor.className = 'badge bg-secondary';
                    pillMyColor.textContent = 'Spectator';
                }
            }
        }

        // Handle Winner Overlay
        if (room.winner) {
            playTone(660, 0.4, 'triangle');
            if (winnerText) {
                winnerText.textContent = `${room.winner.toUpperCase()} Wins!`;
                winnerText.style.color = PLAYER_COLORS[room.winner];
            }
            if (subText) subText.textContent = (room.winner === myColor) ? 'Congratulations! You won the online match!' : 'Opponent completed all tokens home!';
            if (gameOverOverlay) gameOverOverlay.style.display = 'flex';
        } else {
            if (gameOverOverlay) gameOverOverlay.style.display = 'none';
        }

        updateTurnHUD();
        renderBoard();
    }

    function handleOnlineDiceRoll() {
        if (!currentRoomRef || !currentRoomState) return;
        if (currentRoomState.status === 'waiting') {
            showFloatingToast('Waiting for second player to join...', 'Waiting', '\u23F3');
            return;
        }
        if (currentRoomState.turn !== myColor) {
            showFloatingToast("Wait for opponent's turn!", 'Turn Alert', '\u23F3');
            return;
        }
        if (currentRoomState.must_move_token) {
            showFloatingToast('Please select a token to move first.', 'Move Token', '\uD83C\uDFAF');
            return;
        }

        isRolling = true;
        playTone(320, 0.08, 'square');
        if (diceBox) diceBox.classList.add('rolling');

        setTimeout(() => {
            if (diceBox) diceBox.classList.remove('rolling');
            isRolling = false;
            const rolled = Math.floor(Math.random() * 6) + 1;
            diceValue = rolled;
            if (diceBox) diceBox.textContent = DICE_ICONS[rolled - 1];

            const movable = getMovableTokens(myColor, rolled);

            if (movable.length === 0) {
                // No move possible -> pass turn to opponent
                const nextTurnColor = (myColor === 'red') ? 'yellow' : 'red';
                currentRoomRef.update({
                    dice_value: rolled,
                    must_move_token: false,
                    turn: nextTurnColor
                });
                showFloatingToast(`Rolled a ${rolled}. No moves possible!`, 'Turn Passed', '\u23E9');
            } else if (movable.length === 1 && movable[0].step === -1) {
                // Auto exit base on 6
                executeOnlineTokenMove(movable[0], rolled);
            } else if (movable.length === 1) {
                // Single available move -> auto execute
                executeOnlineTokenMove(movable[0], rolled);
            } else {
                // Multiple choices -> player selects token
                currentRoomRef.update({
                    dice_value: rolled,
                    must_move_token: true
                });
            }
        }, 350);
    }

    function executeOnlineTokenMove(token, roll) {
        if (!currentRoomRef || !currentRoomState) return;
        const color = myColor;
        let bonusRoll = (roll === 6);

        // Clone current tokens
        const updatedTokens = {
            red: (tokens['red'] || []).map(t => ({ ...t })),
            yellow: (tokens['yellow'] || []).map(t => ({ ...t }))
        };

        const targetTok = updatedTokens[color].find(t => t.id === token.id);
        if (!targetTok) return;

        if (targetTok.step === -1) {
            targetTok.step = 0;
            playTone(480, 0.1, 'sine');
        } else {
            targetTok.step += roll;
            playTone(400 + targetTok.step * 6, 0.08, 'sine');
        }

        // Check capture on main track
        if (targetTok.step >= 0 && targetTok.step <= 50) {
            const trackIdx = (START_OFFSET[color] + targetTok.step) % TRACK.length;
            const cell = TRACK[trackIdx];
            const isSafe = SAFE_SQUARES.some(sq => sq[0] === cell[0] && sq[1] === cell[1]);

            if (!isSafe) {
                const oppColor = (color === 'red') ? 'yellow' : 'red';
                for (let oppTok of updatedTokens[oppColor]) {
                    if (oppTok.step >= 0 && oppTok.step <= 50) {
                        const oIdx = (START_OFFSET[oppColor] + oppTok.step) % TRACK.length;
                        if (oIdx === trackIdx) {
                            oppTok.step = -1;
                            bonusRoll = true;
                            playTone(220, 0.25, 'sawtooth');
                            showFloatingToast(`Captured opponent token! Bonus roll awarded!`, 'Capture!', '\uD83D\uDCA5');
                        }
                    }
                }
            }
        }

        // Check win
        const allHome = updatedTokens[color].every(t => t.step === 56);
        let winnerVal = null;
        if (allHome) {
            winnerVal = color;
            saveScoreToApi(500);
        }

        // Turn advance or bonus roll
        let nextTurnVal = color;
        if (!bonusRoll && !winnerVal) {
            nextTurnVal = (color === 'red') ? 'yellow' : 'red';
        }

        currentRoomRef.update({
            tokens: updatedTokens,
            turn: nextTurnVal,
            dice_value: bonusRoll ? roll : null,
            must_move_token: false,
            winner: winnerVal,
            status: winnerVal ? 'finished' : 'playing'
        });
    }

    // ==========================================
    // 60 FPS CANVAS BOARD DRAWING
    // ==========================================
    function renderBoard() {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, SIZE, SIZE);

        // Bases: Correct quadrant colors matching perimeter entry & home paths
        // Red = Top-Left (row 0, col 0)
        // Green = Top-Right (row 0, col 9)
        // Yellow = Bottom-Right (row 9, col 9)
        // Blue = Bottom-Left (row 9, col 0)
        drawBase(0, 0, '#ef4444', 'RED');
        drawBase(0, 9, '#10b981', 'GREEN');
        drawBase(9, 9, '#f59e0b', 'YELLOW');
        drawBase(9, 0, '#3b82f6', 'BLUE');

        // Track cells
        for (let r = 0; r < GRID; r++) {
            for (let c = 0; c < GRID; c++) {
                // Skip base quarters & center triangle
                const inRedBase = r < 6 && c < 6;
                const inGreenBase = r < 6 && c >= 9;
                const inYellowBase = r >= 9 && c >= 9;
                const inBlueBase = r >= 9 && c < 6;
                const inCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;

                if (!inRedBase && !inGreenBase && !inYellowBase && !inBlueBase && !inCenter) {
                    ctx.strokeStyle = '#334155';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(c * C, r * C, C, C);

                    // Colored start squares
                    if (r === 6 && c === 1) fillTile(r, c, '#ef4444');
                    else if (r === 1 && c === 8) fillTile(r, c, '#10b981');
                    else if (r === 8 && c === 13) fillTile(r, c, '#f59e0b');
                    else if (r === 13 && c === 6) fillTile(r, c, '#3b82f6');

                    // Colored home strips
                    if (r === 7 && c >= 1 && c <= 5) fillTile(r, c, '#ef4444');
                    if (c === 7 && r >= 1 && r <= 5) fillTile(r, c, '#10b981');
                    if (r === 7 && c >= 9 && c <= 13) fillTile(r, c, '#f59e0b');
                    if (c === 7 && r >= 9 && r <= 13) fillTile(r, c, '#3b82f6');

                    // Safe stars
                    if (SAFE_SQUARES.some(sq => sq[0] === r && sq[1] === c)) {
                        ctx.fillStyle = '#fbbf24';
                        ctx.font = '16px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('\u2605', (c + 0.5) * C, (r + 0.5) * C);
                    }
                }
            }
        }

        // Center home triangles
        drawCenterTriangles();

        // Draw all tokens
        const movable = (mustMoveToken && isHumanTurn()) ? getMovableTokens(currentTurn(), diceValue) : [];

        for (let p of activePlayers) {
            for (let t of (tokens[p] || [])) {
                const pos = getTokenCoordinates(t);
                const isSelectedMovable = movable.some(m => m.id === t.id && m.color === t.color);

                // Highlight pulse for movable tokens
                if (isSelectedMovable) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.fillStyle = PLAYER_COLORS[p] || '#ffffff';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 13, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2.5;
                ctx.stroke();

                // Inner dot
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    function fillTile(r, c, color) {
        ctx.fillStyle = color;
        ctx.fillRect(c * C + 1, r * C + 1, C - 2, C - 2);
    }

    function drawBase(rowStart, colStart, color, label) {
        ctx.fillStyle = color;
        ctx.fillRect(colStart * C, rowStart * C, 6 * C, 6 * C);

        // White inner base box
        ctx.fillStyle = '#ffffff';
        ctx.fillRect((colStart + 1) * C, (rowStart + 1) * C, 4 * C, 4 * C);

        // Base token slots (clean recessed sockets matching BASE_POSITIONS)
        const slots = [
            [(rowStart + 2) * C, (colStart + 2) * C],
            [(rowStart + 2) * C, (colStart + 4) * C],
            [(rowStart + 4) * C, (colStart + 2) * C],
            [(rowStart + 4) * C, (colStart + 4) * C]
        ];
        slots.forEach(([y, x]) => {
            ctx.fillStyle = '#f1f5f9';
            ctx.beginPath();
            ctx.arc(x, y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }

    function drawCenterTriangles() {
        const cx = 7.5 * C;
        const cy = 7.5 * C;

        // Red Left
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(6 * C, 6 * C);
        ctx.lineTo(6 * C, 9 * C);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();

        // Green Top
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(6 * C, 6 * C);
        ctx.lineTo(9 * C, 6 * C);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();

        // Yellow Right
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(9 * C, 6 * C);
        ctx.lineTo(9 * C, 9 * C);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();

        // Blue Bottom
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.moveTo(6 * C, 9 * C);
        ctx.lineTo(9 * C, 9 * C);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();
    }

    // Token click detection on canvas
    function handleCanvasClick(e) {
        if (!mustMoveToken || !isHumanTurn() || isGameOver) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = SIZE / rect.width;
        const scaleY = SIZE / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        const movable = getMovableTokens(currentTurn(), diceValue);

        for (let tok of movable) {
            const pos = getTokenCoordinates(tok);
            const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
            if (dist <= 22) {
                if (mode === 'online') {
                    executeOnlineTokenMove(tok, diceValue);
                } else {
                    moveToken(tok, diceValue);
                }
                break;
            }
        }
    }

    // ==========================================
    // EVENT LISTENERS & SETUP
    // ==========================================
    function setupEventListeners() {
        if (diceBox) diceBox.addEventListener('click', handleRollDice);
        canvas.addEventListener('click', handleCanvasClick);

        if (playAgainBtn) {
            playAgainBtn.addEventListener('click', () => {
                if (mode === 'online' && currentRoomRef) {
                    const initialTokens = {
                        red: [
                            { color: 'red', id: 0, step: -1 },
                            { color: 'red', id: 1, step: -1 },
                            { color: 'red', id: 2, step: -1 },
                            { color: 'red', id: 3, step: -1 }
                        ],
                        yellow: [
                            { color: 'yellow', id: 0, step: -1 },
                            { color: 'yellow', id: 1, step: -1 },
                            { color: 'yellow', id: 2, step: -1 },
                            { color: 'yellow', id: 3, step: -1 }
                        ]
                    };
                    currentRoomRef.update({
                        tokens: initialTokens,
                        turn: 'red',
                        dice_value: null,
                        must_move_token: false,
                        winner: null,
                        status: 'playing'
                    });
                } else {
                    initGame();
                }
            });
        }

        if (restartHeaderBtn) {
            restartHeaderBtn.addEventListener('click', () => {
                if (mode === 'online' && currentRoomRef) {
                    if (confirm('Restart online match?')) {
                        const initialTokens = {
                            red: [
                                { color: 'red', id: 0, step: -1 },
                                { color: 'red', id: 1, step: -1 },
                                { color: 'red', id: 2, step: -1 },
                                { color: 'red', id: 3, step: -1 }
                            ],
                            yellow: [
                                { color: 'yellow', id: 0, step: -1 },
                                { color: 'yellow', id: 1, step: -1 },
                                { color: 'yellow', id: 2, step: -1 },
                                { color: 'yellow', id: 3, step: -1 }
                            ]
                        };
                        currentRoomRef.update({
                            tokens: initialTokens,
                            turn: 'red',
                            dice_value: null,
                            must_move_token: false,
                            winner: null,
                            status: 'playing'
                        });
                    }
                } else {
                    initGame();
                }
            });
        }

        // Sound toggle
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('ludo_sound', soundEnabled);
                soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            });
        }

        // Fullscreen toggle
        if (fullscreenBtn && arenaContainer) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    arenaContainer.requestFullscreen().catch(() => {});
                    if (fullscreenIcon) fullscreenIcon.className = 'bi bi-fullscreen-exit';
                } else {
                    document.exitFullscreen().catch(() => {});
                    if (fullscreenIcon) fullscreenIcon.className = 'bi bi-fullscreen';
                }
            });
            document.addEventListener('fullscreenchange', () => {
                if (!document.fullscreenElement && fullscreenIcon) {
                    fullscreenIcon.className = 'bi bi-fullscreen';
                }
            });
        }

        // Mode Switching
        function setMode(m, btn) {
            mode = m;
            [btnMode1v1, btnMode4p, btnModePassPlay, btnModeOnline].forEach(b => b?.classList.remove('active'));
            btn?.classList.add('active');

            if (m === 'online') {
                if (onlineLobbyEl) onlineLobbyEl.style.display = 'block';
                if (!currentRoom) {
                    createOnlineRoom();
                }
            } else {
                if (onlineLobbyEl) onlineLobbyEl.style.display = 'none';
                detachFirebaseRoom();
                currentRoom = null;
                initGame();
            }
        }

        if (btnMode1v1) btnMode1v1.addEventListener('click', () => setMode('1v1', btnMode1v1));
        if (btnMode4p) btnMode4p.addEventListener('click', () => setMode('4p', btnMode4p));
        if (btnModePassPlay) btnModePassPlay.addEventListener('click', () => setMode('pass_play', btnModePassPlay));
        if (btnModeOnline) btnModeOnline.addEventListener('click', () => setMode('online', btnModeOnline));

        // Online Lobby Handlers
        if (btnCreateRoom) {
            btnCreateRoom.addEventListener('click', () => {
                setMode('online', btnModeOnline);
                createOnlineRoom();
            });
        }

        if (btnJoinRoom && inputRoomCode) {
            btnJoinRoom.addEventListener('click', () => {
                const code = inputRoomCode.value.trim().toUpperCase();
                if (code) {
                    setMode('online', btnModeOnline);
                    joinOnlineRoom(code);
                }
            });
            inputRoomCode.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    const code = inputRoomCode.value.trim().toUpperCase();
                    if (code) {
                        setMode('online', btnModeOnline);
                        joinOnlineRoom(code);
                    }
                }
            });
        }

        // Room code copy pill
        if (pillRoomCode) {
            pillRoomCode.addEventListener('click', () => {
                if (currentRoom) {
                    copyToClipboard(currentRoom, `Room code ${currentRoom} copied!`);
                }
            });
        }

        // Share Buttons
        if (btnShareWhatsApp) {
            btnShareWhatsApp.addEventListener('click', () => {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                const text = `Let's play Ludo on XAPYX! Join my room ${currentRoom} here: ${link}`;
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
            });
        }

        if (btnCopyLink) {
            btnCopyLink.addEventListener('click', () => {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                copyToClipboard(link, 'Direct game invite link copied to clipboard!');
            });
        }

        if (btnInviteFriends) {
            btnInviteFriends.addEventListener('click', () => {
                if (!currentRoom) {
                    showFloatingToast('Please create or join a room first.', 'No Room', '\u26A0\uFE0F');
                    return;
                }
                if (typeof window.openGameFriendsInviteModal === 'function') {
                    window.openGameFriendsInviteModal('ludo', 'Ludo', currentRoom);
                } else {
                    showFloatingToast('Friend invite modal is loading...', 'Invite', '\uD83C\uDFAE');
                }
            });
        }

        if (btnNativeShare) {
            btnNativeShare.addEventListener('click', () => {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                if (navigator.share) {
                    navigator.share({
                        title: 'XAPYX Ludo Multiplayer',
                        text: `Join my Ludo match on XAPYX Arcade! Room Code: ${currentRoom}`,
                        url: link
                    }).catch(() => {});
                } else {
                    copyToClipboard(link, 'Invite link copied to clipboard!');
                }
            });
        }
    }

    function init() {
        setupEventListeners();

        // Check for room in URL or config
        if (initialRoomCode) {
            if (btnModeOnline) {
                [btnMode1v1, btnMode4p, btnModePassPlay, btnModeOnline].forEach(b => b?.classList.remove('active'));
                btnModeOnline.classList.add('active');
            }
            if (onlineLobbyEl) onlineLobbyEl.style.display = 'block';
            mode = 'online';
            initGame();
            joinOnlineRoom(initialRoomCode);
        } else {
            initGame();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
