/**
 * static/js/games/checkers.js
 * Checkers - 8x8 Interactive Board with AI, Multi-Jumps & King Crowning
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

    const boardFrame = document.getElementById('checkersBoardFrame');
    if (!boardFrame) return;
    const arenaContainer = document.getElementById('checkersArenaContainer');

    // Audio effects
    let audioCtx = null;
    let soundEnabled = localStorage.getItem('checkers_sound') !== 'false';
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playMoveTone(isCapture = false, isKing = false) {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);

            let freq = 360;
            let duration = 0.08;
            if (isKing) { freq = 740; duration = 0.2; }
            else if (isCapture) { freq = 520; duration = 0.12; }

            osc.type = isKing ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, ac.currentTime);
            gain.gain.setValueAtTime(0.12, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
            osc.start();
            osc.stop(ac.currentTime + duration + 0.02);
        } catch (e) {}
    }

    // State Constants: 0 = Empty, 1 = Red, 2 = Red King, 3 = Black, 4 = Black King
    const EMPTY = 0;
    const RED = 1;
    const RED_KING = 2;
    const BLACK = 3;
    const BLACK_KING = 4;

    let board = [];
    let turn = 'red'; // 'red' moves up (r: 7 -> 0), 'black' moves down (r: 0 -> 7)
    let selectedSquare = null;
    let validMoves = []; // array of { toR, toC, isJump, captured: {r, c} }
    let mode = 'ai'; // 'ai' | 'local' | 'online'
    let isGameOver = false;
    let redCaptured = 0;
    let blackCaptured = 0;
    let totalMoves = 0;

    // DOM Elements
    const turnTextEl = document.getElementById('checkersTurnText');
    const capTextEl = document.getElementById('checkersCapText');
    const redCapEl = document.getElementById('redCapCount');
    const blackCapEl = document.getElementById('blackCapCount');
    const gameOverOverlay = document.getElementById('checkersGameOverOverlay');
    const winnerTextEl = document.getElementById('checkersWinnerText');
    const subTextEl = document.getElementById('checkersSubText');
    const playAgainBtn = document.getElementById('checkersPlayAgainBtn');
    const restartHeaderBtn = document.getElementById('checkersRestartHeaderBtn');
    const soundBtn = document.getElementById('checkersSoundBtn');
    const soundIcon = document.getElementById('checkersSoundIcon');
    const fullscreenBtn = document.getElementById('checkersFullscreenBtn');
    const fullscreenIcon = document.getElementById('checkersFullscreenIcon');

    const btnModeAi = document.getElementById('btnModeAi');
    const btnModeLocal = document.getElementById('btnModeLocal');
    const btnModeOnline = document.getElementById('btnModeOnline');

    function initBoardState() {
        board = [];
        for (let r = 0; r < 8; r++) {
            const row = [];
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) {
                    if (r < 3) row.push(BLACK);
                    else if (r > 4) row.push(RED);
                    else row.push(EMPTY);
                } else {
                    row.push(EMPTY);
                }
            }
            board.push(row);
        }

        turn = 'red';
        selectedSquare = null;
        validMoves = [];
        isGameOver = false;
        redCaptured = 0;
        blackCaptured = 0;
        totalMoves = 0;

        updateHUD();
        renderBoard();
        if (gameOverOverlay) gameOverOverlay.style.display = 'none';
    }

    function updateHUD() {
        if (turnTextEl) {
            if (turn === 'red') {
                turnTextEl.textContent = mode === 'ai' ? 'Red (You)' : 'Red Turn';
                turnTextEl.style.color = '#ef4444';
            } else {
                turnTextEl.textContent = mode === 'ai' ? 'Black (AI Bot)' : 'Black Turn';
                turnTextEl.style.color = '#adb5bd';
            }
        }
        if (capTextEl) capTextEl.textContent = `${redCaptured} vs ${blackCaptured}`;
        if (redCapEl) redCapEl.textContent = redCaptured;
        if (blackCapEl) blackCapEl.textContent = blackCaptured;
    }

    function isRed(p) { return p === RED || p === RED_KING; }
    function isBlack(p) { return p === BLACK || p === BLACK_KING; }
    function isKing(p) { return p === RED_KING || p === BLACK_KING; }

    function getMovesForPiece(r, c, forceJumps = false) {
        const piece = board[r][c];
        if (piece === EMPTY) return [];

        const moves = [];
        const jumps = [];
        const directions = [];

        if (piece === RED || isKing(piece)) {
            directions.push([-1, -1], [-1, 1]); // Move up
        }
        if (piece === BLACK || isKing(piece)) {
            directions.push([1, -1], [1, 1]); // Move down
        }

        for (let [dr, dc] of directions) {
            const nr = r + dr;
            const nc = c + dc;

            // Simple move
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                if (board[nr][nc] === EMPTY && !forceJumps) {
                    moves.push({ toR: nr, toC: nc, isJump: false });
                } else if (
                    (isRed(piece) && isBlack(board[nr][nc])) ||
                    (isBlack(piece) && isRed(board[nr][nc]))
                ) {
                    // Jump check
                    const jnr = nr + dr;
                    const jnc = nc + dc;
                    if (jnr >= 0 && jnr < 8 && jnc >= 0 && jnc < 8 && board[jnr][jnc] === EMPTY) {
                        jumps.push({ toR: jnr, toC: jnc, isJump: true, captured: { r: nr, c: nc } });
                    }
                }
            }
        }

        return jumps.length > 0 ? jumps : (forceJumps ? [] : moves);
    }

    function getAllAvailableMoves(currentTurn) {
        const jumpMoves = [];
        const normalMoves = [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if ((currentTurn === 'red' && isRed(p)) || (currentTurn === 'black' && isBlack(p))) {
                    const m = getMovesForPiece(r, c, false);
                    m.forEach(move => {
                        const moveObj = { fromR: r, fromC: c, ...move };
                        if (move.isJump) jumpMoves.push(moveObj);
                        else normalMoves.push(moveObj);
                    });
                }
            }
        }

        // Standard Checkers rule: Jumps are mandatory if available
        return jumpMoves.length > 0 ? jumpMoves : normalMoves;
    }

    async function saveScoreToApi(finalScore, winnerColor) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'checkers',
                    score: finalScore,
                    winner: winnerColor === 'red' ? 'red' : 'black',
                    moves: totalMoves
                })
            });
        } catch (e) {
            console.error('Failed to save checkers score:', e);
        }
    }

    function checkGameOver() {
        const availableMoves = getAllAvailableMoves(turn);
        if (availableMoves.length === 0) {
            isGameOver = true;
            const winner = turn === 'red' ? 'black' : 'red';
            const winnerName = winner === 'red' ? 'Red' : 'Black';
            const userWon = winner === 'red';
            const score = userWon ? 350 + (12 - blackCaptured) * 20 : 50;

            if (winnerTextEl) {
                winnerTextEl.textContent = `${winnerName} Wins!`;
                winnerTextEl.style.color = winner === 'red' ? '#ef4444' : '#adb5bd';
            }
            if (subTextEl) {
                subTextEl.textContent = `No legal moves remaining! Game Over (${score} pts)`;
            }
            if (gameOverOverlay) gameOverOverlay.style.display = 'flex';

            saveScoreToApi(score, winner);
            return true;
        }
        return false;
    }

    function makeMove(fromR, fromC, move) {
        const piece = board[fromR][fromC];
        board[fromR][fromC] = EMPTY;
        board[move.toR][move.toC] = piece;
        totalMoves++;

        let isCrowned = false;
        // King crowning
        if (piece === RED && move.toR === 0) {
            board[move.toR][move.toC] = RED_KING;
            isCrowned = true;
        } else if (piece === BLACK && move.toR === 7) {
            board[move.toR][move.toC] = BLACK_KING;
            isCrowned = true;
        }

        let multiJumpPossible = false;
        if (move.isJump && move.captured) {
            board[move.captured.r][move.captured.c] = EMPTY;
            if (turn === 'red') blackCaptured++;
            else redCaptured++;

            // Check if further jump is possible with the same piece (Chain jump)
            if (!isCrowned) {
                const nextJumps = getMovesForPiece(move.toR, move.toC, true);
                if (nextJumps.length > 0) {
                    multiJumpPossible = true;
                    selectedSquare = { r: move.toR, c: move.toC };
                    validMoves = nextJumps;
                }
            }
        }

        playMoveTone(move.isJump, isCrowned);

        if (!multiJumpPossible) {
            selectedSquare = null;
            validMoves = [];
            turn = turn === 'red' ? 'black' : 'red';
            updateHUD();
            renderBoard();

            if (!checkGameOver()) {
                if (turn === 'black' && mode === 'ai') {
                    setTimeout(stepAi, 300);
                }
            }
        } else {
            updateHUD();
            renderBoard();
            // If AI is in the middle of a chain jump, execute next jump after brief delay
            if (turn === 'black' && mode === 'ai') {
                setTimeout(stepAi, 300);
            }
        }
    }

    // AI Bot heuristic movement (aiMove)
    function stepAi() {
        if (isGameOver || turn !== 'black') return;

        // If currently continuing a multi-jump chain with selected piece
        if (selectedSquare && validMoves.length > 0) {
            const chosenMove = validMoves[0];
            makeMove(selectedSquare.r, selectedSquare.c, chosenMove);
            return;
        }

        const allMoves = getAllAvailableMoves('black');
        if (allMoves.length === 0) {
            // Immediately invoke game-over declaring Red as the winner
            checkGameOver();
            return;
        }

        // Prioritize jumps, then king promotions, then forward/center progression
        allMoves.sort((a, b) => {
            if (a.isJump && !b.isJump) return -1;
            if (!a.isJump && b.isJump) return 1;
            if (a.toR === 7 && b.toR !== 7) return -1;
            return Math.abs(3.5 - a.toC) - Math.abs(3.5 - b.toC);
        });

        const chosen = allMoves[0];
        makeMove(chosen.fromR, chosen.fromC, chosen);
    }

    // Alias for compatibility
    const aiMove = stepAi;

    function renderBoard() {
        // Clear squares while preserving overlays
        const squares = boardFrame.querySelectorAll('.checkers-square');
        squares.forEach(sq => sq.remove());

        const mandatoryJumps = getAllAvailableMoves(turn).filter(m => m.isJump);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sq = document.createElement('div');
                const isDark = (r + c) % 2 === 1;
                sq.className = `checkers-square ${isDark ? 'dark' : 'light'}`;
                sq.dataset.r = r;
                sq.dataset.c = c;

                // Selection & Valid move highlights
                if (selectedSquare && selectedSquare.r === r && selectedSquare.c === c) {
                    sq.classList.add('highlight-selected');
                }

                const isValidTarget = validMoves.some(m => m.toR === r && m.toC === c);
                if (isValidTarget) {
                    sq.classList.add('highlight-valid');
                }

                // Piece rendering
                const piece = board[r][c];
                if (piece !== EMPTY) {
                    const pDiv = document.createElement('div');
                    let pClass = isRed(piece) ? 'red' : 'black';
                    if (isKing(piece)) pClass += ' king';
                    pDiv.className = `checkers-piece ${pClass}`;
                    sq.appendChild(pDiv);
                }

                sq.addEventListener('click', () => handleSquareClick(r, c, mandatoryJumps));
                boardFrame.appendChild(sq);
            }
        }
    }

    function handleSquareClick(r, c, mandatoryJumps) {
        if (isGameOver) return;
        if (mode === 'ai' && turn === 'black') return;

        // If clicking on a valid move target
        const targetMove = validMoves.find(m => m.toR === r && m.toC === c);
        if (selectedSquare && targetMove) {
            makeMove(selectedSquare.r, selectedSquare.c, targetMove);
            return;
        }

        // Selecting a piece
        const piece = board[r][c];
        if (piece !== EMPTY) {
            if ((turn === 'red' && isRed(piece)) || (turn === 'black' && isBlack(piece))) {
                // If jumps are mandatory, make sure selected piece can jump
                if (mandatoryJumps.length > 0) {
                    const canThisJump = mandatoryJumps.some(m => m.fromR === r && m.fromC === c);
                    if (!canThisJump) return;
                }

                selectedSquare = { r, c };
                validMoves = getMovesForPiece(r, c, mandatoryJumps.length > 0);
                renderBoard();
            }
        } else {
            selectedSquare = null;
            validMoves = [];
            renderBoard();
        }
    }

    function setupEventListeners() {
        if (playAgainBtn) playAgainBtn.addEventListener('click', initBoardState);
        if (restartHeaderBtn) restartHeaderBtn.addEventListener('click', initBoardState);

        // Sound toggle
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('checkers_sound', soundEnabled);
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

        // Mode buttons
        function setMode(m, btn) {
            mode = m;
            [btnModeAi, btnModeLocal, btnModeOnline].forEach(b => b?.classList.remove('active'));
            btn?.classList.add('active');
            initBoardState();
        }

        if (btnModeAi) btnModeAi.addEventListener('click', () => setMode('ai', btnModeAi));
        if (btnModeLocal) btnModeLocal.addEventListener('click', () => setMode('local', btnModeLocal));
        if (btnModeOnline) btnModeOnline.addEventListener('click', () => {
            setMode('online', btnModeOnline);
            // Connect to /api/games/checkers/room/ or fallback gracefully
            fetch('/api/games/checkers/room/?action=status')
                .then(r => r.json())
                .catch(() => console.log('Online room fallback to local'));
        });
    }

    function init() {
        setupEventListeners();
        initBoardState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
