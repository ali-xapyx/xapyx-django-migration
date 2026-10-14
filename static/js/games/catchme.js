/**
 * static/js/games/catchme.js
 * Catch Me If You Can - High Precision Stopwatch Reflex Game (Task 22 Phase 2)
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

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    const MAX_TIME = 15;
    const CIRCUMFERENCE = 565.48; // 2 * PI * 90

    let cmiycRunning = false;
    let cmiycStartTime = 0;
    let cmiycCurrentTime = 0;
    let cmiycInterval = null;
    let cmiycTarget = 7.00;

    let cmiycScore = 0;
    let cmiycStreak = 0;
    let cmiycBest = 0;
    let cmiycHistory = [];

    // DOM Elements
    let targetEl, timerEl, progressEl;
    let scoreEl, streakEl, bestEl;
    let startBtn, stopBtn, resetBtn, resetAllBtn;
    let feedbackEl, historyListEl;
    let soundEnabled = localStorage.getItem('catchme_sound') !== 'false';
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playCatchTone(type = 'tick') {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const osc = ac.createOscillator();
            const gain = ac.createGain();
            osc.connect(gain);
            gain.connect(ac.destination);

            if (type === 'tick') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, ac.currentTime);
                gain.gain.setValueAtTime(0.04, ac.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.03);
                osc.start();
                osc.stop(ac.currentTime + 0.04);
            } else if (type === 'perfect') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(523.25, ac.currentTime);
                osc.frequency.setValueAtTime(659.25, ac.currentTime + 0.08);
                osc.frequency.setValueAtTime(783.99, ac.currentTime + 0.16);
                gain.gain.setValueAtTime(0.12, ac.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
                osc.start();
                osc.stop(ac.currentTime + 0.38);
            } else if (type === 'close') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, ac.currentTime);
                osc.frequency.setValueAtTime(659.25, ac.currentTime + 0.1);
                gain.gain.setValueAtTime(0.1, ac.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
                osc.start();
                osc.stop(ac.currentTime + 0.27);
            } else if (type === 'miss') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, ac.currentTime);
                osc.frequency.exponentialRampToValueAtTime(110, ac.currentTime + 0.25);
                gain.gain.setValueAtTime(0.1, ac.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
                osc.start();
                osc.stop(ac.currentTime + 0.28);
            }
        } catch (e) {}
    }


    function loadData() {
        try {
            const sS = localStorage.getItem('cmiyc_score');
            const sST = localStorage.getItem('cmiyc_streak');
            const sB = localStorage.getItem('cmiyc_best');
            const sH = localStorage.getItem('cmiyc_history');
            const sT = localStorage.getItem('cmiyc_target');

            if (sS) cmiycScore = parseInt(sS, 10) || 0;
            if (sST) cmiycStreak = parseInt(sST, 10) || 0;
            if (sB) cmiycBest = parseInt(sB, 10) || 0;
            if (sT) cmiycTarget = parseFloat(sT) || 7.00;
            if (sH) cmiycHistory = JSON.parse(sH) || [];
        } catch (e) {
            cmiycHistory = [];
        }

        updateStatsDisplay();
        renderHistory();
        if (targetEl) targetEl.textContent = cmiycTarget.toFixed(2);
    }

    function saveData() {
        localStorage.setItem('cmiyc_score', cmiycScore);
        localStorage.setItem('cmiyc_streak', cmiycStreak);
        localStorage.setItem('cmiyc_best', cmiycBest);
        localStorage.setItem('cmiyc_target', cmiycTarget);
        localStorage.setItem('cmiyc_history', JSON.stringify(cmiycHistory.slice(0, 15)));
    }

    function generateNewTarget() {
        // Random target between 7.00 and 14.50 seconds
        const randomSeconds = Math.floor(Math.random() * 8) + 7;
        const randomHundredths = Math.floor(Math.random() * 10) * 10;
        cmiycTarget = randomSeconds + (randomHundredths / 100);

        if (targetEl) {
            targetEl.textContent = cmiycTarget.toFixed(2);
            targetEl.classList.add('pulse-active');
            setTimeout(() => targetEl.classList.remove('pulse-active'), 400);
        }
        saveData();
    }

    function updateStatsDisplay() {
        if (scoreEl) scoreEl.textContent = cmiycScore;
        if (streakEl) streakEl.textContent = cmiycStreak;
        if (bestEl) bestEl.textContent = cmiycBest;
    }

    function updateTimerDisplay() {
        if (timerEl) timerEl.textContent = cmiycCurrentTime.toFixed(2);

        if (progressEl) {
            const progress = Math.min(cmiycCurrentTime / MAX_TIME, 1);
            const offset = CIRCUMFERENCE - (progress * CIRCUMFERENCE);
            progressEl.style.strokeDashoffset = offset;

            if (cmiycCurrentTime > cmiycTarget + 0.1) {
                progressEl.style.stroke = '#ef4444';
            } else if (cmiycCurrentTime >= cmiycTarget - 0.5) {
                progressEl.style.stroke = '#f59e0b';
            } else {
                progressEl.style.stroke = '#ff8c00';
            }
        }
    }

    function resetProgressCircle() {
        if (progressEl) {
            progressEl.style.strokeDashoffset = CIRCUMFERENCE;
            progressEl.style.stroke = '#ff8c00';
        }
    }

    function renderHistory() {
        if (!historyListEl) return;
        if (!cmiycHistory || cmiycHistory.length === 0) {
            historyListEl.innerHTML = '<div class="text-center py-3 text-muted small">No attempts yet. Click START to begin!</div>';
            return;
        }

        let html = '';
        cmiycHistory.slice(0, 10).forEach(item => {
            const isWin = item.win;
            const badgeClass = isWin
                ? (item.perfect ? 'bg-success text-white' : 'bg-warning-subtle text-warning border border-warning-subtle')
                : 'bg-danger-subtle text-danger border border-danger-subtle';

            const statusText = isWin
                ? (item.perfect ? `🎯 PERFECT (+${item.points})` : `⚡ CLOSE (+${item.points})`)
                : `❌ MISSED (${item.diff > 0 ? '+' : ''}${item.diff.toFixed(2)}s)`;

            html += `
                <div class="history-item d-flex align-items-center justify-content-between py-2 border-bottom border-secondary border-opacity-10">
                    <div class="d-flex align-items-center gap-2">
                        <span class="font-monospace text-muted small">🎯 ${item.target.toFixed(2)}s</span>
                        <span class="text-muted small">&rarr;</span>
                        <span class="font-monospace fw-semibold">${item.stopped.toFixed(2)}s</span>
                    </div>
                    <span class="badge ${badgeClass} font-monospace px-2 py-1">${statusText}</span>
                </div>
            `;
        });
        historyListEl.innerHTML = html;
    }

    function createConfetti() {
        const colors = ['#ff8c00', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899'];
        for (let i = 0; i < 40; i++) {
            setTimeout(() => {
                const c = document.createElement('div');
                c.style.cssText = `
                    position: fixed;
                    top: 20%;
                    left: ${Math.random() * 90 + 5}%;
                    width: ${Math.random() * 8 + 4}px;
                    height: ${Math.random() * 8 + 4}px;
                    background: ${colors[Math.floor(Math.random() * colors.length)]};
                    border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                    pointer-events: none;
                    z-index: 9999;
                    animation: confettiFall 2s ease-out forwards;
                `;
                document.body.appendChild(c);
                setTimeout(() => c.remove(), 2100);
            }, i * 20);
        }
    }

    function showFeedback(message, type) {
        if (!feedbackEl) return;
        feedbackEl.className = `catchme-feedback text-center my-3 alert alert-${type}`;
        feedbackEl.innerHTML = message;
        feedbackEl.style.display = 'block';
    }

    async function saveScoreToApi(scoreToSave, durationSec) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'catchme',
                    score: scoreToSave,
                    duration: durationSec
                })
            });
        } catch (e) {
            console.error('Failed to save Catch Me score:', e);
        }
    }

    function startTimer() {
        if (cmiycRunning) return;
        cmiycCurrentTime = 0;
        updateTimerDisplay();
        cmiycRunning = true;
        cmiycStartTime = performance.now();
        playCatchTone('tick');

        if (feedbackEl) feedbackEl.style.display = 'none';

        if (cmiycInterval) clearInterval(cmiycInterval);
        cmiycInterval = setInterval(() => {
            const now = performance.now();
            cmiycCurrentTime = (now - cmiycStartTime) / 1000;
            if (cmiycCurrentTime >= MAX_TIME) {
                stopTimer(true);
            }
            updateTimerDisplay();
        }, 10);

        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = true;
    }

    function stopTimer(autoTimeout = false) {
        if (!cmiycRunning) return;
        if (cmiycInterval) {
            clearInterval(cmiycInterval);
            cmiycInterval = null;
        }
        cmiycRunning = false;

        const stoppedTime = autoTimeout ? MAX_TIME : cmiycCurrentTime;
        const diff = stoppedTime - cmiycTarget;
        const absDiff = Math.abs(diff);

        let isWin = false;
        let isPerfect = false;
        let points = 0;

        if (absDiff <= 0.05 && !autoTimeout) {
            isWin = true;
            isPerfect = true;
            points = 100;
            cmiycScore += points;
            cmiycStreak++;
            if (cmiycScore > cmiycBest) cmiycBest = cmiycScore;
            showFeedback(`🎯 <strong>PERFECT CATCH!</strong> Exactly ${stoppedTime.toFixed(2)}s (+100 pts)`, 'success');
            playCatchTone('perfect');
            createConfetti();
        } else if (absDiff <= 0.20 && !autoTimeout) {
            isWin = true;
            points = 25;
            cmiycScore += points;
            cmiycStreak++;
            if (cmiycScore > cmiycBest) cmiycBest = cmiycScore;
            showFeedback(`⚡ <strong>SO CLOSE!</strong> Stopped at ${stoppedTime.toFixed(2)}s (+25 pts)`, 'warning');
            playCatchTone('close');
        } else {
            cmiycStreak = 0;
            if (autoTimeout) {
                showFeedback(`⏰ <strong>TIME'S UP!</strong> Exceeded ${MAX_TIME}s`, 'danger');
                playCatchTone('miss');
            } else {
                const hint = diff > 0 ? `${diff.toFixed(2)}s late` : `${Math.abs(diff).toFixed(2)}s early`;
                showFeedback(`❌ <strong>MISSED!</strong> Target was ${cmiycTarget.toFixed(2)}s (${hint})`, 'danger');
                playCatchTone('miss');
            }
        }

        cmiycHistory.unshift({
            target: cmiycTarget,
            stopped: stoppedTime,
            diff: diff,
            win: isWin,
            perfect: isPerfect,
            points: points,
            timestamp: new Date().toLocaleTimeString()
        });

        saveData();
        updateStatsDisplay();
        renderHistory();

        if (isWin) {
            saveScoreToApi(cmiycScore, Math.round(stoppedTime));
        }

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (resetBtn) resetBtn.disabled = false;

        // Auto new target after 2 seconds
        setTimeout(() => {
            if (!cmiycRunning) {
                generateNewTarget();
            }
        }, 2200);
    }

    function resetTimer() {
        if (cmiycInterval) {
            clearInterval(cmiycInterval);
            cmiycInterval = null;
        }
        cmiycRunning = false;
        cmiycCurrentTime = 0;
        updateTimerDisplay();
        resetProgressCircle();
        if (feedbackEl) feedbackEl.style.display = 'none';

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (resetBtn) resetBtn.disabled = false;
    }

    function resetAllStats() {
        if (confirm('Reset your Catch Me If You Can score, streak, and history?')) {
            cmiycScore = 0;
            cmiycStreak = 0;
            cmiycBest = 0;
            cmiycHistory = [];
            saveData();
            updateStatsDisplay();
            renderHistory();
            resetTimer();
            generateNewTarget();
        }
    }

    function init() {
        targetEl = document.getElementById('cmiycTarget');
        timerEl = document.getElementById('cmiycTimer');
        progressEl = document.getElementById('cmiycTimerProgress');
        scoreEl = document.getElementById('cmiycScore');
        streakEl = document.getElementById('cmiycStreak');
        bestEl = document.getElementById('cmiycBest');
        startBtn = document.getElementById('cmiycStart');
        stopBtn = document.getElementById('cmiycStop');
        resetBtn = document.getElementById('cmiycReset');
        resetAllBtn = document.getElementById('cmiycResetAllBtn');
        feedbackEl = document.getElementById('cmiycFeedback');
        historyListEl = document.getElementById('cmiycHistoryList');

        loadData();

        if (startBtn) startBtn.addEventListener('click', startTimer);
        if (stopBtn) stopBtn.addEventListener('click', () => stopTimer(false));
        if (resetBtn) resetBtn.addEventListener('click', resetTimer);
        if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllStats);
        // Sound toggle
        const soundBtn = document.getElementById('cmSoundBtn');
        const soundIcon = document.getElementById('cmSoundIcon');
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('catchme_sound', soundEnabled);
                soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            });
        }

        // Fullscreen toggle
        const fullscreenBtn = document.getElementById('cmFullscreenBtn');
        const fullscreenIcon = document.getElementById('cmFullscreenIcon');
        const arena = document.getElementById('catchmeArena');
        if (fullscreenBtn && arena) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    arena.requestFullscreen().catch(() => {});
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


        // Keyboard Spacebar to start/stop
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                if (!cmiycRunning && !startBtn.disabled) {
                    startTimer();
                } else if (cmiycRunning && !stopBtn.disabled) {
                    stopTimer(false);
                }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
