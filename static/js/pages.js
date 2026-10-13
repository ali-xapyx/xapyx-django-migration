/**
 * XAPYX Pages ? ported from model/pages.php
 * Cache-bust: ?v=1
 */
(function () {
    'use strict';

    function setButtonLoading(btn, loading, loadingText) {
        if (!btn) return;
        if (loading) {
            if (!btn.dataset.origHtml) {
                btn.dataset.origHtml = btn.innerHTML;
                btn.dataset.origWidth = btn.offsetWidth + 'px';
            }
            btn.style.minWidth = btn.dataset.origWidth;
            btn.disabled = true;
            btn.innerHTML = '<span class="btn-spinner"></span> ' + (loadingText || 'Saving...');
        } else {
            btn.disabled = false;
            if (btn.dataset.origHtml) {
                btn.innerHTML = btn.dataset.origHtml;
                delete btn.dataset.origHtml;
            }
            btn.style.minWidth = '';
        }
    }


    // ============================================================
    // COSMIC STARS
    // ============================================================
    (function createStars() {
        var container = document.getElementById('xpyStarsBg');
        if (!container) return;
        var count = window.innerWidth < 480 ? 80 : window.innerWidth < 768 ? 120 : 200;
        for (var i = 0; i < count; i++) {
            var star = document.createElement('div');
            star.className = 'xpy-star-dot';
            var size = Math.random() * 2.5 + 0.5;
            star.style.cssText =
                'width:' + size + 'px;height:' + size + 'px;' +
                'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 100) + '%;' +
                '--xpy-d:' + ((Math.random() * 4 + 1.5).toFixed(1)) + 's;' +
                'animation-delay:' + ((Math.random() * 6).toFixed(1)) + 's;' +
                'opacity:' + (Math.random() * 0.5 + 0.3) + ';';
            container.appendChild(star);
        }
    })();

    // ============================================================
    // GLOBAL VARIABLES
    // ============================================================
    const currentUser =
        (window.XAPYX_PAGES && window.XAPYX_PAGES.currentUser) ||
        { id: null, name: '' };
    let pageToDelete = null;
    let currentFilter = 'all';

    // ============================================================
    // INITIALIZATION
    // ============================================================
    document.addEventListener('DOMContentLoaded', function() {
        initializeEventListeners();
        setupImagePreview();
        setupFilters();
        setupMobileCreateButton();
        fixModalBackdrop();
        ensureFirstCardVisible();
    });

    function ensureFirstCardVisible() {
        setTimeout(() => {
            if (window.innerWidth <= 767) {
                const filterSection = document.querySelector('.filter-section');
                const pagesGrid = document.querySelector('.pages-grid');
                
                if (filterSection && pagesGrid) {
                    const filterHeight = filterSection.offsetHeight;
                    const gridTop = pagesGrid.getBoundingClientRect().top;
                    
                    if (gridTop <= filterHeight) {
                        window.scrollTo({
                            top: pagesGrid.offsetTop - filterHeight - 10,
                            behavior: 'auto'
                        });
                    }
                }
            }
        }, 200);
    }

    function fixModalBackdrop() {
        document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================
    function initializeEventListeners() {
        document.getElementById('pagesContainer').addEventListener('click', function(e) {
            const followBtn = e.target.closest('.btn-follow-page');
            const editBtn = e.target.closest('.btn-edit-page');
            const deleteBtn = e.target.closest('.btn-delete-page');
            const pageCard = e.target.closest('.page-card');
            
            if (followBtn) {
                e.preventDefault();
                e.stopPropagation();
                handlePageFollow(followBtn);
            }
            
            if (editBtn) {
                e.preventDefault();
                e.stopPropagation();
                showEditModal(editBtn);
            }
            
            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                showDeleteConfirm(deleteBtn);
            }
            
            if (pageCard && !followBtn && !editBtn && !deleteBtn) {
                const pageId = pageCard.dataset.pageId;
                window.location.href = `/pages/${pageId}/`;
            }
        });
        
        document.getElementById('createPageForm').addEventListener('submit', createPage);
        document.getElementById('editPageForm').addEventListener('submit', editPage);
        document.getElementById('confirmDeleteBtn').addEventListener('click', deletePage);
        
        document.getElementById('searchPages').addEventListener('input', filterPages);
        
        document.getElementById('createPageModal').addEventListener('hidden.bs.modal', function() {
            fixModalBackdrop();
            document.getElementById('createPageForm').reset();
            resetImagePreviews();
        });
        
        document.getElementById('editPageModal').addEventListener('hidden.bs.modal', function() {
            fixModalBackdrop();
        });
        
        document.getElementById('deleteConfirmModal').addEventListener('hidden.bs.modal', function() {
            fixModalBackdrop();
        });
        
        window.addEventListener('resize', function() {
            ensureFirstCardVisible();
        });
    }

    // ============================================================
    // IMAGE PREVIEW
    // ============================================================
    function setupImagePreview() {
        document.getElementById('profileImageInput')?.addEventListener('change', function() {
            handleImagePreview(this, document.getElementById('previewProfileImage'));
        });
        
        document.getElementById('coverImageInput')?.addEventListener('change', function() {
            handleImagePreview(this, document.getElementById('previewCoverImage'));
        });
        
        document.getElementById('editProfileImageInput')?.addEventListener('change', function() {
            handleImagePreview(this, document.getElementById('editPreviewProfileImage'));
        });
        
        document.getElementById('editCoverImageInput')?.addEventListener('change', function() {
            handleImagePreview(this, document.getElementById('editPreviewCoverImage'));
        });
    }

    function handleImagePreview(input, preview) {
        const file = input.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                showAlert('File size must be less than 5MB', 'error');
                input.value = '';
                return;
            }
            
            const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!validTypes.includes(file.type)) {
                showAlert('Only image files are allowed (JPG, PNG, GIF, WebP)', 'error');
                input.value = '';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                preview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="width:100%; height:100%; object-fit:cover;">`;
            };
            reader.readAsDataURL(file);
        }
    }

    function resetImagePreviews() {
        document.getElementById('previewProfileImage').innerHTML = `
            <i class="bi bi-camera"></i>
            <span>Click to upload profile image</span>
            <small>Recommended: 400?400px (Max 5MB)</small>
        `;
        
        document.getElementById('previewCoverImage').innerHTML = `
            <i class="bi bi-image"></i>
            <span>Click to upload cover image</span>
            <small>Recommended: 1500?500px (Max 5MB)</small>
        `;
    }

    // ============================================================
    // FILTERS
    // ============================================================
    function setupFilters() {
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                currentFilter = this.dataset.filter;
                filterPagesByType(currentFilter);
                updateMobileCreateButton();
                
                setTimeout(() => {
                    if (window.innerWidth <= 767) {
                        const firstVisible = document.querySelector('.page-card[style*="display: flex"]');
                        if (firstVisible) {
                            const filterSection = document.querySelector('.filter-section');
                            const filterHeight = filterSection ? filterSection.offsetHeight : 0;
                            const cardTop = firstVisible.getBoundingClientRect().top;
                            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                            
                            window.scrollTo({
                                top: scrollTop + cardTop - filterHeight - 20,
                                behavior: 'smooth'
                            });
                        }
                    }
                }, 100);
            });
        });
    }

    function filterPagesByType(type) {
        const pages = document.querySelectorAll('.page-card');
        pages.forEach(page => {
            switch(type) {
                case 'following':
                    page.style.display = page.dataset.following == '1' ? 'flex' : 'none';
                    break;
                case 'my':
                    page.style.display = page.dataset.creator == currentUser.id ? 'flex' : 'none';
                    break;
                default:
                    page.style.display = 'flex';
            }
        });
    }

    function filterPages() {
        const searchTerm = document.getElementById('searchPages').value.toLowerCase();
        const pages = document.querySelectorAll('.page-card');
        
        pages.forEach(page => {
            const pageName = page.dataset.name.toLowerCase();
            const shouldShowByFilter = currentFilter === 'all' || 
                                     (currentFilter === 'following' && page.dataset.following == '1') ||
                                     (currentFilter === 'my' && page.dataset.creator == currentUser.id);
            
            if (shouldShowByFilter && pageName.includes(searchTerm)) {
                page.style.display = 'flex';
            } else {
                page.style.display = 'none';
            }
        });
    }

    function setupMobileCreateButton() {
        updateMobileCreateButton();
    }

    function updateMobileCreateButton() {
        const container = document.getElementById('mobileCreateContainer');
        if (currentFilter === 'my') {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }

    // ============================================================
    // ALERT SYSTEM
    // ============================================================
    function showAlert(message, type = 'success') {
        const alertContainer = document.getElementById('alertContainer');
        const alert = document.createElement('div');
        alert.className = `custom-alert custom-alert-${type}`;
        alert.innerHTML = `
            <div class="alert-content">
                <i class="bi ${type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        alertContainer.appendChild(alert);
        
        setTimeout(() => {
            alert.style.opacity = '0';
            setTimeout(() => {
                if (alert.parentNode) alert.remove();
            }, 300);
        }, 3000);
    }

    // ============================================================
    // CRUD OPERATIONS
    // ============================================================
    async function createPage(e) {
        e.preventDefault();
        
        const form = e.target;
        const formData = new FormData(form);
        const btn = document.getElementById('createPageSubmitBtn');
        setButtonLoading(btn, true, 'Creating...');
        
        try {
            const response = await fetch('/api/pages/create/', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showAlert('Page created successfully!');
                bootstrap.Modal.getInstance(document.getElementById('createPageModal')).hide();
                form.reset();
                resetImagePreviews();
                location.reload();
            } else {
                showAlert(data.error || 'Failed to create page', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showAlert('Network error. Please try again.', 'error');
        } finally {
            setButtonLoading(btn, false);
            fixModalBackdrop();
        }
    }

    function showEditModal(button) {
        document.getElementById('editPageId').value = button.dataset.pageId;
        document.getElementById('editPageTitle').value = button.dataset.title;
        document.getElementById('editPageDescription').value = button.dataset.description;
        document.getElementById('currentProfileImage').src = button.dataset.profileImage;
        document.getElementById('currentCoverImage').src = button.dataset.coverImage;
        
        document.getElementById('editPreviewProfileImage').innerHTML = `
            <i class="bi bi-arrow-repeat"></i>
            <span>Click to change profile image</span>
            <small>Recommended: 400?400px</small>
        `;
        
        document.getElementById('editPreviewCoverImage').innerHTML = `
            <i class="bi bi-arrow-repeat"></i>
            <span>Click to change cover image</span>
            <small>Recommended: 1500?500px</small>
        `;
        
        document.getElementById('editProfileImageInput').value = '';
        document.getElementById('editCoverImageInput').value = '';
        
        new bootstrap.Modal(document.getElementById('editPageModal')).show();
    }

    async function editPage(e) {
        e.preventDefault();
        
        const form = e.target;
        const formData = new FormData(form);
        const btn = document.getElementById('editPageSubmitBtn');
        setButtonLoading(btn, true, 'Saving...');
        
        try {
            const pageId = formData.get('page_id');
            const response = await fetch(`/api/pages/${pageId}/edit/`, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showAlert('Page updated successfully!');
                bootstrap.Modal.getInstance(document.getElementById('editPageModal')).hide();
                location.reload();
            } else {
                showAlert(data.error || 'Failed to update page', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showAlert('Network error. Please try again.', 'error');
        } finally {
            setButtonLoading(btn, false);
            fixModalBackdrop();
        }
    }

    function showDeleteConfirm(button) {
        pageToDelete = button.dataset.pageId;
        new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
    }

    async function deletePage() {
        if (!pageToDelete) return;
        
        const btn = document.getElementById('confirmDeleteBtn');
        setButtonLoading(btn, true, 'Deleting...');
        
        try {
            const response = await fetch(`/api/pages/${pageToDelete}/delete/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrfToken() }
            });
            const data = await response.json();
            
            if (data.success) {
                showAlert('Page deleted successfully!');
                bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal')).hide();
                location.reload();
            } else {
                showAlert(data.error || 'Failed to delete page', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showAlert('Network error. Please try again.', 'error');
        } finally {
            setButtonLoading(btn, false);
            fixModalBackdrop();
        }
    }

    // ============================================================
    // FOLLOW
    // ============================================================
    async function handlePageFollow(btn) {
        const pageId = btn.dataset.pageId;
        const isFollowing = btn.dataset.following === '1';
        
        if (!btn.dataset.origHtml) {
            btn.dataset.origHtml = btn.innerHTML;
            btn.dataset.origWidth = btn.offsetWidth + 'px';
        }
        btn.style.minWidth = btn.dataset.origWidth;
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner" style="margin-right:0;"></span>';
        
        try {
            const response = await fetch(`/api/pages/${pageId}/toggle-follow/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            
            if (data.success) {
                delete btn.dataset.origHtml;
                btn.style.minWidth = '';
                if (data.is_following) {
                    btn.innerHTML = '<i class="bi bi-check"></i> Following';
                    btn.classList.remove('btn-follow-page');
                    btn.classList.add('btn-follow-page', 'following');
                    btn.dataset.following = '1';
                    
                    const pageCard = btn.closest('.page-card');
                    const statusBadge = pageCard ? pageCard.querySelector('.page-status-badge') : null;
                    if (statusBadge) {
                        statusBadge.textContent = 'Following';
                        statusBadge.className = 'page-status-badge following';
                    }
                    
                    showAlert('You are now following this page!', 'success');
                } else {
                    btn.innerHTML = '<i class="bi bi-plus"></i> Follow';
                    btn.classList.remove('following');
                    btn.classList.add('btn-follow-page');
                    btn.dataset.following = '0';
                    
                    const pageCard = btn.closest('.page-card');
                    const statusBadge = pageCard ? pageCard.querySelector('.page-status-badge') : null;
                    if (statusBadge) {
                        statusBadge.textContent = 'Public';
                        statusBadge.className = 'page-status-badge public';
                    }
                    
                    showAlert('You unfollowed this page', 'info');
                }
            } else {
                showAlert(data.error || 'Failed to update follow status', 'error');
                if (btn.dataset.origHtml) {
                    btn.innerHTML = btn.dataset.origHtml;
                    delete btn.dataset.origHtml;
                }
                btn.style.minWidth = '';
            }
        } catch (error) {
            console.error('Error:', error);
            showAlert('Network error. Please try again.', 'error');
            if (btn.dataset.origHtml) {
                btn.innerHTML = btn.dataset.origHtml;
                delete btn.dataset.origHtml;
            }
            btn.style.minWidth = '';
        } finally {
            btn.disabled = false;
        }
    }

})();
