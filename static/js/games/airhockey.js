/**
 * static/js/games/airhockey.js
 * Air Hockey - 60 FPS Physics Simulation Table Game (AI & 2P Local)
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

    const canvas = document.getElementById('hockeyCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const arenaContainer = document.getElementById('hockeyArenaContainer');

    const W = 400;
    const H = 680;
    canvas.width = W;
    canvas.height = H;

    // Audio effects
    let audioCtx = null;
    let soundEnabled = localStorage.getItem('airhockey_sound') !== 'false';
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playHitTone(freq = 440, duration = 0.06, gainVal = 0.12) {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ac.currentTime);
            gain.gain.setValueAtTime(gainVal, ac.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
            osc.start();
            osc.stop(ac.currentTime + duration + 0.01);
        } catch (e) {}
    }

    // Game Table Parameters
    const GOAL_WIDTH = 150;
    const GOAL_LEFT = (W - GOAL_WIDTH) / 2;
    const GOAL_RIGHT = GOAL_LEFT + GOAL_WIDTH;
    const WIN_SCORE = 7;

    // Game State
    let difficulty = 'med'; // 'easy' | 'med' | 'hard' | '2p'
    let isGameOver = false;
    let scoreP1 = 0; // Bottom player (Blue)
    let scoreP2 = 0; // Top player / AI (Red)
    let isGoalPaused = false;
    let goalBannerTimer = null;

    // Puck
    const puck = {
        x: W / 2,
        y: H / 2,
        vx: 0,
        vy: 0,
        r: 16,
        friction: 0.988,
        maxSpeed: 19,
        cornerFrames: 0
    };

    // Mallet 1 (Bottom - Blue)
    const mallet1 = {
        x: W / 2,
        y: H - 100,
        r: 26,
        vx: 0,
        vy: 0,
        prevX: W / 2,
        prevY: H - 100
    };

    // Mallet 2 (Top - Red)
    const mallet2 = {
        x: W / 2,
        y: 100,
        r: 26,
        vx: 0,
        vy: 0,
        prevX: W / 2,
        prevY: 100
    };

    // DOM Elements
    const scorePlayerEl = document.getElementById('scorePlayer');
    const scoreOpponentEl = document.getElementById('scoreOpponent');
    const gameOverOverlay = document.getElementById('hockeyGameOverOverlay');
    const winnerTextEl = document.getElementById('hockeyWinnerText');
    const subTextEl = document.getElementById('hockeySubText');
    const playAgainBtn = document.getElementById('hockeyPlayAgainBtn');
    const goalBanner = document.getElementById('goalBanner');
    const soundBtn = document.getElementById('hockeySoundBtn');
    const soundIcon = document.getElementById('hockeySoundIcon');
    const fullscreenBtn = document.getElementById('hockeyFullscreenBtn');
    const fullscreenIcon = document.getElementById('hockeyFullscreenIcon');
    const restartHeaderBtn = document.getElementById('hockeyRestartHeaderBtn');

    const btnDiffEasy = document.getElementById('btnDiffEasy');
    const btnDiffMed = document.getElementById('btnDiffMed');
    const btnDiffHard = document.getElementById('btnDiffHard');
    const btnMode2P = document.getElementById('btnMode2P');

    function resetPuck(scorer) {
        puck.x = W / 2;
        puck.y = scorer === 'p1' ? H / 2 + 60 : H / 2 - 60;
        puck.vx = 0;
        puck.vy = 0;
        puck.cornerFrames = 0;
        mallet1.x = W / 2;
        mallet1.y = H - 90;
        mallet2.x = W / 2;
        mallet2.y = 90;
    }

    function resetMatch() {
        scoreP1 = 0;
        scoreP2 = 0;
        isGameOver = false;
        isGoalPaused = false;
        if (scorePlayerEl) scorePlayerEl.textContent = '0';
        if (scoreOpponentEl) scoreOpponentEl.textContent = '0';
        if (gameOverOverlay) gameOverOverlay.style.display = 'none';
        resetPuck('p1');
    }

    function showGoalBanner() {
        if (!goalBanner) return;
        goalBanner.style.display = 'block';
        if (goalBannerTimer) clearTimeout(goalBannerTimer);
        goalBannerTimer = setTimeout(() => {
            goalBanner.style.display = 'none';
        }, 800);
    }

    async function saveScoreToApi(finalScore, winner) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'airhockey',
                    score: finalScore,
                    winner: winner === 'p1' ? 'white' : 'red',
                    moves: scoreP1 + scoreP2
                })
            });
        } catch (e) {
            console.error('Failed to save air hockey score:', e);
        }
    }

    function checkGameOver() {
        if (scoreP1 >= WIN_SCORE || scoreP2 >= WIN_SCORE) {
            isGameOver = true;
            const p1Won = scoreP1 >= WIN_SCORE;
            const points = p1Won ? (WIN_SCORE - scoreP2) * 150 : 50;

            if (winnerTextEl) {
                winnerTextEl.textContent = p1Won ? '🎉 You Win!' : 'Game Over!';
                winnerTextEl.style.color = p1Won ? '#60a5fa' : '#ef4444';
            }
            if (subTextEl) {
                subTextEl.textContent = `Final Score: ${scoreP1} - ${scoreP2} (${points} pts)`;
            }
            if (gameOverOverlay) gameOverOverlay.style.display = 'flex';

            saveScoreToApi(points, p1Won ? 'p1' : 'p2');
        }
    }

    function handleGoal(scoredBy) {
        isGoalPaused = true;
        playHitTone(580, 0.25, 0.2);
        showGoalBanner();

        if (scoredBy === 'p1') {
            scoreP1++;
            if (scorePlayerEl) scorePlayerEl.textContent = scoreP1;
        } else {
            scoreP2++;
            if (scoreOpponentEl) scoreOpponentEl.textContent = scoreP2;
        }

        setTimeout(() => {
            resetPuck(scoredBy);
            isGoalPaused = false;
            checkGameOver();
        }, 900);
    }

    // AI Bot Behavior
    function updateAi() {
        if (difficulty === '2p') return;

        let maxSpeed = 4.2;
        let reactionZone = H * 0.48;

        if (difficulty === 'easy') {
            maxSpeed = 3.2;
            reactionZone = H * 0.35;
        } else if (difficulty === 'hard') {
            maxSpeed = 6.2;
            reactionZone = H * 0.5;
        }

        // Home base target
        let targetX = W / 2;
        let targetY = 100;

        if (puck.y < reactionZone) {
            targetX = puck.x;
            targetY = Math.min(puck.y - 10, H / 2 - mallet2.r - 5);
        }

        const dx = targetX - mallet2.x;
        const dy = targetY - mallet2.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 1) {
            const moveDist = Math.min(dist, maxSpeed);
            mallet2.vx = (dx / dist) * moveDist;
            mallet2.vy = (dy / dist) * moveDist;
        } else {
            mallet2.vx = 0;
            mallet2.vy = 0;
        }

        mallet2.x += mallet2.vx;
        mallet2.y += mallet2.vy;

        // Keep AI in top half
        mallet2.x = Math.max(mallet2.r + 5, Math.min(W - mallet2.r - 5, mallet2.x));
        mallet2.y = Math.max(mallet2.r + 5, Math.min(H / 2 - mallet2.r - 5, mallet2.y));
    }

    // Elastic Collision between Mallet and Puck
    function handleMalletCollision(m) {
        const dx = puck.x - m.x;
        const dy = puck.y - m.y;
        const dist = Math.hypot(dx, dy);
        const minDist = puck.r + m.r;

        if (dist < minDist) {
            const nx = dx / (dist || 1);
            const ny = dy / (dist || 1);

            // Separate
            const overlap = minDist - dist;
            puck.x += nx * overlap;
            puck.y += ny * overlap;

            // Velocity impulse
            const malletSpeedX = m.vx || 0;
            const malletSpeedY = m.vy || 0;

            puck.vx = nx * 10 + malletSpeedX * 0.75;
            puck.vy = ny * 10 + malletSpeedY * 0.75;

            // Clamp max speed
            const speed = Math.hypot(puck.vx, puck.vy);
            if (speed > puck.maxSpeed) {
                puck.vx = (puck.vx / speed) * puck.maxSpeed;
                puck.vy = (puck.vy / speed) * puck.maxSpeed;
            }

            playHitTone(320 + Math.min(speed * 18, 300), 0.06);
        }
    }

    function updatePhysics() {
        if (isGameOver || isGoalPaused) return;

        // Calculate mallet1 velocity from user pointer
        mallet1.vx = mallet1.x - mallet1.prevX;
        mallet1.vy = mallet1.y - mallet1.prevY;
        mallet1.prevX = mallet1.x;
        mallet1.prevY = mallet1.y;

        // Move AI
        updateAi();

        // Move Puck
        puck.vx *= puck.friction;
        puck.vy *= puck.friction;
        puck.x += puck.vx;
        puck.y += puck.vy;

        // Wall collisions (Left & Right)
        if (puck.x - puck.r <= 6) {
            puck.x = puck.r + 6;
            puck.vx = -puck.vx * 0.92;
            playHitTone(220, 0.04);
        } else if (puck.x + puck.r >= W - 6) {
            puck.x = W - 6 - puck.r;
            puck.vx = -puck.vx * 0.92;
            playHitTone(220, 0.04);
        }

        // Top Wall & Goal
        if (puck.y - puck.r <= 6) {
            if (puck.x >= GOAL_LEFT && puck.x <= GOAL_RIGHT) {
                handleGoal('p1');
                return;
            } else {
                puck.y = puck.r + 6;
                puck.vy = -puck.vy * 0.92;
                playHitTone(220, 0.04);
            }
        }

        // Bottom Wall & Goal
        if (puck.y + puck.r >= H - 6) {
            if (puck.x >= GOAL_LEFT && puck.x <= GOAL_RIGHT) {
                handleGoal('p2');
                return;
            } else {
                puck.y = H - 6 - puck.r;
                puck.vy = -puck.vy * 0.92;
                playHitTone(220, 0.04);
            }
        }

        handleMalletCollision(mallet1);
        handleMalletCollision(mallet2);

        // Robust corner unstick timer: If trapped in either corner region for ~0.4s (25 frames), reset to center
        puck.cornerFrames = puck.cornerFrames || 0;
        const inCorner = (puck.x < 65 || puck.x > canvas.width - 65) && (puck.y < 65 || puck.y > canvas.height - 65);
        if (inCorner) {
            puck.cornerFrames++;
            if (puck.cornerFrames > 25) { // ~0.4 seconds trapped in corner
                puck.x = canvas.width / 2;
                puck.y = canvas.height / 2;
                puck.vx = (Math.random() > 0.5 ? 1 : -1) * 5;
                puck.vy = (Math.random() > 0.5 ? 1 : -1) * 5;
                puck.cornerFrames = 0;
                playHitTone(380, 0.08);
            }
        } else {
            puck.cornerFrames = 0;
        }
    }

    // High performance table rendering (No ctx.shadowBlur in 60 FPS loop)
    function draw() {
        // Table surface
        ctx.fillStyle = '#060919';
        ctx.fillRect(0, 0, W, H);

        // Center line
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        // Center face-off circle
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, 55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fill();

        // Goal arcs
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.beginPath();
        ctx.arc(W / 2, 0, 75, 0, Math.PI);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.beginPath();
        ctx.arc(W / 2, H, 75, Math.PI, 0);
        ctx.stroke();

        // Goals slots
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(GOAL_LEFT, 0, GOAL_WIDTH, 6);
        ctx.fillRect(GOAL_LEFT, H - 6, GOAL_WIDTH, 6);

        // Draw Mallet 2 (Top - Red)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.beginPath();
        ctx.arc(mallet2.x, mallet2.y, mallet2.r + 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(mallet2.x, mallet2.y, mallet2.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw Mallet 1 (Bottom - Blue)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.beginPath();
        ctx.arc(mallet1.x, mallet1.y, mallet1.r + 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(mallet1.x, mallet1.y, mallet1.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw Puck (Yellow neon glow)
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, puck.r + 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function gameLoop() {
        updatePhysics();
        draw();
        requestAnimationFrame(gameLoop);
    }

    function handlePointer(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;

        const targetX = (clientX - rect.left) * scaleX;
        const targetY = (clientY - rect.top) * scaleY;

        // Player restricted to bottom half
        mallet1.x = Math.max(mallet1.r + 5, Math.min(W - mallet1.r - 5, targetX));
        mallet1.y = Math.max(H / 2 + mallet1.r + 5, Math.min(H - mallet1.r - 5, targetY));
    }

    function handlePointer2P(clientX, clientY) {
        if (difficulty !== '2p') return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;

        const targetX = (clientX - rect.left) * scaleX;
        const targetY = (clientY - rect.top) * scaleY;

        // Top player restricted to top half
        mallet2.x = Math.max(mallet2.r + 5, Math.min(W - mallet2.r - 5, targetX));
        mallet2.y = Math.max(mallet2.r + 5, Math.min(H / 2 - mallet2.r - 5, targetY));
    }

    function setupEventListeners() {
        canvas.addEventListener('mousemove', (e) => {
            handlePointer(e.clientX, e.clientY);
        });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                const rect = canvas.getBoundingClientRect();
                const ty = (t.clientY - rect.top) * (H / rect.height);
                if (ty > H / 2) {
                    handlePointer(t.clientX, t.clientY);
                } else if (difficulty === '2p') {
                    handlePointer2P(t.clientX, t.clientY);
                }
            }
        }, { passive: false });

        if (playAgainBtn) playAgainBtn.addEventListener('click', resetMatch);
        if (restartHeaderBtn) restartHeaderBtn.addEventListener('click', resetMatch);

        // Sound toggle
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('airhockey_sound', soundEnabled);
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

        // Mode and difficulty buttons
        function setDiff(d, btn) {
            difficulty = d;
            [btnDiffEasy, btnDiffMed, btnDiffHard, btnMode2P].forEach(b => b?.classList.remove('active'));
            btn?.classList.add('active');
            resetMatch();
        }

        if (btnDiffEasy) btnDiffEasy.addEventListener('click', () => setDiff('easy', btnDiffEasy));
        if (btnDiffMed) btnDiffMed.addEventListener('click', () => setDiff('med', btnDiffMed));
        if (btnDiffHard) btnDiffHard.addEventListener('click', () => setDiff('hard', btnDiffHard));
        if (btnMode2P) btnMode2P.addEventListener('click', () => setDiff('2p', btnMode2P));
    }

    function init() {
        setupEventListeners();
        resetMatch();
        requestAnimationFrame(gameLoop);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
