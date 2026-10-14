
document.addEventListener('DOMContentLoaded', function() {
    const cells = document.querySelectorAll('.ttt-cell');
    const statusEl = document.getElementById('tttStatus');
    const restartBtn = document.getElementById('tttRestartBtn');
    const winsEl = document.getElementById('tttWins');
    const fullscreenBtn = document.getElementById('tttFullscreenBtn');
    const arenaContainer = document.getElementById('tttArenaContainer');

    let board = ['', '', '', '', '', '', '', '', ''];
    let currentPlayer = 'X';
    let gameActive = true;
    let wins = 0;
    let gameMode = 'ai'; // 'ai', 'local', 'online'

    const winningConditions = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]            // Diagonals
    ];

    function handleCellClick(e) {
        const index = parseInt(e.target.getAttribute('data-index'));
        if (board[index] !== '' || !gameActive) return;

        makeMove(index, currentPlayer);

        if (checkWin(currentPlayer)) {
            statusEl.innerHTML = `<span class="text-success fw-bold">Player ${currentPlayer} Wins! 🎉</span>`;
            gameActive = false;
            if (currentPlayer === 'X') {
                wins++;
                winsEl.textContent = wins;
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
            setTimeout(makeAIMove, 400);
        }
    }

    function makeMove(index, player) {
        board[index] = player;
        cells[index].textContent = player;
        cells[index].classList.add(player.toLowerCase(), 'taken');
    }

    function makeAIMove() {
        // Simple AI: Find empty spot or random
        let emptyCells = board.map((val, idx) => val === '' ? idx : null).filter(val => val !== null);
        if (emptyCells.length === 0 || !gameActive) return;
        
        // Pick random
        let randomIndex = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        makeMove(randomIndex, 'O');

        if (checkWin('O')) {
            statusEl.innerHTML = `<span class="text-danger fw-bold">AI (O) Wins! 🤖</span>`;
            gameActive = false;
            return;
        }

        if (board.every(cell => cell !== '')) {
            statusEl.innerHTML = `<span class="text-warning fw-bold">It's a Draw! 🤝</span>`;
            gameActive = false;
            return;
        }

        currentPlayer = 'X';
        statusEl.innerHTML = `Turn: <span class="text-warning fw-bold">X</span>`;
    }

    function checkWin(player) {
        return winningConditions.some(condition => {
            return condition.every(index => board[index] === player);
        });
    }

    function restartGame() {
        board = ['', '', '', '', '', '', '', '', ''];
        gameActive = true;
        currentPlayer = 'X';
        statusEl.innerHTML = `Turn: <span class="text-warning fw-bold">X</span>`;
        cells.forEach(cell => {
            cell.textContent = '';
            cell.classList.remove('x', 'o', 'taken');
        });
    }

    function saveScoreToBackend(scoreVal) {
        fetch('/api/games/save-score/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({
                game_type: 'tictactoe',
                score: scoreVal,
                winner: 'X'
            })
        }).catch(err => console.log('Score save error:', err));
    }

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

    cells.forEach(cell => cell.addEventListener('click', handleCellClick));
    restartBtn.addEventListener('click', restartGame);

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

    // Mode switchers
    document.getElementById('btnModeAI').addEventListener('click', function() {
        gameMode = 'ai';
        document.getElementById('tttModeDisplay').textContent = 'AI Bot';
        this.classList.add('active');
        document.getElementById('btnModeLocal').classList.remove('active');
        document.getElementById('btnModeOnline').classList.remove('active');
        restartGame();
    });

    document.getElementById('btnModeLocal').addEventListener('click', function() {
        gameMode = 'local';
        document.getElementById('tttModeDisplay').textContent = 'Pass & Play';
        this.classList.add('active');
        document.getElementById('btnModeAI').classList.remove('active');
        document.getElementById('btnModeOnline').classList.remove('active');
        restartGame();
    });

    document.getElementById('btnModeOnline').addEventListener('click', function() {
        gameMode = 'online';
        document.getElementById('tttModeDisplay').textContent = 'Online Room';
        this.classList.add('active');
        document.getElementById('btnModeAI').classList.remove('active');
        document.getElementById('btnModeLocal').classList.remove('active');
        alert('Online Room pairing feature active! Challenge your friends from the Games Hub leaderboard.');
        restartGame();
    });
});
