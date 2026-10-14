/**
 * static/js/games/spaceshooter.js
 * Space Shooter - 2D Canvas Arcade Game with Web Audio API (Task 22 Phase 2)
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

    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('spaceCanvasWrapper');

    // Game state
    let gameRunning = true;
    let isPaused = false;
    let score = 0;
    let lives = 3;
    let kills = 0;
    let highScore = parseInt(localStorage.getItem('spaceshooter_highscore') || '0', 10);
    let soundEnabled = localStorage.getItem('spaceshooter_sound') !== 'false';
    let animationId = null;

    // Player position
    let playerX = 400;
    let playerY = 400;
    let targetX = 400;
    let canvasWidth = 800;
    let canvasHeight = 540;

    // Entities
    let bullets = [];
    let enemies = [];
    let particles = [];
    let stars = [];

    // Timings
    const bulletSpeed = 9;
    let shootCooldown = 0;
    const shootDelay = 10;
    let enemySpawnTimer = 0;
    let enemySpawnDelay = 38;
    const enemySpeed = 3.2;

    // Web Audio Context
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
                audioCtx = new AudioCtxClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playLaserSound() {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, ac.currentTime);
            osc.frequency.exponentialRampToValueAtTime(220, ac.currentTime + 0.12);

            gain.gain.setValueAtTime(0.08, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);

            osc.start();
            osc.stop(ac.currentTime + 0.13);
        } catch (e) {
            // Audio context policy fallback
        }
    }

    function playExplosionSound() {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(160, ac.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, ac.currentTime + 0.28);

            gain.gain.setValueAtTime(0.15, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.28);

            osc.start();
            osc.stop(ac.currentTime + 0.3);
        } catch (e) {}
    }

    function playHitSound() {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);

            osc.type = 'square';
            osc.frequency.setValueAtTime(90, ac.currentTime);
            osc.frequency.exponentialRampToValueAtTime(25, ac.currentTime + 0.35);

            gain.gain.setValueAtTime(0.2, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);

            osc.start();
            osc.stop(ac.currentTime + 0.36);
        } catch (e) {}
    }

    // Canvas Sizing
    function resizeCanvas() {
        const wrapW = wrapper ? wrapper.clientWidth : 800;
        canvasWidth = Math.max(320, Math.min(880, wrapW));
        // Responsive height
        const targetH = Math.min(540, Math.max(380, window.innerHeight - 260));
        canvasHeight = targetH;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        playerY = canvasHeight - 65;
        if (playerX > canvasWidth) playerX = canvasWidth / 2;
        targetX = playerX;
        initStars();
    }

    // Procedural Stars
    function initStars() {
        stars = [];
        const tints = [
            'rgba(255,255,255,',
            'rgba(168,184,216,',
            'rgba(255,140,0,',
            'rgba(139,92,246,'
        ];
        const count = Math.floor(canvasWidth * canvasHeight / 3800);
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * canvasWidth,
                y: Math.random() * canvasHeight,
                size: Math.random() * 2 + 1,
                speed: Math.random() * 2.2 + 0.8,
                alpha: Math.random() * 0.5 + 0.3,
                tint: tints[Math.floor(Math.random() * tints.length)]
            });
        }
    }

    function drawStars() {
        for (let s of stars) {
            ctx.fillStyle = s.tint + s.alpha + ')';
            ctx.fillRect(s.x, s.y, s.size, s.size);
        }
    }

    function updateStars() {
        for (let s of stars) {
            s.y += s.speed;
            if (s.y > canvasHeight) {
                s.y = 0;
                s.x = Math.random() * canvasWidth;
            }
        }
    }

    // Starfighter Player
    function drawPlayer() {
        ctx.save();
        // Layered aura instead of expensive ctx.shadowBlur
        ctx.fillStyle = 'rgba(255, 140, 0, 0.18)';
        ctx.beginPath();
        ctx.arc(playerX, playerY, 24, 0, Math.PI * 2);
        ctx.fill();

        // Hull
        ctx.beginPath();
        ctx.moveTo(playerX, playerY - 18);
        ctx.lineTo(playerX - 15, playerY + 10);
        ctx.lineTo(playerX - 6, playerY + 6);
        ctx.lineTo(playerX - 6, playerY + 14);
        ctx.lineTo(playerX, playerY + 6);
        ctx.lineTo(playerX + 6, playerY + 14);
        ctx.lineTo(playerX + 6, playerY + 6);
        ctx.lineTo(playerX + 15, playerY + 10);
        ctx.closePath();

        const grad = ctx.createLinearGradient(playerX - 12, playerY - 14, playerX + 12, playerY + 14);
        grad.addColorStop(0, '#ffb347');
        grad.addColorStop(0.5, '#ff8c00');
        grad.addColorStop(1, '#ff5500');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Engine flame
        ctx.beginPath();
        ctx.moveTo(playerX - 5, playerY + 14);
        ctx.lineTo(playerX, playerY + 24 + Math.random() * 6);
        ctx.lineTo(playerX + 5, playerY + 14);
        ctx.fillStyle = `hsl(${Math.random() * 30 + 15}, 100%, 60%)`;
        ctx.fill();

        // Cockpit with inner highlight
        ctx.fillStyle = '#ffeaa7';
        ctx.beginPath();
        ctx.arc(playerX, playerY - 6, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // Lasers
    function drawBullets() {
        ctx.save();
        for (let b of bullets) {
            // Layered laser glow without per-bullet shadowBlur
            ctx.fillStyle = 'rgba(255, 140, 0, 0.25)';
            ctx.fillRect(b.x - 4.5, b.y - 9, 9, 18);

            const grad = ctx.createLinearGradient(b.x, b.y - 7, b.x, b.y + 7);
            grad.addColorStop(0, '#fff4cc');
            grad.addColorStop(0.5, '#ff9f1a');
            grad.addColorStop(1, '#ff3838');
            ctx.fillStyle = grad;
            ctx.fillRect(b.x - 2.5, b.y - 7, 5, 14);
        }
        ctx.restore();
    }

    // Alien Invaders
    function drawEnemies() {
        for (let e of enemies) {
            ctx.save();
            // Fast ambient halo without shadowBlur
            ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
            ctx.beginPath();
            ctx.arc(e.x, e.y, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(e.x, e.y - 12);
            ctx.lineTo(e.x - 11, e.y + 6);
            ctx.lineTo(e.x - 4, e.y + 4);
            ctx.lineTo(e.x - 4, e.y + 9);
            ctx.lineTo(e.x, e.y + 4);
            ctx.lineTo(e.x + 4, e.y + 9);
            ctx.lineTo(e.x + 4, e.y + 4);
            ctx.lineTo(e.x + 11, e.y + 6);
            ctx.closePath();

            const grad = ctx.createLinearGradient(e.x - 8, e.y - 8, e.x + 8, e.y + 8);
            grad.addColorStop(0, '#ff4757');
            grad.addColorStop(1, '#800020');
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = '#ffa8a8';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Glowing Eyes
            ctx.fillStyle = '#ff7675';
            ctx.beginPath();
            ctx.arc(e.x - 4, e.y - 2, 2.8, 0, Math.PI * 2);
            ctx.arc(e.x + 4, e.y - 2, 2.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(e.x - 4.5, e.y - 2.5, 1, 0, Math.PI * 2);
            ctx.arc(e.x + 3.5, e.y - 2.5, 1, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    // Explosions
    function createExplosion(x, y, isBig) {
        const count = isBig ? 35 : 20;
        const colors = ['#ff8c00', '#ffd32a', '#ff3f34', '#ffffff', '#ff5e57'];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * (isBig ? 6 : 4) + 1;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 3 + 1.5,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: Math.floor(Math.random() * 20 + 15)
            });
        }
    }

    function drawParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            if (p.life <= 0) {
                particles.splice(i, 1);
                i--;
            }
        }
    }

    function drawCrosshair() {
        if (!gameRunning) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 140, 0, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        ctx.arc(targetX, playerY, 20, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(targetX - 25, playerY);
        ctx.lineTo(targetX + 25, playerY);
        ctx.moveTo(targetX, playerY - 25);
        ctx.lineTo(targetX, playerY + 25);
        ctx.stroke();

        ctx.restore();
    }

    // Score submission
    async function saveScoreToApi(finalScore, killCount) {
        try {
            const res = await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'spaceshooter',
                    score: finalScore,
                    moves: killCount
                })
            });
            const data = await res.json();
            if (data.success) {
                console.log('Space Shooter score saved:', data.score_id);
            }
        } catch (e) {
            console.error('Failed to save spaceshooter score:', e);
        }
    }

    function triggerGameOver() {
        gameRunning = false;
        createExplosion(playerX, playerY, true);
        playHitSound();

        const finalScoreEl = document.getElementById('finalScore');
        if (finalScoreEl) finalScoreEl.textContent = score;

        const overlay = document.getElementById('gameOverOverlay');
        if (overlay) overlay.style.display = 'flex';

        saveScoreToApi(score, kills);
    }

    // Update
    function updateGame() {
        if (!gameRunning) return;

        // Smooth follow
        playerX += (targetX - playerX) * 0.28;
        playerX = Math.max(20, Math.min(canvasWidth - 20, playerX));

        // Move bullets
        for (let i = 0; i < bullets.length; i++) {
            bullets[i].y -= bulletSpeed;
            if (bullets[i].y < -10) {
                bullets.splice(i, 1);
                i--;
            }
        }

        // Move enemies
        for (let i = 0; i < enemies.length; i++) {
            enemies[i].y += enemySpeed;
            if (enemies[i].y > canvasHeight + 30) {
                enemies.splice(i, 1);
                i--;
            }
        }

        // Bullet vs Enemy collision
        for (let i = 0; i < bullets.length; i++) {
            for (let j = 0; j < enemies.length; j++) {
                const dx = bullets[i].x - enemies[j].x;
                const dy = bullets[i].y - enemies[j].y;
                if (Math.sqrt(dx * dx + dy * dy) < 20) {
                    const ex = enemies[j].x;
                    const ey = enemies[j].y;
                    bullets.splice(i, 1);
                    enemies.splice(j, 1);

                    score += 10;
                    kills++;
                    createExplosion(ex, ey, false);
                    playExplosionSound();

                    const scEl = document.getElementById('scoreDisplay');
                    if (scEl) scEl.textContent = score;

                    if (score > highScore) {
                        highScore = score;
                        localStorage.setItem('spaceshooter_highscore', highScore);
                        const hsEl = document.getElementById('highScoreDisplay');
                        if (hsEl) hsEl.textContent = highScore;
                    }

                    i--;
                    break;
                }
            }
        }

        // Player vs Enemy collision
        for (let i = 0; i < enemies.length; i++) {
            const dx = playerX - enemies[i].x;
            const dy = playerY - enemies[i].y;
            if (Math.sqrt(dx * dx + dy * dy) < 26) {
                const ex = enemies[i].x;
                const ey = enemies[i].y;
                enemies.splice(i, 1);
                lives--;
                createExplosion(ex, ey, true);
                playHitSound();

                const lvEl = document.getElementById('livesDisplay');
                if (lvEl) lvEl.textContent = lives;

                if (lives <= 0) {
                    triggerGameOver();
                }
                i--;
            }
        }

        // Spawn timer
        if (enemySpawnTimer <= 0) {
            enemies.push({
                x: Math.random() * (canvasWidth - 70) + 35,
                y: -25
            });
            enemySpawnTimer = enemySpawnDelay;
            if (score > 600) enemySpawnDelay = 18;
            else if (score > 350) enemySpawnDelay = 24;
            else if (score > 150) enemySpawnDelay = 30;
        } else {
            enemySpawnTimer--;
        }

        if (shootCooldown > 0) shootCooldown--;
    }

    function shoot() {
        if (!gameRunning || isPaused) return;
        if (shootCooldown > 0) return;
        bullets.push({ x: playerX, y: playerY - 16 });
        shootCooldown = shootDelay;
        playLaserSound();
    }

    // Render loop
    function draw() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Cosmic backdrop gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
        bgGrad.addColorStop(0, '#050510');
        bgGrad.addColorStop(0.5, '#0a0a24');
        bgGrad.addColorStop(1, '#131332');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Ambient nebulae
        const amb1 = ctx.createRadialGradient(canvasWidth * 0.25, canvasHeight * 0.25, 0, canvasWidth * 0.25, canvasHeight * 0.25, canvasWidth * 0.6);
        amb1.addColorStop(0, 'rgba(88, 28, 135, 0.18)');
        amb1.addColorStop(1, 'transparent');
        ctx.fillStyle = amb1;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        const amb2 = ctx.createRadialGradient(canvasWidth * 0.75, canvasHeight * 0.75, 0, canvasWidth * 0.75, canvasHeight * 0.75, canvasWidth * 0.6);
        amb2.addColorStop(0, 'rgba(30, 58, 138, 0.15)');
        amb2.addColorStop(1, 'transparent');
        ctx.fillStyle = amb2;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        drawStars();
        drawEnemies();
        drawBullets();
        if (gameRunning) drawPlayer();
        drawParticles();
        drawCrosshair();
    }

    function gameLoop() {
        if (gameRunning && !isPaused) {
            updateGame();
            updateStars();
        }
        draw();
        animationId = requestAnimationFrame(gameLoop);
    }

    function togglePause() {
        if (!gameRunning) return;
        isPaused = !isPaused;
        const pauseOverlay = document.getElementById('pauseOverlay');
        const pauseIcon = document.getElementById('ssPauseIcon');
        if (pauseOverlay) pauseOverlay.style.display = isPaused ? 'flex' : 'none';
        if (pauseIcon) pauseIcon.className = isPaused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    }

    // Controls & Input
    function handleMove(clientX) {
        if (isPaused) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvasWidth / rect.width;
        let newX = (clientX - rect.left) * scaleX;
        targetX = Math.max(20, Math.min(canvasWidth - 20, newX));
    }

    function restart() {
        score = 0;
        lives = 3;
        kills = 0;
        gameRunning = true;
        isPaused = false;
        bullets = [];
        enemies = [];
        particles = [];
        enemySpawnTimer = 0;
        enemySpawnDelay = 38;
        shootCooldown = 0;

        const scEl = document.getElementById('scoreDisplay');
        if (scEl) scEl.textContent = '0';
        const lvEl = document.getElementById('livesDisplay');
        if (lvEl) lvEl.textContent = '3';
        const overlay = document.getElementById('gameOverOverlay');
        if (overlay) overlay.style.display = 'none';

        playerX = canvasWidth / 2;
        targetX = playerX;
    }

    function setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Tab hidden
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            e.preventDefault();
            handleMove(e.clientX);
        });

        canvas.addEventListener('click', (e) => {
            e.preventDefault();
            getAudioContext();
            shoot();
        });

        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            getAudioContext();
            const t = e.touches[0];
            if (t) {
                handleMove(t.clientX);
                shoot();
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = e.touches[0];
            if (t) handleMove(t.clientX);
        }, { passive: false });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                togglePause();
                return;
            }
            if (isPaused) return;
            if (e.code === 'Space') {
                e.preventDefault();
                getAudioContext();
                shoot();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                targetX = Math.max(20, targetX - 35);
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                targetX = Math.min(canvasWidth - 20, targetX + 35);
            }
        });

        const restartBtn = document.getElementById('restartBtn');
        if (restartBtn) {
            restartBtn.addEventListener('click', restart);
        }

        // Sound toggle
        const soundBtn = document.getElementById('ssSoundBtn') || document.getElementById('soundToggleBtn');
        const soundIcon = document.getElementById('ssSoundIcon') || document.getElementById('soundIcon');
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('spaceshooter_sound', soundEnabled);
                soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            });
        }

        // Pause button and Resume
        const pauseBtn = document.getElementById('ssPauseBtn');
        const resumeBtn = document.getElementById('resumeBtn');
        if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
        if (resumeBtn) resumeBtn.addEventListener('click', togglePause);

        // Fullscreen toggle
        const fullscreenBtn = document.getElementById('ssFullscreenBtn');
        const fullscreenIcon = document.getElementById('ssFullscreenIcon');
        const canvasWrapper = document.getElementById('spaceCanvasWrapper');
        if (fullscreenBtn && canvasWrapper) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    canvasWrapper.requestFullscreen().catch(() => {});
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

        window.addEventListener('resize', () => {
            resizeCanvas();
        });

        // Hide overlay instructions after 4 seconds
        setTimeout(() => {
            const inst = document.getElementById('instructionsOverlay');
            if (inst) {
                inst.style.opacity = '0';
                inst.style.transition = 'opacity 0.6s ease';
                setTimeout(() => { inst.style.display = 'none'; }, 600);
            }
        }, 4000);
    }

    function init() {
        resizeCanvas();
        const hsEl = document.getElementById('highScoreDisplay');
        if (hsEl) hsEl.textContent = highScore;

        setupEventListeners();
        gameLoop();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
