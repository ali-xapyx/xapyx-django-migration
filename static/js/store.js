/**
 * Store & Marketplace JavaScript
 * Multi-image product uploads, dynamic preview thumbnails,
 * card carousel sliders, and product detail gallery navigation.
 */

// State for multi-image upload
let storeSelectedFiles = [];

/**
 * Initialize Multi-Image Upload & Preview Handlers
 */
function initStoreUpload() {
    const imagesInput = document.getElementById('productImagesInput');
    const previewContainer = document.getElementById('imagePreviewContainer');
    const dropzone = document.getElementById('storeUploadDropzone');
    const countBadge = document.getElementById('photoCountBadge');
    const modalEl = document.getElementById('createProductModal');

    if (!imagesInput || !previewContainer) return;

    function updatePreview() {
        previewContainer.innerHTML = '';

        if (countBadge) {
            countBadge.textContent = `${storeSelectedFiles.length} / 8 selected`;
        }

        if (storeSelectedFiles.length === 0) {
            return;
        }

        storeSelectedFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'store-preview-item position-relative';

            const img = document.createElement('img');
            img.className = 'store-preview-thumb';
            img.alt = file.name || `Photo ${index + 1}`;

            // Object URL for fast local preview
            const objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;

            // Revoke memory on image load
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
            };

            item.appendChild(img);

            // Cover badge on first image
            if (index === 0) {
                const coverBadge = document.createElement('span');
                coverBadge.className = 'badge bg-primary position-absolute store-cover-badge';
                coverBadge.textContent = 'Cover';
                item.appendChild(coverBadge);
            }

            // Remove button
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-close btn-close-white store-remove-thumb-btn';
            removeBtn.setAttribute('aria-label', 'Remove photo');
            removeBtn.title = 'Remove photo';
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                storeSelectedFiles.splice(index, 1);
                syncInputFiles();
                updatePreview();
            });

            item.appendChild(removeBtn);
            previewContainer.appendChild(item);
        });
    }

    function syncInputFiles() {
        if (!imagesInput) return;
        try {
            const dt = new DataTransfer();
            storeSelectedFiles.forEach(f => dt.items.add(f));
            imagesInput.files = dt.files;
        } catch (e) {
            // DataTransfer not supported in older browsers, fallback gracefully
        }
    }

    function handleFiles(files) {
        const remaining = 8 - storeSelectedFiles.length;
        if (remaining <= 0) {
            if (window.showToast) window.showToast('Maximum 8 photos allowed.', 'Marketplace', '⚠️');
            return;
        }

        const validFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
        if (validFiles.length === 0) return;

        storeSelectedFiles.push(...validFiles);
        syncInputFiles();
        updatePreview();
    }

    imagesInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });

    // Drag and drop support on dropzone
    if (dropzone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
            }, false);
        });

        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                handleFiles(dt.files);
            }
        });
    }

    // Reset when modal closes
    if (modalEl) {
        modalEl.addEventListener('hidden.bs.modal', function() {
            storeSelectedFiles = [];
            if (imagesInput) imagesInput.value = '';
            updatePreview();
            const alertBox = document.getElementById('createProductAlert');
            if (alertBox) alertBox.classList.add('d-none');
        });
    }
}

/**
 * Product Card Carousel Handlers
 */
window.storeCardCarousels = {};

function initCardCarousels() {
    document.querySelectorAll('.store-card-carousel').forEach(carouselEl => {
        const prodId = carouselEl.getAttribute('data-product-id');
        if (!prodId) return;

        const slides = carouselEl.querySelectorAll('.store-carousel-slide');
        if (slides.length <= 1) return;

        window.storeCardCarousels[prodId] = {
            element: carouselEl,
            slides: slides,
            currentIndex: 0,
            total: slides.length
        };

        // Touch swipe support on mobile
        let touchStartX = 0;
        let touchEndX = 0;

        carouselEl.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        carouselEl.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleCardSwipe(prodId, touchStartX, touchEndX);
        }, { passive: true });
    });
}

function handleCardSwipe(prodId, startX, endX) {
    const threshold = 40;
    if (startX - endX > threshold) {
        // Swiped left -> next
        window.storeCarouselNext(prodId);
    } else if (endX - startX > threshold) {
        // Swiped right -> prev
        window.storeCarouselPrev(prodId);
    }
}

window.storeCarouselGoTo = function(productId, targetIndex) {
    const state = window.storeCardCarousels[productId];
    if (!state) return;

    if (targetIndex < 0) {
        targetIndex = state.total - 1;
    } else if (targetIndex >= state.total) {
        targetIndex = 0;
    }

    state.currentIndex = targetIndex;

    // Update slides
    state.slides.forEach((slide, idx) => {
        if (idx === targetIndex) {
            slide.classList.add('active');
        } else {
            slide.classList.remove('active');
        }
    });

    // Update dots
    const dots = state.element.querySelectorAll('.store-dot');
    dots.forEach((dot, idx) => {
        if (idx === targetIndex) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });

    // Update counter pill if present
    const idxEl = state.element.querySelector('.store-slide-idx');
    if (idxEl) {
        idxEl.textContent = targetIndex + 1;
    }
};

window.storeCarouselNext = function(productId) {
    const state = window.storeCardCarousels[productId];
    if (!state) return;
    window.storeCarouselGoTo(productId, state.currentIndex + 1);
};

window.storeCarouselPrev = function(productId) {
    const state = window.storeCardCarousels[productId];
    if (!state) return;
    window.storeCarouselGoTo(productId, state.currentIndex - 1);
};

/**
 * Product Detail Gallery / Carousel Logic
 */
let pdCurrentIndex = 0;
let pdImages = [];

function initProductDetailGallery() {
    const thumbs = document.querySelectorAll('.pd-thumb-item');
    if (thumbs.length === 0) return;

    pdImages = Array.from(thumbs).map(t => t.getAttribute('data-img-url') || (t.querySelector('img') ? t.querySelector('img').src : ''));

    // Touch swipe support on main image container
    const mainGallery = document.querySelector('.pd-gallery-main');
    if (mainGallery) {
        let touchStartX = 0;
        let touchEndX = 0;

        mainGallery.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        mainGallery.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const threshold = 40;
            if (touchStartX - touchEndX > threshold) {
                window.pdGalleryNext();
            } else if (touchEndX - touchStartX > threshold) {
                window.pdGalleryPrev();
            }
        }, { passive: true });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') {
            window.pdGalleryPrev();
        } else if (e.key === 'ArrowRight') {
            window.pdGalleryNext();
        }
    });
}

window.selectProductImage = function(url, thumbEl) {
    const mainImg = document.getElementById('pdMainImage');
    if (mainImg) {
        mainImg.style.opacity = '0.4';
        setTimeout(() => {
            mainImg.src = url;
            mainImg.style.opacity = '1';
        }, 120);
    }

    const thumbs = document.querySelectorAll('.pd-thumb-item');
    thumbs.forEach((el, idx) => {
        if (el === thumbEl || el.getAttribute('data-img-url') === url) {
            el.classList.add('active');
            pdCurrentIndex = idx;
            // Scroll thumb into view
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            el.classList.remove('active');
        }
    });

    const counter = document.getElementById('pdCounterCurrent');
    if (counter) counter.textContent = pdCurrentIndex + 1;
};

window.pdGalleryNext = function() {
    if (!pdImages || pdImages.length <= 1) return;
    const nextIdx = (pdCurrentIndex + 1) % pdImages.length;
    const thumbs = document.querySelectorAll('.pd-thumb-item');
    window.selectProductImage(pdImages[nextIdx], thumbs[nextIdx]);
};

window.pdGalleryPrev = function() {
    if (!pdImages || pdImages.length <= 1) return;
    const prevIdx = (pdCurrentIndex - 1 + pdImages.length) % pdImages.length;
    const thumbs = document.querySelectorAll('.pd-thumb-item');
    window.selectProductImage(pdImages[prevIdx], thumbs[prevIdx]);
};

function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : (document.querySelector('[name=csrfmiddlewaretoken]')?.value || '');
}

function initStoreForm() {
    const form = document.getElementById('createProductForm');
    const submitBtn = document.getElementById('btnSubmitProduct');
    const spinner = document.getElementById('submitSpinner');
    const alertBox = document.getElementById('createProductAlert');

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (alertBox) {
            alertBox.classList.add('d-none');
            alertBox.textContent = '';
        }

        const formData = new FormData(form);

        // Explicitly append all tracked images
        if (storeSelectedFiles.length > 0) {
            formData.delete('images');
            formData.delete('images[]');
            storeSelectedFiles.forEach(file => {
                formData.append('images', file);
            });
        }

        const submitBtnText = submitBtn ? submitBtn.querySelector('span:last-child') : null;
        if (submitBtn) submitBtn.disabled = true;
        if (spinner) spinner.classList.remove('d-none');
        if (submitBtnText) submitBtnText.textContent = 'Uploading & Posting...';

        try {
            const response = await fetch('/api/store/create/', {
                method: 'POST',
                body: formData,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            const data = await response.json();

            if (data.success) {
                if (submitBtnText) submitBtnText.textContent = 'Success!';
                if (window.showToast) {
                    window.showToast(data.message || 'Product listed successfully!', 'Marketplace', '🛍️');
                }
                setTimeout(() => {
                    window.location.reload();
                }, 800);
            } else {
                if (alertBox) {
                    alertBox.textContent = data.error || 'Failed to submit product. Please check the form.';
                    alertBox.classList.remove('d-none');
                }
                if (submitBtn) submitBtn.disabled = false;
                if (spinner) spinner.classList.add('d-none');
                if (submitBtnText) submitBtnText.textContent = 'Post Listing';
            }
        } catch (err) {
            console.error('Store submit error:', err);
            if (alertBox) {
                alertBox.textContent = 'A network error occurred while uploading. Please try again.';
                alertBox.classList.remove('d-none');
            }
            if (submitBtn) submitBtn.disabled = false;
            if (spinner) spinner.classList.add('d-none');
            if (submitBtnText) submitBtnText.textContent = 'Post Listing';
        }
    });
}

let currentSellerProductId = null;

window.openMarkSoldModal = function(productId, title) {
    currentSellerProductId = productId;
    const titleEl = document.getElementById('markSoldProductTitle');
    if (titleEl) titleEl.textContent = title;
    const modalEl = document.getElementById('markSoldModal');
    if (modalEl) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
};

window.openDeleteProductModal = function(productId, title) {
    currentSellerProductId = productId;
    const titleEl = document.getElementById('deleteProductTitle');
    if (titleEl) titleEl.textContent = title;
    const modalEl = document.getElementById('deleteProductModal');
    if (modalEl) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
};

window.toggleStoreWidgetsDrawer = function(force) {
    const panel = document.getElementById('rightWidgetsPanel');
    const overlay = document.getElementById('storeWidgetsOverlay');
    if (!panel) return;
    const shouldOpen = typeof force === 'boolean' ? force : !panel.classList.contains('drawer-open');
    if (shouldOpen) {
        panel.classList.add('drawer-open');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        panel.classList.remove('drawer-open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
};

function initStoreActionModals() {
    const soldBtn = document.getElementById('confirmMarkSoldBtn');
    if (soldBtn) {
        soldBtn.addEventListener('click', function() {
            if (!currentSellerProductId) return;
            const btn = this;
            btn.disabled = true;
            fetch(`/api/store/mark-sold/${currentSellerProductId}/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(r => r.json())
            .then(data => {
                btn.disabled = false;
                const modalEl = document.getElementById('markSoldModal');
                if (modalEl) {
                    const inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.hide();
                }
                if (data.success) {
                    location.reload();
                } else {
                    alert(data.error || 'Failed to mark as sold.');
                }
            })
            .catch(err => {
                btn.disabled = false;
                alert('An error occurred. Please try again.');
            });
        });
    }

    const delBtn = document.getElementById('confirmDeleteProductBtn');
    if (delBtn) {
        delBtn.addEventListener('click', function() {
            if (!currentSellerProductId) return;
            const btn = this;
            btn.disabled = true;
            fetch(`/api/store/delete/${currentSellerProductId}/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(r => r.json())
            .then(data => {
                btn.disabled = false;
                const modalEl = document.getElementById('deleteProductModal');
                if (modalEl) {
                    const inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.hide();
                }
                if (data.success) {
                    if (window.location.pathname.includes('/store/') && window.location.pathname !== '/store/') {
                        window.location.href = '/store/';
                    } else {
                        location.reload();
                    }
                } else {
                    alert(data.error || 'Failed to delete listing.');
                }
            })
            .catch(err => {
                btn.disabled = false;
                alert('An error occurred. Please try again.');
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    initStoreUpload();
    initStoreForm();
    initCardCarousels();
    initProductDetailGallery();
    initStoreActionModals();
});
EOF

window.toggleContactNumber = function() {
    const card = document.getElementById('contactNumberCard');
    const btnText = document.getElementById('contactBtnText');
    if (card) {
        if (card.classList.contains('d-none')) {
            card.classList.remove('d-none');
            if (btnText) btnText.textContent = 'Hide Phone Number';
        } else {
            card.classList.add('d-none');
            if (btnText) btnText.textContent = 'Show Phone Number';
        }
    }
};
