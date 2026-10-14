/**
 * static/js/games/lovemeter.js
 * Love Meter - Compatibility Calculator with animations & persistence (Task 22 Phase 2)
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

    let lmHistory = [];
    let lmTotalCalculations = 0;

    let lmName1, lmName2, lmCalcBtn, lmRandomBtn, lmResetBtn;
    let lmResultSection, lmProgressFill, lmResultMessage, lmResultDesc;
    let lmPercentageDisplay, lmBigHeart;
    let lmHistoryList, lmTotalCalcSpan;
    let soundEnabled = localStorage.getItem('lovemeter_sound') !== 'false';
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) audioCtx = new AudioCtxClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function playLoveChime(isHigh = false) {
        if (!soundEnabled) return;
        try {
            const ac = getAudioContext();
            if (!ac) return;
            const freqs = isHigh ? [523.25, 659.25, 783.99, 1046.50] : [392.00, 523.25, 659.25];
            freqs.forEach((freq, idx) => {
                const osc = ac.createOscillator();
                const gain = ac.createGain();
                osc.connect(gain);
                gain.connect(ac.destination);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, ac.currentTime + idx * 0.08);
                gain.gain.setValueAtTime(0.1, ac.currentTime + idx * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + idx * 0.08 + 0.35);
                osc.start(ac.currentTime + idx * 0.08);
                osc.stop(ac.currentTime + idx * 0.08 + 0.38);
            });
        } catch (e) {}
    }


    function loadSavedData() {
        try {
            const savedHistory = localStorage.getItem('lovemeter_history');
            const savedTotal = localStorage.getItem('lovemeter_total');
            if (savedHistory) lmHistory = JSON.parse(savedHistory);
            if (savedTotal) lmTotalCalculations = parseInt(savedTotal, 10) || 0;
        } catch (e) {
            lmHistory = [];
            lmTotalCalculations = 0;
        }
        renderHistory();
        updateTotalCount();
    }

    function saveData() {
        localStorage.setItem('lovemeter_history', JSON.stringify(lmHistory.slice(0, 15)));
        localStorage.setItem('lovemeter_total', lmTotalCalculations);
    }

    function updateTotalCount() {
        if (lmTotalCalcSpan) lmTotalCalcSpan.textContent = lmTotalCalculations;
    }

    function renderHistory() {
        if (!lmHistoryList) return;
        if (!lmHistory || lmHistory.length === 0) {
            lmHistoryList.innerHTML = '<div class="text-center py-3 text-muted small">No compatibility checks yet. Enter names above!</div>';
            return;
        }

        let html = '';
        lmHistory.slice(0, 10).forEach(item => {
            let badgeClass = 'bg-danger-subtle text-danger border border-danger-subtle';
            if (item.percentage >= 80) badgeClass = 'bg-danger text-white';
            else if (item.percentage >= 60) badgeClass = 'bg-warning-subtle text-warning border border-warning-subtle';

            html += `
                <div class="history-item d-flex align-items-center justify-content-between py-2 border-bottom border-secondary border-opacity-10">
                    <div class="d-flex align-items-center gap-2">
                        <span class="text-danger">❤️</span>
                        <span class="fw-semibold">${escapeHtml(item.name1)}</span>
                        <span class="text-muted small">&amp;</span>
                        <span class="fw-semibold">${escapeHtml(item.name2)}</span>
                    </div>
                    <span class="badge ${badgeClass} font-monospace px-2 py-1">${item.percentage}%</span>
                </div>
            `;
        });
        lmHistoryList.innerHTML = html;
    }

    // Deterministic love score algorithm
    function calculateCompatibility(raw1, raw2) {
        if (!raw1 || !raw2) return 0;
        const name1 = raw1.toLowerCase().trim().replace(/[^a-z]/g, '');
        const name2 = raw2.toLowerCase().trim().replace(/[^a-z]/g, '');
        if (!name1 || !name2) return 0;

        const combined = name1 + name2;
        const letterCount = {};
        for (let i = 0; i < combined.length; i++) {
            const ch = combined[i];
            letterCount[ch] = (letterCount[ch] || 0) + 1;
        }

        let score = 0;
        for (let ch in letterCount) {
            if (ch === 'l' || ch === 'o' || ch === 'v' || ch === 'e') {
                score += letterCount[ch] * 8;
            } else {
                score += letterCount[ch] * 2.2;
            }
        }

        const lenDiff = Math.abs(name1.length - name2.length);
        score += (10 - Math.min(lenDiff, 10)) * 4.5;

        // Same initials bonus
        if (name1[0] === name2[0]) score += 14;
        // Same ending letter bonus
        if (name1[name1.length - 1] === name2[name2.length - 1]) score += 10;

        // Hash-based seed for determinism between identical name pairs
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            hash = ((hash << 5) - hash) + combined.charCodeAt(i);
            hash |= 0;
        }
        const pseudoRand = Math.abs(hash % 15);
        score += pseudoRand;

        let percentage = Math.min(Math.floor(score), 95);
        percentage = Math.max(8, Math.min(percentage, 95));
        return percentage;
    }

    function getLoveMessage(pct) {
        if (pct >= 90) return { title: '💖 SOULMATES!', desc: 'A celestial match written in the cosmos! Inseparable chemistry!' };
        if (pct >= 80) return { title: '💕 TRUE LOVE!', desc: 'Amazing compatibility! You two bring out the best in each other.' };
        if (pct >= 70) return { title: '💗 STRONG CONNECTION!', desc: 'Great chemistry with fantastic romance potential!' };
        if (pct >= 60) return { title: '💓 PROMISING PAIR!', desc: 'Solid harmony with room for lasting spark.' };
        if (pct >= 50) return { title: '💛 BALANCED DUO!', desc: 'Good balance! Spend more quality time together.' };
        if (pct >= 35) return { title: '💙 FRIENDSHIP BASE!', desc: 'Best friends make the best lovers. Build on that foundation!' };
        return { title: '🤔 COMPLEX MIX!', desc: 'Opposites attract! Communication is your superpower.' };
    }

    function createFloatingHearts(count) {
        const hearts = ['💖', '💕', '💗', '❤️', '✨'];
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const h = document.createElement('div');
                h.className = 'love-floating-heart';
                h.style.cssText = `
                    position: fixed;
                    left: ${Math.random() * 85 + 5}%;
                    bottom: 20px;
                    font-size: ${Math.random() * 20 + 20}px;
                    pointer-events: none;
                    z-index: 9999;
                    animation: floatHeartUp 2s ease-out forwards;
                `;
                h.textContent = hearts[Math.floor(Math.random() * hearts.length)];
                document.body.appendChild(h);
                setTimeout(() => h.remove(), 2100);
            }, i * 60);
        }
    }

    function createConfetti() {
        const colors = ['#ff4d6d', '#ff8c00', '#ffd32a', '#a29bfe', '#ff7675'];
        for (let i = 0; i < 40; i++) {
            setTimeout(() => {
                const c = document.createElement('div');
                c.style.cssText = `
                    position: fixed;
                    top: 15%;
                    left: ${Math.random() * 90 + 5}%;
                    width: ${Math.random() * 8 + 4}px;
                    height: ${Math.random() * 8 + 4}px;
                    background: ${colors[Math.floor(Math.random() * colors.length)]};
                    border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                    pointer-events: none;
                    z-index: 9999;
                    animation: confettiFall 2.2s ease-out forwards;
                `;
                document.body.appendChild(c);
                setTimeout(() => c.remove(), 2300);
            }, i * 25);
        }
    }

    async function saveScoreToApi(pct) {
        try {
            await fetch('/api/games/save-score/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrftoken
                },
                body: JSON.stringify({
                    game_type: 'lovemeter',
                    score: pct
                })
            });
        } catch (e) {
            console.error('Failed to save love meter score:', e);
        }
    }

    function showResult(percentage) {
        playLoveChime(percentage >= 70);
        const msg = getLoveMessage(percentage);

        lmResultSection.style.display = 'block';
        lmResultSection.style.opacity = '1';
        lmResultMessage.textContent = msg.title;
        lmResultDesc.textContent = msg.desc;

        // Animated progress fill
        let currentWidth = 0;
        const widthTimer = setInterval(() => {
            currentWidth += 2;
            if (currentWidth >= percentage) {
                currentWidth = percentage;
                clearInterval(widthTimer);
            }
            lmProgressFill.style.width = currentWidth + '%';
            lmProgressFill.textContent = currentWidth + '%';
        }, 12);

        // Animated percent counter
        let currentPct = 0;
        const pctTimer = setInterval(() => {
            currentPct++;
            if (currentPct >= percentage) {
                currentPct = percentage;
                clearInterval(pctTimer);
                if (percentage >= 75) {
                    lmBigHeart.textContent = '💖';
                    createFloatingHearts(25);
                    createConfetti();
                } else if (percentage >= 50) {
                    lmBigHeart.textContent = '💕';
                    createFloatingHearts(15);
                } else {
                    lmBigHeart.textContent = '💗';
                    createFloatingHearts(8);
                }
            }
            lmPercentageDisplay.textContent = currentPct + '%';
        }, 18);

        // Heart pulse
        lmBigHeart.classList.remove('pulse-active');
        void lmBigHeart.offsetWidth;
        lmBigHeart.classList.add('pulse-active');
    }

    function doCalculate() {
        const name1 = (lmName1.value || '').trim();
        const name2 = (lmName2.value || '').trim();

        if (!name1 || !name2) {
            alert('Please enter both names to calculate compatibility!');
            return;
        }

        const percentage = calculateCompatibility(name1, name2);

        lmHistory.unshift({
            name1: name1,
            name2: name2,
            percentage: percentage,
            timestamp: new Date().toLocaleTimeString()
        });
        lmTotalCalculations++;

        saveData();
        renderHistory();
        updateTotalCount();
        showResult(percentage);
        saveScoreToApi(percentage);
    }

    function pickRandomName() {
        const samplePartners = [
            'Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam',
            'Casey', 'Riley', 'Jamie', 'Avery', 'Skyler',
            'Logan', 'Dakota', 'Reese', 'Rowan', 'Quinn'
        ];
        const r = samplePartners[Math.floor(Math.random() * samplePartners.length)];
        lmName2.value = r;
    }

    function resetHistory() {
        if (confirm('Clear all love meter history?')) {
            lmHistory = [];
            lmTotalCalculations = 0;
            saveData();
            renderHistory();
            updateTotalCount();
            if (lmResultSection) lmResultSection.style.display = 'none';
            if (lmPercentageDisplay) lmPercentageDisplay.textContent = '0%';
            if (lmBigHeart) lmBigHeart.textContent = '❤️';
        }
    }

    function init() {
        lmName1 = document.getElementById('lmName1');
        lmName2 = document.getElementById('lmName2');
        lmCalcBtn = document.getElementById('lmCalcBtn');
        lmRandomBtn = document.getElementById('lmRandomBtn');
        lmResetBtn = document.getElementById('lmResetBtn');
        lmResultSection = document.getElementById('lmResultSection');
        lmProgressFill = document.getElementById('lmProgressFill');
        lmResultMessage = document.getElementById('lmResultMessage');
        lmResultDesc = document.getElementById('lmResultDesc');
        lmPercentageDisplay = document.getElementById('lmPercentageDisplay');
        lmBigHeart = document.getElementById('lmBigHeart');
        lmHistoryList = document.getElementById('lmHistoryList');
        lmTotalCalcSpan = document.getElementById('lmTotalCalc');

        loadSavedData();

        if (lmCalcBtn) lmCalcBtn.addEventListener('click', doCalculate);
        if (lmRandomBtn) lmRandomBtn.addEventListener('click', pickRandomName);
        if (lmResetBtn) lmResetBtn.addEventListener('click', resetHistory);
        // Sound toggle
        const soundBtn = document.getElementById('lmSoundBtn');
        const soundIcon = document.getElementById('lmSoundIcon');
        if (soundBtn && soundIcon) {
            soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            soundBtn.addEventListener('click', () => {
                soundEnabled = !soundEnabled;
                localStorage.setItem('lovemeter_sound', soundEnabled);
                soundIcon.className = soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
            });
        }

        // Fullscreen toggle
        const fullscreenBtn = document.getElementById('lmFullscreenBtn');
        const fullscreenIcon = document.getElementById('lmFullscreenIcon');
        const arena = document.getElementById('lovemeterArena');
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


        if (lmName1) lmName1.addEventListener('keypress', (e) => { if (e.key === 'Enter') doCalculate(); });
        if (lmName2) lmName2.addEventListener('keypress', (e) => { if (e.key === 'Enter') doCalculate(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
