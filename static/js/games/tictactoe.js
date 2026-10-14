/**
 * static/js/games/tictactoe.js
 * Grid Masters: Tic Tac Toe (AI, Local Pass & Play, and Redis Online Multiplayer)
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

        // Game State
        let board = ['', '', '', '', '', '', '', '', ''];
        let currentPlayer = 'X';
        let gameActive = true;
        let wins = 0;
        let gameMode = 'ai'; // 'ai', 'local', 'online'
        let soundEnabled = true;

        // Online State
        let currentRoom = null;
        let currentRoomState = null;
        let mySymbol = null;
        let pollTimer = null;

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
                statusEl.innerHTML = `<span class="text-success fw-bold">Player ${currentPlayer} Wins! 🎉</span>`;
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
                statusEl.innerHTML = `<span class="text-warning fw-bold">It's a Draw! 🤝</span>`;
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
        // SMART AI LOGIC (Win, Block, or Center/Corner)
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
                statusEl.innerHTML = `<span class="text-danger fw-bold">AI Bot Wins! 🤖</span>`;
                gameActive = false;
                return;
            }

            if (board.every(cell => cell !== '')) {
                statusEl.innerHTML = `<span class="text-warning fw-bold">It's a Draw! 🤝</span>`;
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
                if (currentRoom) {
                    sendOnlineAction('rematch', { room_code: currentRoom });
                } else {
                    statusEl.innerHTML = `<span class="text-muted">Select Quick Match or Create Room to begin.</span>`;
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
        // ONLINE MULTIPLAYER (REDIS BACKED)
        // ==========================================
        function stopOnlinePolling() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        function startOnlinePolling() {
            stopOnlinePolling();
            if (!currentRoom) return;

            pollOnlineRoom();
            pollTimer = setInterval(pollOnlineRoom, 1200);
        }

        async function pollOnlineRoom() {
            if (!currentRoom || gameMode !== 'online') {
                stopOnlinePolling();
                return;
            }

            try {
                const res = await fetch(`/api/games/tictactoe/room/?room_code=${encodeURIComponent(currentRoom)}`);
                if (res.status === 404) {
                    stopOnlinePolling();
                    statusEl.innerHTML = `<span class="text-danger">Room expired or closed.</span>`;
                    return;
                }
                const data = await res.json();
                if (data.success && data.room) {
                    if (data.my_symbol) mySymbol = data.my_symbol;
                    renderOnlineState(data.room);
                }
            } catch (err) {
                console.error('Error polling online room:', err);
            }
        }

        function renderOnlineState(room) {
            currentRoomState = room;

            // Render board cells
            clearWinningCells();
            for (let i = 0; i < 9; i++) {
                const val = room.board[i];
                board[i] = val;
                cells[i].textContent = val;
                cells[i].classList.remove('x', 'o', 'taken');
                if (val) {
                    cells[i].classList.add(val.toLowerCase(), 'taken');
                }
            }

            // Highlight winning line
            if (room.winning_line && room.winning_line.length > 0) {
                highlightWinningCells(room.winning_line);
            }

            // Update Room Info Pill
            if (roomInfoPill) {
                roomInfoPill.style.display = 'inline-flex';
                if (valRoomCode) valRoomCode.textContent = room.room_code;
                if (valPlayerX) valPlayerX.textContent = `X: ${room.player_x || 'Waiting...'}`;
                if (valPlayerO) valPlayerO.textContent = `O: ${room.player_o || 'Waiting...'}`;
                if (pillMySymbol) {
                    pillMySymbol.className = mySymbol === 'X' ? 'badge bg-warning text-dark ms-2' : (mySymbol === 'O' ? 'badge bg-info text-dark ms-2' : 'badge bg-secondary ms-2');
                    pillMySymbol.textContent = `You: ${mySymbol || 'Spectator'}`;
                }
            }

            // Status message
            if (room.status === 'waiting') {
                statusEl.innerHTML = `<span>Waiting for opponent to join Room <strong class="text-warning">${room.room_code}</strong>... ⏳</span>`;
            } else if (room.status === 'playing') {
                const isMyTurn = (room.turn === mySymbol);
                if (isMyTurn) {
                    statusEl.innerHTML = `<span class="text-success fw-bold">Your turn! Place your ${mySymbol}. ⚡</span>`;
                } else {
                    const opp = room.turn === 'X' ? room.player_x : room.player_o;
                    statusEl.innerHTML = `<span class="text-muted">Waiting for <strong class="text-warning">${opp || room.turn}</strong>'s move...</span>`;
                }
            } else if (room.status === 'finished') {
                if (room.winner === 'DRAW') {
                    statusEl.innerHTML = `<span class="text-warning fw-bold">Game Draw! 🤝 Click New Match to Rematch.</span>`;
                } else if (room.winner === mySymbol) {
                    statusEl.innerHTML = `<span class="text-success fw-bold">Victory! You Won! 🏆 🎉</span>`;
                    wins++;
                    if (winsEl) winsEl.textContent = wins;
                } else {
                    const winnerName = room.winner === 'X' ? room.player_x : room.player_o;
                    statusEl.innerHTML = `<span class="text-danger fw-bold">${winnerName || room.winner} Won! 💥</span>`;
                }
            }
        }

        async function sendOnlineAction(action, extraPayload) {
            try {
                const payload = Object.assign({ action: action }, extraPayload || {});
                const res = await fetch('/api/games/tictactoe/room/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrftoken
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success && data.room) {
                    currentRoom = data.room.room_code;
                    mySymbol = data.my_symbol;
                    renderOnlineState(data.room);
                    startOnlinePolling();
                } else {
                    alert(data.error || 'Failed to complete action');
                }
            } catch (err) {
                console.error('Online action error:', err);
                alert('Connection error. Please try again.');
            }
        }

        function handleOnlineCellClick(index) {
            if (!currentRoom || !currentRoomState) return;

            if (currentRoomState.status !== 'playing') {
                if (currentRoomState.status === 'waiting') {
                    alert('Waiting for an opponent to join the room!');
                }
                return;
            }

            if (currentRoomState.turn !== mySymbol) {
                alert(`Not your turn! Waiting for ${currentRoomState.turn}.`);
                return;
            }

            if (board[index] !== '') {
                return;
            }

            sendOnlineAction('move', { room_code: currentRoom, index: index });
        }

        // ==========================================
        // LOBBY BUTTON LISTENERS
        // ==========================================
        if (btnQuickMatch) {
            btnQuickMatch.addEventListener('click', function() {
                statusEl.innerHTML = `<span class="text-info"><i class="spinner-border spinner-border-sm me-1"></i>Searching for an open match...</span>`;
                sendOnlineAction('quick_match');
            });
        }

        if (btnCreateRoom) {
            btnCreateRoom.addEventListener('click', function() {
                statusEl.innerHTML = `<span class="text-info"><i class="spinner-border spinner-border-sm me-1"></i>Generating room code...</span>`;
                sendOnlineAction('create');
            });
        }

        if (btnJoinRoom && inputRoomCode) {
            btnJoinRoom.addEventListener('click', function() {
                const code = inputRoomCode.value.trim().toUpperCase();
                if (code.length < 4) {
                    alert('Please enter a valid 6-character room code.');
                    return;
                }
                statusEl.innerHTML = `<span class="text-info"><i class="spinner-border spinner-border-sm me-1"></i>Joining room ${code}...</span>`;
                sendOnlineAction('join', { room_code: code });
            });
        }

        if (pillRoomCode && valRoomCode) {
            pillRoomCode.addEventListener('click', function() {
                const code = valRoomCode.textContent;
                if (code && code !== '------') {
                    navigator.clipboard.writeText(code).then(() => {
                        const originalText = pillRoomCode.innerHTML;
                        pillRoomCode.innerHTML = `<i class="bi bi-check2 text-success me-1"></i>COPIED!`;
                        setTimeout(() => {
                            pillRoomCode.innerHTML = originalText;
                        }, 1500);
                    }).catch(() => {});
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
            stopOnlinePolling();
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
            stopOnlinePolling();
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
    });
})();
