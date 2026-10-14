/**
 * static/js/games/snake.js
 * Snake - 60 FPS Smooth Canvas Arcade Game (Solo & vs AI Snake)
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

    const canvas = document.getElementById('snakeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const arenaContainer = document.getElementById('snakeArenaContainer');

    // Grid configuration
    const COLS = 30;
    const ROWS = 22;
    const CELL = 20; // 600x440 logic size
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    // Audio effects
    let audioCtx = null;
    let soundEnabled = localStorage.getItem('snake_sound') !== 'false';
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playTone(freq, duration, type = 'sine', gainVal = 0.1) {
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
            gain.gain.setValueAtTime(gainVal, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
            osc.start();
            osc.stop(ac.currentTime + duration + 0.02);
        } catch (e) {}
    }

    // State
    let mode = 'solo'; // 'solo' | 'vs_ai'
    let isRunning = false;
    let isPaused = false;
    let score = 0;
    let highScore = parseInt(localStorage.getItem('snake_highscore') || '0', 10);
    let speedLevel = 1;
    let tickInterval = 110; // ms per step
    let lastTickTime = 0;
    let animationId = null;

    // Player snake
    let snake = [];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };

    // AI rival snake (vs AI mode)
    let aiSnake = [];
    let aiDir = { x: -1, y: 0 };
    let aiAlive = true;

    // Food
    let apple = { x: 15, y: 11 };
    let goldenOrb = null;
    let goldenTimer = 0;

    // Particles (e.g. food burst)
    let particles = [];

    // DOM Elements
    const scoreEl = document.getElementById('snakeScore');
    const highScoreEl = document.getElementById('snakeHighScore');
    const speedEl = document.getElementById('snakeSpeed');
    const finalScoreEl = document.getElementById('snakeFinalScore');
    const gameOverOverlay = document.getElementById('snakeGameOverOverlay');
    const startOverlay = document.getElementById('snakeStartOverlay');
    const restartBtn = document.getElementById('snakeRestartBtn');
    const resumeBtn = document.getElementById('snakeResumeBtn');
    const pauseBtn = document.getElementById('snakePauseBtn');
    const pauseIcon = document.getElementById('snakePauseIcon');
    const soundBtn = document.getElementById('snakeSoundBtn');
    const soundIcon = document.getElementById('snakeSoundIcon');
    const fullscreenBtn = document.getElementById('snakeFullscreenBtn');
    const fullscreenIcon = document.getElementById('snakeFullscreenIcon');
    const btnModeSolo = document.getElementById('btnModeSolo');
    const btnModeVsAi = document.getElementById('btnModeVsAi');

    function resetGame() {
        score = 0;
        speedLevel = 1;
        tickInterval = 110;
        if (scoreEl) scoreEl.textContent = '0';
        if (speedEl) speedEl.textContent = '1x';
        if (highScoreEl) highScoreEl.textContent = highScore;

        // Player starts on left
        snake = [
            { x: 8, y: 11 },
            { x: 7, y: 11 },
            { x: 6, y: 11 }
        ];
        dir = { x: 1, y: 0 };
        nextDir = { x: 1, y: 0 };

        // AI snake starts on right if vs AI
        if (mode === 'vs_ai') {
            aiSnake = [
                { x: 22, y: 11 },
                { x: 23, y: 11 },
                { x: 24, y: 11 }
            ];
            aiDir = { x: -1, y: 0 };
            aiAlive = true;
        } else {
            aiSnake = [];
            aiAlive = false;
        }

        spawnApple();
        goldenOrb = null;
        goldenTimer = 0;
        particles = [];

        isRunning = true;
        isPaused = false;
        if (gameOverOverlay) gameOverOverlay.style.display = 'none';
        if (startOverlay) startOverlay.style.display = 'none';
        if (pauseIcon) pauseIcon.className = 'bi bi-pause-fill';
    }

    function spawnApple() {
        while (true) {
            const rx = Math.floor(Math.random() * COLS);
            const ry = Math.floor(Math.random() * ROWS);
            const inPlayer = snake.some(s => s.x === rx && s.y === ry);
            const inAi = aiSnake.some(s => s.x === rx && s.y === ry);
            if (!inPlayer && !inAi) {
                apple = { x: rx, y: ry };
                break;
            }
        }
    }

    function spawnGoldenOrb() {
        while (true) {
            const rx = Math.floor(Math.random() * COLS);
            const ry = Math.floor(Math.random() * ROWS);
            const inPlayer = snake.some(s => s.x === rx && s.y === ry);
            const inAi = aiSnake.some(s => s.x === rx && s.y === ry);
            if (!inPlayer && !inAi) {
                goldenOrb = { x: rx, y: ry, life: 70 }; // ~7 seconds
                break;
            }
        }
    }

    function createParticleBurst(x, y, color, count = 12) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            particles.push({
                x: x * CELL + CELL / 2,
                y: y * CELL + CELL / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 18,
                color: color
            });
        }
    }

    // AI movement logic (Greedy Manhattan to nearest food with collision avoidance)
    function stepAiSnake() {
        if (!aiAlive || aiSnake.length === 0) return;
        const head = aiSnake[0];
        const target = goldenOrb || apple;

        const possibleDirs = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 }
        ];

        // Filter out 180 reverse
        const validDirs = possibleDirs.filter(d => !(d.x === -aiDir.x && d.y === -aiDir.y));

        let bestDir = validDirs[0];
        let bestDist = Infinity;

        for (let d of validDirs) {
            const nx = (head.x + d.x + COLS) % COLS;
            const ny = (head.y + d.y + ROWS) % ROWS;

            // Avoid self collision
            const collidesSelf = aiSnake.some(seg => seg.x === nx && seg.y === ny);
            // Avoid player collision
            const collidesPlayer = snake.some(seg => seg.x === nx && seg.y === ny);

            if (!collidesSelf && !collidesPlayer) {
                const dist = Math.abs(nx - target.x) + Math.abs(ny - target.y);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestDir = d;
                }
            }
        }

        aiDir = bestDir;
        const newHead = {
            x: (head.x + aiDir.x + COLS) % COLS,
            y: (head.y + aiDir.y + ROWS) % ROWS
        };

        // Check fatal AI collision
        if (snake.some(s => s.x === newHead.x && s.y === newHead.y) ||
            aiSnake.some(s => s.x === newHead.x && s.y === newHead.y)) {
            aiAlive = false;
            createParticleBurst(newHead.x, newHead.y, '#f59e0b', 24);
            playTone(280, 0.2, 'sawtooth');
            return;
        }

        aiSnake.unshift(newHead);
        if (newHead.x === apple.x && newHead.y === apple.y) {
            spawnApple();
        } else if (goldenOrb && newHead.x === goldenOrb.x && newHead.y === goldenOrb.y) {
            goldenOrb = null;
        } else {
            aiSnake.pop();
        }
    }

    async function saveScoreToApi(finalScore) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'snake',
                    score: finalScore,
                    moves: snake.length
                })
            });
        } catch (e) {
            console.error('Failed to save snake score:', e);
        }
    }

    function triggerGameOver() {
        isRunning = false;
        playTone(130, 0.35, 'sawtooth', 0.15);

        if (score > highScore) {
            highScore = score;
            localStorage.setItem('snake_highscore', highScore);
            if (highScoreEl) highScoreEl.textContent = highScore;
        }

        if (finalScoreEl) finalScoreEl.textContent = score;
        if (gameOverOverlay) gameOverOverlay.style.display = 'flex';

        saveScoreToApi(score);
    }

    function tick() {
        dir = nextDir;
        const head = snake[0];
        const newHead = {
            x: (head.x + dir.x + COLS) % COLS,
            y: (head.y + dir.y + ROWS) % ROWS
        };

        // Check self-collision
        if (snake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
            triggerGameOver();
            return;
        }

        // Check AI snake collision in vs mode
        if (mode === 'vs_ai' && aiAlive && aiSnake.some(seg => seg.x === newHead.x && seg.y === newHead.y)) {
            triggerGameOver();
            return;
        }

        snake.unshift(newHead);

        // Eat Apple
        if (newHead.x === apple.x && newHead.y === apple.y) {
            score += 10;
            createParticleBurst(apple.x, apple.y, '#10b981', 12);
            playTone(520, 0.08, 'triangle');
            spawnApple();

            // Chance to spawn golden orb every 40 points
            if (score % 40 === 0 && !goldenOrb) {
                spawnGoldenOrb();
            }

            // Speed up smoothly
            if (score % 50 === 0 && tickInterval > 65) {
                tickInterval -= 6;
                speedLevel++;
                if (speedEl) speedEl.textContent = speedLevel + 'x';
            }
        } else if (goldenOrb && newHead.x === goldenOrb.x && newHead.y === goldenOrb.y) {
            // Eat Golden Orb
            score += 50;
            createParticleBurst(goldenOrb.x, goldenOrb.y, '#fbbf24', 24);
            playTone(880, 0.14, 'sine');
            goldenOrb = null;
        } else {
            snake.pop();
        }

        if (scoreEl) scoreEl.textContent = score;

        // Step AI
        if (mode === 'vs_ai') {
            stepAiSnake();
        }

        // Golden orb timer
        if (goldenOrb) {
            goldenOrb.life--;
            if (goldenOrb.life <= 0) goldenOrb = null;
        }
    }

    // High performance layered rendering (No ctx.shadowBlur in 60fps loop)
    function draw() {
        ctx.fillStyle = '#050510';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Subtle grid backdrop
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += CELL) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += CELL) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Draw Apple (Layered glow + core)
        ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
        ctx.beginPath();
        ctx.arc(apple.x * CELL + CELL / 2, apple.y * CELL + CELL / 2, CELL * 0.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(apple.x * CELL + CELL / 2, apple.y * CELL + CELL / 2, CELL * 0.38, 0, Math.PI * 2);
        ctx.fill();

        // Draw Golden Orb if active
        if (goldenOrb) {
            ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
            ctx.beginPath();
            ctx.arc(goldenOrb.x * CELL + CELL / 2, goldenOrb.y * CELL + CELL / 2, CELL * 1.1, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(goldenOrb.x * CELL + CELL / 2, goldenOrb.y * CELL + CELL / 2, CELL * 0.44, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw AI Snake
        if (mode === 'vs_ai' && aiAlive) {
            for (let i = 0; i < aiSnake.length; i++) {
                const s = aiSnake[i];
                ctx.fillStyle = i === 0 ? '#f59e0b' : 'rgba(245, 158, 11, 0.65)';
                ctx.beginPath();
                ctx.roundRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4, 6);
                ctx.fill();
            }
        }

        // Draw Player Snake
        for (let i = 0; i < snake.length; i++) {
            const s = snake[i];
            if (i === 0) {
                // Head with layered glow
                ctx.fillStyle = 'rgba(52, 211, 153, 0.3)';
                ctx.fillRect(s.x * CELL - 2, s.y * CELL - 2, CELL + 4, CELL + 4);

                ctx.fillStyle = '#34d399';
                ctx.beginPath();
                ctx.roundRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2, 7);
                ctx.fill();

                // Eyes
                ctx.fillStyle = '#050510';
                ctx.fillRect(s.x * CELL + 5, s.y * CELL + 5, 3, 3);
                ctx.fillRect(s.x * CELL + 12, s.y * CELL + 5, 3, 3);
            } else {
                ctx.fillStyle = '#10b981';
                ctx.beginPath();
                ctx.roundRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4, 5);
                ctx.fill();
            }
        }

        // Draw Particles
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, 2.5, 2.5);
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            if (p.life <= 0) {
                particles.splice(i, 1);
                i--;
            }
        }
    }

    function gameLoop(timestamp) {
        if (isRunning && !isPaused) {
            if (timestamp - lastTickTime >= tickInterval) {
                tick();
                lastTickTime = timestamp;
            }
        }
        draw();
        animationId = requestAnimationFrame(gameLoop);
    }

    function togglePause() {
        if (!isRunning) return;
        isPaused = !isPaused;
        if (isPaused) {
            if (startOverlay) startOverlay.style.display = 'flex';
            if (pauseIcon) pauseIcon.className = 'bi bi-play-fill';
        } else {
            if (startOverlay) startOverlay.style.display = 'none';
            if (pauseIcon) pauseIcon.className = 'bi bi-pause-fill';
        }
    }

    function handleKey(e) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
            e.preventDefault();
        }
        if (e.code === 'Space') {
            togglePause();
            return;
        }
        if (isPaused || !isRunning) return;

        if ((e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W') && dir.y !== 1) {
            nextDir = { x: 0, y: -1 };
        } else if ((e.code === 'ArrowDown' || e.key === 's' || e.key === 'S') && dir.y !== -1) {
            nextDir = { x: 0, y: 1 };
        } else if ((e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && dir.x !== 1) {
            nextDir = { x: -1, y: 0 };
        } else if ((e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') && dir.x !== -1) {
            nextDir = { x: 1, y: 0 };
        }
    }

    function setupEventListeners() {
        window.addEventListener('keydown', handleKey);

        // D-Pad buttons
        const dpadUp = document.getElementById('dpadUp');
        const dpadDown = document.getElementById('dpadDown');
        const dpadLeft = document.getElementById('dpadLeft');
        const dpadRight = document.getElementById('dpadRight');

        if (dpadUp) dpadUp.addEventListener('click', () => { if (dir.y !== 1) nextDir = { x: 0, y: -1 }; });
        if (dpadDown) dpadDown.addEventListener('click', () => { if (dir.y !== -1) nextDir = { x: 0, y: 1 }; });
        if (dpadLeft) dpadLeft.addEventListener('click', () => { if (dir.x !== 1) nextDir = { x: -1, y: 0 }; });
        if (dpadRight) dpadRight.addEventListener('click', () => { if (dir.x !== -1) nextDir = { x: 1, y: 0 }; });

        if (restartBtn) restartBtn.addEventListener('click', resetGame);
        if (resumeBtn) resumeBtn.addEventListener('click', togglePause);
        if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

        // Sound toggle
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('snake_sound', soundEnabled);
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
        if (btnModeSolo && btnModeVsAi) {
            btnModeSolo.addEventListener('click', () => {
                mode = 'solo';
                btnModeSolo.classList.add('active');
                btnModeVsAi.classList.remove('active');
                resetGame();
            });
            btnModeVsAi.addEventListener('click', () => {
                mode = 'vs_ai';
                btnModeVsAi.classList.add('active');
                btnModeSolo.classList.remove('active');
                resetGame();
            });
        }

        // Pause on tab visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isRunning && !isPaused) {
                togglePause();
            }
        });
    }

    function init() {
        setupEventListeners();
        resetGame();
        animationId = requestAnimationFrame(gameLoop);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
