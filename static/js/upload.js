/**
 * Reusable helper for direct browser -> S3 presigned PUT uploads.
 * Purpose: 'post' | 'profile' | 'support'
 */
async function uploadFileDirect(file, purpose, options = {}) {
    if (!file) throw new Error('No file provided');

    // Pre-upload crop hook (if registered and not bypassed)
    if (!options.skipCrop && typeof window !== 'undefined' && typeof window.uploadCropHook === 'function' && purpose === 'profile') {
        const croppedFile = await window.uploadCropHook(file, purpose);
        if (!croppedFile) {
            return null; // Crop was canceled
        }
        file = croppedFile;
    }

    // 1. Request presigned URL from Django backend
    const r = await fetch('/api/upload/presign/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': typeof getCsrfToken === 'function' ? getCsrfToken() : ''
        },
        body: JSON.stringify({
            purpose: purpose,
            filename: file.name,
            content_type: file.type || 'image/jpeg'
        })
    });

    const d = await r.json();
    if (!d.success) {
        throw new Error(d.error || 'Presign request failed');
    }

    // 2. PUT directly to S3
    const put = await fetch(d.upload_url, {
        method: 'PUT',
        headers: {
            'Content-Type': file.type || 'image/jpeg'
        },
        body: file
    });

    if (!put.ok) {
        throw new Error('S3 upload failed: ' + put.status);
    }

    return {
        key: d.key,
        public_url: d.public_url
    };
}

if (typeof window !== 'undefined') {
    window.uploadFileDirect = uploadFileDirect;
    window.setUploadCropHook = function(fn) {
        window.uploadCropHook = fn;
    };
}