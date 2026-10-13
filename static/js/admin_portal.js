/**
 * XAPYX Admin Portal -- Real-Time Metrics & Dashboard Poller (Phase 1)
 */

(function () {
    'use strict';

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    const refreshBtn = document.getElementById('refreshMetricsBtn');
    const refreshIcon = document.getElementById('refreshIcon');
    const lastUpdatedBadge = document.getElementById('lastUpdatedBadge');

    const statTicketsTotal = document.getElementById('statTicketsTotal');
    const statTicketsOpen = document.getElementById('statTicketsOpen');
    const statTicketsInProgress = document.getElementById('statTicketsInProgress');
    const statTicketsResolved = document.getElementById('statTicketsResolved');
    const statUsersTotal = document.getElementById('statUsersTotal');

    const ticketsTbody = document.getElementById('latestTicketsTbody');
    const usersTbody = document.getElementById('latestUsersTbody');

    async function fetchMetrics() {
        if (refreshIcon) refreshIcon.classList.add('fa-spin');

        try {
            const res = await fetch('/portal-admin/api/metrics/', {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!res.ok) {
                if (res.status === 401) {
                    window.location.href = '/portal-admin/login/';
                    return;
                }
                throw new Error('Failed to fetch metrics');
            }

            const data = await res.json();
            if (data.success) {
                renderMetrics(data);
                if (lastUpdatedBadge && data.timestamp) {
                    lastUpdatedBadge.textContent = 'Updated at ' + data.timestamp;
                }
            }
        } catch (err) {
            console.error('[Admin Portal] Error refreshing metrics:', err);
        } finally {
            if (refreshIcon) {
                setTimeout(() => {
                    refreshIcon.classList.remove('fa-spin');
                }, 400);
            }
        }
    }

    function renderMetrics(data) {
        const m = data.metrics || {};
        if (statTicketsTotal) statTicketsTotal.textContent = m.tickets_total || 0;
        if (statTicketsOpen) statTicketsOpen.textContent = m.tickets_open || 0;
        if (statTicketsInProgress) statTicketsInProgress.textContent = m.tickets_in_progress || 0;
        if (statTicketsResolved) statTicketsResolved.textContent = m.tickets_resolved || 0;
        if (statUsersTotal) statUsersTotal.textContent = m.users_total || 0;

        // Render latest tickets
        if (ticketsTbody && Array.isArray(data.latest_5_tickets)) {
            if (data.latest_5_tickets.length === 0) {
                ticketsTbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-muted">
                            <i class="fas fa-inbox fa-2x mb-2 d-block opacity-50"></i>
                            No support tickets found
                        </td>
                    </tr>
                `;
            } else {
                ticketsTbody.innerHTML = data.latest_5_tickets.map(t => {
                    let urgencyBadge = '<span class="badge bg-primary">Medium</span>';
                    if (t.urgency === 'critical') urgencyBadge = '<span class="badge bg-danger">Critical</span>';
                    else if (t.urgency === 'high') urgencyBadge = '<span class="badge bg-warning text-dark">High</span>';
                    else if (t.urgency === 'low') urgencyBadge = '<span class="badge bg-secondary">Low</span>';

                    let statusBadge = `<span class="badge bg-secondary-subtle text-secondary">${escapeHtml(t.status)}</span>`;
                    if (t.status === 'open') statusBadge = '<span class="badge bg-warning-subtle text-warning">Open</span>';
                    else if (t.status === 'in_progress') statusBadge = '<span class="badge bg-info-subtle text-info">In Progress</span>';
                    else if (t.status === 'resolved') statusBadge = '<span class="badge bg-success-subtle text-success">Resolved</span>';

                    return `
                        <tr>
                            <td class="fw-bold text-muted">#${escapeHtml(String(t.id))}</td>
                            <td>
                                <div class="fw-semibold text-truncate" style="max-width: 180px;" title="${escapeHtml(t.subject)}">
                                    ${escapeHtml(t.subject)}
                                </div>
                            </td>
                            <td>
                                <div class="small fw-semibold">${escapeHtml(t.user_name)}</div>
                                <div class="text-muted" style="font-size: 0.75rem;">${escapeHtml(t.user_email)}</div>
                            </td>
                            <td>${urgencyBadge}</td>
                            <td>${statusBadge}</td>
                            <td class="text-muted small">${escapeHtml(t.created_at)}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // Render latest users
        if (usersTbody && Array.isArray(data.latest_5_users)) {
            if (data.latest_5_users.length === 0) {
                usersTbody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center py-4 text-muted">
                            <i class="fas fa-users-slash fa-2x mb-2 d-block opacity-50"></i>
                            No users found
                        </td>
                    </tr>
                `;
            } else {
                usersTbody.innerHTML = data.latest_5_users.map(u => {
                    const initial = (u.name || u.username || 'U').charAt(0).toUpperCase();
                    return `
                        <tr>
                            <td>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="avatar-initial rounded-circle bg-secondary text-white d-inline-flex align-items-center justify-content-center" style="width:32px; height:32px; font-size:0.8rem; font-weight:700;">
                                        ${escapeHtml(initial)}
                                    </span>
                                    <div>
                                        <div class="fw-semibold small">${escapeHtml(u.name || u.username)}</div>
                                        <div class="text-muted" style="font-size: 0.72rem;">${escapeHtml(u.email || 'No email')}</div>
                                    </div>
                                </div>
                            </td>
                            <td>
                                <span class="badge bg-dark border text-muted" style="border-color: rgba(255,255,255,0.08) !important;">
                                    @${escapeHtml(u.username)}
                                </span>
                            </td>
                            <td class="text-muted small">${escapeHtml(u.created_at)}</td>
                        </tr>
                    `;
                }).join('');
            }
        }
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            fetchMetrics();
        });
    }

    // Polling every 30 seconds
    setInterval(fetchMetrics, 30000);

})();
