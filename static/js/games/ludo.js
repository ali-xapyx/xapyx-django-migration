/**
 * static/js/games/ludo.js
 * Ludo - 15x15 Classic Board Game (AI 1v1, 4P AI, Pass & Play)
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
    // Red: Top-Left yard (r: 1..4, c: 1..4)
    // Green: Top-Right yard (r: 1..4, c: 10..13)
    // Yellow: Bottom-Right yard (r: 10..13, c: 10..13)
    // Blue: Bottom-Left yard (r: 10..13, c: 1..4)
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
    let mode = '1v1'; // '1v1' | '4p' | 'pass_play'
    let activePlayers = ['red', 'yellow'];
    let currentTurnIndex = 0;
    let diceValue = null;
    let isRolling = false;
    let mustMoveToken = false;
    let isGameOver = false;

    // Tokens: { color, id, step: -1 (base), 0..50 (track), 51..55 (home path), 56 (finished) }
    let tokens = {};

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

    const btnMode1v1 = document.getElementById('btnMode1v1');
    const btnMode4p = document.getElementById('btnMode4p');
    const btnModePassPlay = document.getElementById('btnModePassPlay');

    const DICE_ICONS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    function initGame() {
        if (mode === '1v1') activePlayers = ['red', 'yellow'];
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

        updateTurnHUD();
        renderBoard();
        if (gameOverOverlay) gameOverOverlay.style.display = 'none';
    }

    function currentTurn() {
        return activePlayers[currentTurnIndex];
    }

    function isHumanTurn() {
        if (mode === 'pass_play') return true;
        return currentTurn() === 'red';
    }

    function updateTurnHUD() {
        const p = currentTurn();
        const color = PLAYER_COLORS[p];
        if (turnDot) {
            turnDot.style.color = color;
            turnDot.style.background = color;
        }
        if (turnName) {
            turnName.style.color = color;
            const label = isHumanTurn() ? `${p.toUpperCase()} (You)` : `${p.toUpperCase()} (AI)`;
            turnName.textContent = `${label} Turn`;
        }
        if (hintText) {
            if (isRolling) hintText.textContent = 'Rolling...';
            else if (mustMoveToken) hintText.textContent = 'Select a token to move';
            else hintText.textContent = isHumanTurn() ? 'Click dice to roll' : 'AI thinking...';
        }

        // Count home tokens for Red
        const redHome = (tokens['red'] || []).filter(t => t.step === 56).length;
        if (homeCountEl) homeCountEl.textContent = `${redHome} / 4`;
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

            if (color === 'red') saveScoreToApi(500);
            return true;
        }
        return false;
    }

    function handleRollDice() {
        if (isRolling || mustMoveToken || isGameOver) return;
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
                // No moves possible -> next turn
                mustMoveToken = false;
                nextTurn();
            } else if (movable.length === 1 && !isHumanTurn()) {
                // AI single choice auto move
                moveToken(movable[0], diceValue);
            } else if (movable.length === 1 && isHumanTurn() && movable[0].step === -1) {
                // Auto exit base on 6
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
                                // Cut opponent token back to base!
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
        if (diceBox) diceBox.textContent = '🎲';
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

    // 60 FPS Canvas Board Drawing
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
                        ctx.fillText('★', (c + 0.5) * C, (r + 0.5) * C);
                    }
                }
            }
        }

        // Center home triangles
        drawCenterTriangles();

        // Draw all tokens
        const movable = mustMoveToken && isHumanTurn() ? getMovableTokens(currentTurn(), diceValue) : [];

        for (let p of activePlayers) {
            for (let t of tokens[p]) {
                const pos = getTokenCoordinates(t);
                const isSelectedMovable = movable.includes(t);

                // Highlight pulse for movable tokens
                if (isSelectedMovable) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 17, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.fillStyle = PLAYER_COLORS[p];
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
                moveToken(tok, diceValue);
                break;
            }
        }
    }

    function setupEventListeners() {
        if (diceBox) diceBox.addEventListener('click', handleRollDice);
        canvas.addEventListener('click', handleCanvasClick);

        if (playAgainBtn) playAgainBtn.addEventListener('click', initGame);
        if (restartHeaderBtn) restartHeaderBtn.addEventListener('click', initGame);

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

        // Modes
        function setMode(m, btn) {
            mode = m;
            [btnMode1v1, btnMode4p, btnModePassPlay].forEach(b => b?.classList.remove('active'));
            btn?.classList.add('active');
            initGame();
        }

        if (btnMode1v1) btnMode1v1.addEventListener('click', () => setMode('1v1', btnMode1v1));
        if (btnMode4p) btnMode4p.addEventListener('click', () => setMode('4p', btnMode4p));
        if (btnModePassPlay) btnModePassPlay.addEventListener('click', () => setMode('pass_play', btnModePassPlay));
    }

    function init() {
        setupEventListeners();
        initGame();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
