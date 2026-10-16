/**
 * static/js/games/tictactoe.js
 * Grid Masters: Tic Tac Toe (AI, Local Pass & Play, and Firebase RTDB Real-Time Online Multiplayer)
 */
(function() {
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

    document.addEventListener('DOMContentLoaded', function() {
        const cells = document.querySelectorAll('.ttt-cell');
        const statusEl = document.getElementById('tttStatus');
        const restartBtn = document.getElementById('tttRestartBtn');
        const winsEl = document.getElementById('tttWins');
        const fullscreenBtn = document.getElementById('tttFullscreenBtn');
        const arenaContainer = document.getElementById('tttArenaContainer');
        const soundToggleBtn = document.getElementById('tttSoundToggleBtn');
        const soundIcon = document.getElementById('tttSoundIcon');

        // Online Lobby Elements
        const onlineLobbyEl = document.getElementById('tttOnlineLobby');
        const btnQuickMatch = document.getElementById('btnQuickMatch');
        const btnCreateRoom = document.getElementById('btnCreateRoom');
        const btnJoinRoom = document.getElementById('btnJoinRoom');
        const inputRoomCode = document.getElementById('inputRoomCode');
        const roomInfoPill = document.getElementById('tttRoomInfo');
        const pillRoomCode = document.getElementById('pillRoomCode');
        const valRoomCode = document.getElementById('valRoomCode');
        const valPlayerX = document.getElementById('valPlayerX');
        const valPlayerO = document.getElementById('valPlayerO');
        const pillMySymbol = document.getElementById('pillMySymbol');

        // Share & Invite Buttons
        const btnShareWhatsApp = document.getElementById('btnTttShareWhatsApp');
        const btnCopyInviteLink = document.getElementById('btnTttCopyInviteLink');
        const btnInviteFriends = document.getElementById('btnTttInviteFriends');
        const btnNativeShare = document.getElementById('btnTttNativeShare');

        // Game State
        let board = ['', '', '', '', '', '', '', '', ''];
        let currentPlayer = 'X';
        let gameActive = true;
        let wins = 0;
        let gameMode = 'ai'; // 'ai', 'local', 'online'
        let soundEnabled = true;

        // Online Firebase State
        let currentRoom = null;
        let currentRoomRef = null;
        let currentRoomState = null;
        let mySymbol = null;

        const winningConditions = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
            [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
            [0, 4, 8], [2, 4, 6]            // Diagonals
        ];

        // Web Audio Synthesizer for moves
        function playChirp(freq, duration) {
            if (!soundEnabled) return;
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return;
                const ctx = new AudioContextClass();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
                osc.start();
                osc.stop(ctx.currentTime + duration);
            } catch (e) {}
        }

        // ==========================================
        // CELL CLICK HANDLER
        // ==========================================
        function handleCellClick(e) {
            const index = parseInt(e.target.getAttribute('data-index'), 10);

            if (gameMode === 'online') {
                handleOnlineCellClick(index);
                return;
            }

            if (board[index] !== '' || !gameActive) return;

            makeMove(index, currentPlayer);
            playChirp(currentPlayer === 'X' ? 520 : 640, 0.12);

            const winningLine = getWinningLine(currentPlayer);
            if (winningLine) {
                highlightWinningCells(winningLine);
                statusEl.innerHTML = `<span class="text-success fw-bold">Player ${currentPlayer} Wins! \uD83C\uDFC6</span>`;
                gameActive = false;
                playChirp(880, 0.35);

                if (currentPlayer === 'X' && gameMode === 'ai') {
                    wins++;
                    if (winsEl) winsEl.textContent = wins;
                    saveScoreToBackend(wins);
                }
                return;
            }

            if (board.every(cell => cell !== '')) {
                statusEl.innerHTML = `<span class="text-warning fw-bold">It's a Draw! \uD83E\uDD1D</span>`;
                gameActive = false;
                return;
            }

            currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
            statusEl.innerHTML = `Turn: <span class="text-warning fw-bold">${currentPlayer}</span>`;

            if (gameMode === 'ai' && currentPlayer === 'O' && gameActive) {
                setTimeout(makeSmartAIMove, 350);
            }
        }

        function makeMove(index, player) {
            board[index] = player;
            cells[index].textContent = player;
            cells[index].classList.remove('x', 'o');
            cells[index].classList.add(player.toLowerCase(), 'taken');
        }

        function highlightWinningCells(line) {
            if (!line) return;
            line.forEach(idx => {
                if (cells[idx]) cells[idx].classList.add('win-cell');
            });
        }

        function clearWinningCells() {
            cells.forEach(c => c.classList.remove('win-cell'));
        }

        function getWinningLine(player) {
            for (let i = 0; i < winningConditions.length; i++) {
                const [a, b, c] = winningConditions[i];
                if (board[a] === player && board[b] === player && board[c] === player) {
                    return [a, b, c];
                }
            }
            return null;
        }

        // ==========================================
        // SMART AI LOGIC
        // ==========================================
        function makeSmartAIMove() {
            if (!gameActive) return;

            // 1. Can AI ('O') win in 1 move?
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    board[i] = 'O';
                    if (getWinningLine('O')) {
                        board[i] = '';
                        executeAIMove(i);
                        return;
                    }
                    board[i] = '';
                }
            }

            // 2. Can Player ('X') win in 1 move? Block it!
            for (let i = 0; i < 9; i++) {
                if (board[i] === '') {
                    board[i] = 'X';
                    if (getWinningLine('X')) {
                        board[i] = '';
                        executeAIMove(i);
                        return;
                    }
                    board[i] = '';
                }
            }

            // 3. Take center if available
            if (board[4] === '') {
                executeAIMove(4);
                return;
            }

            // 4. Take available corner
            const corners = [0, 2, 6, 8].filter(idx => board[idx] === '');
            if (corners.length > 0) {
                const choice = corners[Math.floor(Math.random() * corners.length)];
                executeAIMove(choice);
                return;
            }

            // 5. Take any remaining spot
            const emptyCells = board.map((val, idx) => val === '' ? idx : null).filter(val => val !== null);
            if (emptyCells.length > 0) {
                const choice = emptyCells[Math.floor(Math.random() * emptyCells.length)];
                executeAIMove(choice);
            }
        }

        function executeAIMove(index) {
            makeMove(index, 'O');
            playChirp(640, 0.12);

            const winningLine = getWinningLine('O');
            if (winningLine) {
                highlightWinningCells(winningLine);
                statusEl.innerHTML = `<span class="text-danger fw-bold">AI Bot Wins! \uD83E\uDD16</span>`;
                gameActive = false;
                return;
            }

            if (board.every(cell => cell !== '')) {
                statusEl.innerHTML = `<span class="text-warning fw-bold">It's a Draw! \uD83E\uDD1D</span>`;
                gameActive = false;
                return;
            }

            currentPlayer = 'X';
            statusEl.innerHTML = `Turn: <span class="text-warning fw-bold">X</span> (Your turn)`;
        }

        function restartGame() {
            board = ['', '', '', '', '', '', '', '', ''];
            gameActive = true;
            currentPlayer = 'X';
            clearWinningCells();
            cells.forEach(cell => {
                cell.textContent = '';
                cell.classList.remove('x', 'o', 'taken', 'win-cell');
            });

            if (gameMode === 'online') {
                if (currentRoomRef && currentRoomState) {
                    currentRoomRef.update({
                        board: ['', '', '', '', '', '', '', '', ''],
                        turn: 'X',
                        status: 'playing',
                        winner: null,
                        winning_line: null
                    });
                }
            } else {
                statusEl.innerHTML = `Your turn! You are <span class="text-warning fw-bold">X</span>`;
            }
        }

        function saveScoreToBackend(scoreVal) {
            fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'tictactoe',
                    score: scoreVal,
                    winner: 'X'
                })
            }).catch(err => console.log('Score save error:', err));
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
            return `${window.location.origin}/games/tictactoe/?room=${encodeURIComponent(roomCode)}`;
        }

        function detachFirebaseRoom() {
            if (currentRoomRef) {
                currentRoomRef.off();
                currentRoomRef = null;
            }
        }

        async function createOnlineRoom() {
            detachFirebaseRoom();
            const db = getFirebaseDb();
            const code = generateRoomCode();
            currentRoom = code;
            mySymbol = 'X';

            const roomData = {
                room_code: code,
                game_type: 'tictactoe',
                host_id: currentUser.id,
                status: 'waiting',
                created_at: firebase.database.ServerValue.TIMESTAMP,
                players: {
                    X: {
                        id: currentUser.id,
                        name: currentUser.name,
                        avatar: currentUser.avatar,
                        online: true
                    },
                    O: null
                },
                board: ['', '', '', '', '', '', '', '', ''],
                turn: 'X',
                winner: null,
                winning_line: null
            };

            currentRoomRef = db.ref('/games/tictactoe/' + code);
            await currentRoomRef.set(roomData);

            // onDisconnect handler
            currentRoomRef.child('players/X/online').onDisconnect().set(false);

            attachFirebaseListener();
            updateUrlRoomCode(code);
            showToast(`Room ${code} created! Share the code with your friend.`, 'Room Created', '\uD83C\uDFAE');
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
            currentRoomRef = db.ref('/games/tictactoe/' + code);

            const snap = await currentRoomRef.once('value');
            if (!snap.exists()) {
                alert(`Room "${code}" not found or has expired.`);
                currentRoom = null;
                currentRoomRef = null;
                return;
            }

            const data = snap.val();
            const pX = data.players ? data.players.X : null;
            const pO = data.players ? data.players.O : null;

            if (pX && pX.id === currentUser.id) {
                mySymbol = 'X';
                currentRoomRef.child('players/X/online').set(true);
                currentRoomRef.child('players/X/online').onDisconnect().set(false);
            } else if (pO && pO.id === currentUser.id) {
                mySymbol = 'O';
                currentRoomRef.child('players/O/online').set(true);
                currentRoomRef.child('players/O/online').onDisconnect().set(false);
            } else if (!pO) {
                // Join as Player O
                mySymbol = 'O';
                await currentRoomRef.child('players/O').set({
                    id: currentUser.id,
                    name: currentUser.name,
                    avatar: currentUser.avatar,
                    online: true
                });
                await currentRoomRef.child('status').set('playing');
                currentRoomRef.child('players/O/online').onDisconnect().set(false);
                showToast(`Joined room ${code}! Match is live!`, 'Match Started', '\u2694\uFE0F');
            } else {
                mySymbol = 'Spectator';
                showToast(`Room is full. Spectating match.`, 'Spectating', '\uD83D\uDC40');
            }

            attachFirebaseListener();
            updateUrlRoomCode(code);
        }

        function attachFirebaseListener() {
            if (!currentRoomRef) return;
            currentRoomRef.on('value', snapshot => {
                if (!snapshot.exists()) {
                    statusEl.innerHTML = `<span class="text-danger">Room has been closed.</span>`;
                    return;
                }
                const room = snapshot.val();
                renderFirebaseState(room);
            });
        }

        function renderFirebaseState(room) {
            currentRoomState = room;

            // Sync board
            clearWinningCells();
            for (let i = 0; i < 9; i++) {
                const val = (room.board && room.board[i]) || '';
                board[i] = val;
                cells[i].textContent = val;
                cells[i].classList.remove('x', 'o', 'taken');
                if (val) {
                    cells[i].classList.add(val.toLowerCase(), 'taken');
                }
            }

            // Winning line
            if (room.winning_line && room.winning_line.length > 0) {
                highlightWinningCells(room.winning_line);
            }

            // Update UI Pill
            if (roomInfoPill) {
                roomInfoPill.style.display = 'block';
                if (valRoomCode) valRoomCode.textContent = room.room_code;
                const pX = room.players && room.players.X;
                const pO = room.players && room.players.O;
                if (valPlayerX) valPlayerX.textContent = `X: ${pX ? pX.name : 'Waiting...'}`;
                if (valPlayerO) valPlayerO.textContent = `O: ${pO ? pO.name : 'Waiting...'}`;
                if (pillMySymbol) {
                    pillMySymbol.className = mySymbol === 'X' ? 'badge bg-warning text-dark' : (mySymbol === 'O' ? 'badge bg-info text-dark' : 'badge bg-secondary');
                    pillMySymbol.textContent = `You: ${mySymbol || 'Spectator'}`;
                }
            }

            // Status banner
            if (room.status === 'waiting') {
                statusEl.innerHTML = `<span>Waiting for an opponent to join Room <strong class="text-warning font-monospace">${room.room_code}</strong>... \u23F3</span>`;
            } else if (room.status === 'playing') {
                // Check opponent disconnect
                const opp = mySymbol === 'X' ? (room.players && room.players.O) : (room.players && room.players.X);
                if (opp && opp.online === false) {
                    statusEl.innerHTML = `<span class="text-danger"><i class="bi bi-wifi-off me-1"></i>Opponent disconnected...</span>`;
                    return;
                }

                const isMyTurn = (room.turn === mySymbol);
                if (isMyTurn) {
                    statusEl.innerHTML = `<span class="text-success fw-bold">Your turn! Place your ${mySymbol}. \uD83C\uDFAF</span>`;
                } else {
                    const oppName = room.turn === 'X' ? (room.players?.X?.name || 'X') : (room.players?.O?.name || 'O');
                    statusEl.innerHTML = `<span class="text-muted">Waiting for <strong class="text-warning">${oppName}</strong>'s move...</span>`;
                }
            } else if (room.status === 'finished') {
                if (room.winner === 'DRAW') {
                    statusEl.innerHTML = `<span class="text-warning fw-bold">Game Draw! \uD83E\uDD1D Click New Match to Rematch.</span>`;
                } else if (room.winner === mySymbol) {
                    statusEl.innerHTML = `<span class="text-success fw-bold">Victory! You Won! \uD83C\uDFC6 \u2728</span>`;
                    playChirp(880, 0.4);
                    wins++;
                    if (winsEl) winsEl.textContent = wins;
                } else {
                    const winnerName = room.winner === 'X' ? (room.players?.X?.name || 'Player X') : (room.players?.O?.name || 'Player O');
                    statusEl.innerHTML = `<span class="text-danger fw-bold">${winnerName} Won! \uD83C\uDFC6</span>`;
                }
            }
        }

        function handleOnlineCellClick(index) {
            if (!currentRoomRef || !currentRoomState) return;

            if (currentRoomState.status !== 'playing') {
                if (currentRoomState.status === 'waiting') {
                    showToast('Waiting for an opponent to join!', 'Waiting Room', '\u23F3');
                }
                return;
            }

            if (currentRoomState.turn !== mySymbol) {
                showToast(`Not your turn! Waiting for ${currentRoomState.turn}.`, 'Turn Alert', '\u26A0\uFE0F');
                return;
            }

            if (board[index] !== '') return;

            // Make move
            const newBoard = [...board];
            newBoard[index] = mySymbol;
            playChirp(mySymbol === 'X' ? 520 : 640, 0.12);

            // Check winning conditions
            let line = null;
            for (let i = 0; i < winningConditions.length; i++) {
                const [a, b, c] = winningConditions[i];
                if (newBoard[a] === mySymbol && newBoard[b] === mySymbol && newBoard[c] === mySymbol) {
                    line = [a, b, c];
                    break;
                }
            }

            const isDraw = !line && newBoard.every(c => c !== '');
            const nextTurn = mySymbol === 'X' ? 'O' : 'X';

            const updates = { board: newBoard };
            if (line) {
                updates.winner = mySymbol;
                updates.winning_line = line;
                updates.status = 'finished';
            } else if (isDraw) {
                updates.winner = 'DRAW';
                updates.winning_line = null;
                updates.status = 'finished';
            } else {
                updates.turn = nextTurn;
            }

            currentRoomRef.update(updates);
        }

        function updateUrlRoomCode(code) {
            const url = new URL(window.location);
            url.searchParams.set('room', code);
            window.history.replaceState({}, '', url);
        }

        // ==========================================
        // SHARE & DIRECT INVITE HANDLERS
        // ==========================================
        if (btnShareWhatsApp) {
            btnShareWhatsApp.addEventListener('click', function() {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                const msg = `\uD83C\uDFAE Let's play Tic-Tac-Toe on XAPYX!\nRoom Code: ${currentRoom}\nClick to join live: ${link}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
            });
        }

        if (btnCopyInviteLink) {
            btnCopyInviteLink.addEventListener('click', function() {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                navigator.clipboard.writeText(link).then(() => {
                    showToast('Invite link copied to clipboard!', 'Copied', '\uD83D\uDCCB');
                }).catch(() => {
                    showToast(link, 'Copy Link', '\uD83D\uDCCB');
                });
            });
        }

        if (btnNativeShare) {
            btnNativeShare.addEventListener('click', function() {
                if (!currentRoom) return;
                const link = getDirectJoinUrl(currentRoom);
                if (navigator.share) {
                    navigator.share({
                        title: 'Play Tic-Tac-Toe on XAPYX',
                        text: `Join my Tic-Tac-Toe match! Room Code: ${currentRoom}`,
                        url: link
                    }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(link).then(() => {
                        showToast('Invite link copied!', 'Copied', '\uD83D\uDCCB');
                    });
                }
            });
        }

        if (btnInviteFriends) {
            btnInviteFriends.addEventListener('click', function() {
                if (!currentRoom) return;
                window.openGameFriendsInviteModal('tictactoe', 'Tic-Tac-Toe', currentRoom);
            });
        }

        // ==========================================
        // LOBBY BUTTON LISTENERS
        // ==========================================
        if (btnQuickMatch) {
            btnQuickMatch.addEventListener('click', async function() {
                statusEl.innerHTML = `<span class="text-info"><i class="spinner-border spinner-border-sm me-1"></i>Searching for an open room...</span>`;
                const db = getFirebaseDb();
                try {
                    const snap = await db.ref('/games/tictactoe').orderByChild('status').equalTo('waiting').limitToFirst(5).once('value');
                    let foundCode = null;
                    if (snap.exists()) {
                        snap.forEach(child => {
                            const r = child.val();
                            if (r.players && r.players.X && r.players.X.id !== currentUser.id && !r.players.O) {
                                foundCode = r.room_code;
                            }
                        });
                    }
                    if (foundCode) {
                        joinOnlineRoom(foundCode);
                    } else {
                        createOnlineRoom();
                    }
                } catch (e) {
                    createOnlineRoom();
                }
            });
        }

        if (btnCreateRoom) {
            btnCreateRoom.addEventListener('click', function() {
                createOnlineRoom();
            });
        }

        if (btnJoinRoom && inputRoomCode) {
            btnJoinRoom.addEventListener('click', function() {
                const code = inputRoomCode.value.trim().toUpperCase();
                joinOnlineRoom(code);
            });
        }

        if (pillRoomCode && valRoomCode) {
            pillRoomCode.addEventListener('click', function() {
                const code = valRoomCode.textContent;
                if (code && code !== '------') {
                    navigator.clipboard.writeText(code).then(() => {
                        showToast(`Room code ${code} copied!`, 'Copied', '\uD83D\uDCCB');
                    });
                }
            });
        }

        // ==========================================
        // MODE SWITCHERS
        // ==========================================
        document.getElementById('btnModeAI').addEventListener('click', function() {
            gameMode = 'ai';
            document.getElementById('tttModeDisplay').textContent = 'AI Bot';
            this.classList.add('active');
            document.getElementById('btnModeLocal').classList.remove('active');
            document.getElementById('btnModeOnline').classList.remove('active');
            if (onlineLobbyEl) onlineLobbyEl.style.display = 'none';
            detachFirebaseRoom();
            currentRoom = null;
            restartGame();
        });

        document.getElementById('btnModeLocal').addEventListener('click', function() {
            gameMode = 'local';
            document.getElementById('tttModeDisplay').textContent = 'Pass & Play';
            this.classList.add('active');
            document.getElementById('btnModeAI').classList.remove('active');
            document.getElementById('btnModeOnline').classList.remove('active');
            if (onlineLobbyEl) onlineLobbyEl.style.display = 'none';
            detachFirebaseRoom();
            currentRoom = null;
            restartGame();
        });

        document.getElementById('btnModeOnline').addEventListener('click', function() {
            gameMode = 'online';
            document.getElementById('tttModeDisplay').textContent = 'Online Room';
            this.classList.add('active');
            document.getElementById('btnModeAI').classList.remove('active');
            document.getElementById('btnModeLocal').classList.remove('active');

            if (onlineLobbyEl) onlineLobbyEl.style.display = 'block';
            restartGame();
            statusEl.innerHTML = `<span class="text-muted">Online mode ready. Click <strong>Quick Match</strong> or <strong>Create Room</strong> above!</span>`;
        });

        // Cell & Controls Listeners
        cells.forEach(cell => cell.addEventListener('click', handleCellClick));
        restartBtn.addEventListener('click', restartGame);

        // Sound toggle
        if (soundToggleBtn && soundIcon) {
            soundToggleBtn.addEventListener('click', function() {
                soundEnabled = !soundEnabled;
                soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            });
        }

        // Fullscreen toggle
        if (fullscreenBtn && arenaContainer) {
            fullscreenBtn.addEventListener('click', function() {
                if (!document.fullscreenElement) {
                    arenaContainer.requestFullscreen().catch(err => {
                        console.log('Fullscreen error:', err);
                    });
                } else {
                    document.exitFullscreen();
                }
            });
        }

        // Auto-join from URL parameter
        if (initialRoomCode) {
            document.getElementById('btnModeOnline').click();
            if (inputRoomCode) inputRoomCode.value = initialRoomCode;
            joinOnlineRoom(initialRoomCode);
        }
    });

    function showToast(msg, title = 'Notification', icon = '\uD83C\uDFAE') {
        if (typeof window.showGameToast === 'function') {
            window.showGameToast(msg, title, icon);
            return;
        }
        let toast = document.querySelector('.game-floating-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'game-floating-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<span class="me-2 fs-5">${icon}</span><span>${msg}</span>`;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('show');
        }, 3200);
    }
})();
