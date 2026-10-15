/**
 * XAPYX Admin Portal -- Real-Time Metrics & Dashboard Poller (Phase 1.6 Hybrid + Dark Mode)
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
    const statTicketsCritical = document.getElementById('statTicketsCritical');
    const statUsersTotal = document.getElementById('statUsersTotal');

    const quickStatTotalTickets = document.getElementById('quickStatTotalTickets');
    const quickStatResolvedTickets = document.getElementById('quickStatResolvedTickets');
    const quickStatCriticalTickets = document.getElementById('quickStatCriticalTickets');
    const quickStatTotalUsers = document.getElementById('quickStatTotalUsers');

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
        if (statTicketsCritical) statTicketsCritical.textContent = m.tickets_critical || 0;
        if (statUsersTotal) statUsersTotal.textContent = m.users_total || 0;

        if (quickStatTotalTickets) quickStatTotalTickets.textContent = m.tickets_total || 0;
        if (quickStatResolvedTickets) quickStatResolvedTickets.textContent = m.tickets_resolved || 0;
        if (quickStatCriticalTickets) quickStatCriticalTickets.textContent = m.tickets_critical || 0;
        if (quickStatTotalUsers) quickStatTotalUsers.textContent = m.users_total || 0;

        // Render latest tickets (4 columns: Subject | User | Status | Date)
        if (ticketsTbody && Array.isArray(data.latest_5_tickets)) {
            if (data.latest_5_tickets.length === 0) {
                ticketsTbody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center py-4" style="color: var(--admsup-text-muted);">
                            <i class="bi bi-inbox fs-2 mb-2 d-block opacity-50"></i>
                            No tickets found
                        </td>
                    </tr>
                `;
            } else {
                ticketsTbody.innerHTML = data.latest_5_tickets.map(t => {
                    let statusPill = `<span class="admsup-pill pill-default">${escapeHtml(t.status || 'Open')}</span>`;
                    if (t.status === 'open') statusPill = '<span class="admsup-pill pill-open">Open</span>';
                    else if (t.status === 'in_progress') statusPill = '<span class="admsup-pill pill-in-progress">In Progress</span>';
                    else if (t.status === 'resolved') statusPill = '<span class="admsup-pill pill-resolved">Resolved</span>';
                    else if (t.status === 'pending') statusPill = '<span class="admsup-pill pill-pending">Pending</span>';
                    else if (t.status === 'closed') statusPill = '<span class="admsup-pill pill-closed">Closed</span>';
                    const urg = (t.urgency || 'medium').toLowerCase();
                    const urgencyDot = `<span class="admsup-urgency-dot urgency-${escapeHtml(urg)} ms-1">${escapeHtml(urg.charAt(0).toUpperCase() + urg.slice(1))}</span>`;

                    const shortDate = escapeHtml((t.created_at || '').split(' ')[0] || t.created_at || '');

                    return `
                        <tr>
                            <td>
                                <div class="fw-semibold text-truncate" style="max-width: 190px; color: var(--admsup-text);" title="#${escapeHtml(String(t.id))} - ${escapeHtml(t.subject)}">
                                    <span style="color: var(--admsup-text-muted); font-weight: 700; margin-right: 4px;">#${escapeHtml(String(t.id))}</span>${escapeHtml(t.subject || 'No Subject')}
                                </div>
                            </td>
                            <td>
                                <div class="small fw-semibold" style="color: var(--admsup-text-secondary);">${escapeHtml(t.user_name || 'Unknown')}</div>
                                ${t.user_email ? `<div style="font-size: 0.72rem; color: var(--admsup-text-muted);">${escapeHtml(t.user_email)}</div>` : ''}
                            </td>
                            <td>${statusPill} ${urgencyDot}</td>
                            <td class="small" style="color: var(--admsup-text-muted); white-space: nowrap;">${shortDate}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // Render latest users (4 columns: Name | Email | Username | Joined)
        if (usersTbody && Array.isArray(data.latest_5_users)) {
            if (data.latest_5_users.length === 0) {
                usersTbody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center py-4" style="color: var(--admsup-text-muted);">
                            <i class="bi bi-people-slash fs-2 mb-2 d-block opacity-50"></i>
                            No users found
                        </td>
                    </tr>
                `;
            } else {
                usersTbody.innerHTML = data.latest_5_users.map(u => {
                    const displayName = u.name || u.username || 'User';
                    const initial = displayName.charAt(0).toUpperCase();
                    const shortDate = escapeHtml((u.created_at || '').split(' ')[0] || u.created_at || '');

                    return `
                        <tr>
                            <td>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="avatar-initial rounded-circle d-inline-flex align-items-center justify-content-center flex-shrink-0" style="width:32px; height:32px; font-size:0.8rem; font-weight:700; background: #3b82f6; color: #fff;">
                                        ${escapeHtml(initial)}
                                    </span>
                                    <span class="fw-semibold small text-truncate" style="max-width: 120px; color: var(--admsup-text);">
                                        ${escapeHtml(displayName)}
                                    </span>
                                </div>
                            </td>
                            <td>
                                <span class="small text-truncate d-inline-block" style="max-width: 140px; color: var(--admsup-text-muted);" title="${escapeHtml(u.email || 'N/A')}">
                                    ${escapeHtml(u.email || 'N/A')}
                                </span>
                            </td>
                            <td>
                                <span class="admsup-user-pill">
                                    @${escapeHtml(u.username || '')}
                                </span>
                            </td>
                            <td class="small" style="color: var(--admsup-text-muted); white-space: nowrap;">${shortDate}</td>
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
