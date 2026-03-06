/**
 * OutreachFlow AI — Campaign Setup Form Logic
 * Handles form validation, multi-select geography dropdown,
 * localStorage persistence, and Flask backend submission.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // ─── Element References ───
    const form = document.getElementById('campaign-form');
    const geoToggle = document.getElementById('geo-toggle');
    const geoOptions = document.getElementById('geo-options');
    const geoChevron = document.getElementById('geo-chevron');
    const geoPlaceholder = document.getElementById('geo-placeholder');
    const geoTagsContainer = document.getElementById('geo-tags');
    const geoCheckboxes = document.querySelectorAll('.geo-checkbox');
    const successToast = document.getElementById('success-toast');
    const submitBtn = document.getElementById('submit-btn');

    // ─── Configuration ───
    const FLASK_API_URL = 'http://127.0.0.1:5000/save-campaign';
    const STORAGE_KEY = 'campaign_context';

    // Required fields for validation
    const REQUIRED_FIELDS = [
        { id: 'industry', label: 'Industry' },
        { id: 'company_name', label: 'Company Name' },
        { id: 'product_description', label: 'Product Description' },
        { id: 'target_customer', label: 'Target Customer Type' },
        { id: 'campaign_goal', label: 'Campaign Goal' },
    ];

    // ─── Geography Multi-Select ───
    let selectedGeographies = [];

    geoToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = !geoOptions.classList.contains('hidden');
        toggleGeoDropdown(!isOpen);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!document.getElementById('geo-dropdown').contains(e.target)) {
            toggleGeoDropdown(false);
        }
    });

    function toggleGeoDropdown(open) {
        if (open) {
            geoOptions.classList.remove('hidden');
            geoChevron.style.transform = 'rotate(180deg)';
        } else {
            geoOptions.classList.add('hidden');
            geoChevron.style.transform = 'rotate(0deg)';
        }
    }

    geoCheckboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updateSelectedGeographies();
        });
    });

    function updateSelectedGeographies() {
        selectedGeographies = [];
        geoCheckboxes.forEach(cb => {
            if (cb.checked) {
                selectedGeographies.push(cb.value);
            }
        });
        renderGeoTags();
        updateGeoPlaceholder();
    }

    function updateGeoPlaceholder() {
        if (selectedGeographies.length === 0) {
            geoPlaceholder.textContent = 'Select regions';
            geoPlaceholder.classList.add('text-surface-500');
            geoPlaceholder.classList.remove('text-white');
        } else {
            geoPlaceholder.textContent = `${selectedGeographies.length} region${selectedGeographies.length > 1 ? 's' : ''} selected`;
            geoPlaceholder.classList.remove('text-surface-500');
            geoPlaceholder.classList.add('text-white');
        }
    }

    function renderGeoTags() {
        geoTagsContainer.innerHTML = '';
        selectedGeographies.forEach(geo => {
            const tag = document.createElement('span');
            tag.className = 'geo-tag';
            tag.innerHTML = `
                ${geo}
                <button type="button" data-geo="${geo}" aria-label="Remove ${geo}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
            geoTagsContainer.appendChild(tag);
        });

        // Attach remove handlers
        geoTagsContainer.querySelectorAll('button[data-geo]').forEach(btn => {
            btn.addEventListener('click', () => {
                const geoValue = btn.dataset.geo;
                // Uncheck the corresponding checkbox
                geoCheckboxes.forEach(cb => {
                    if (cb.value === geoValue) {
                        cb.checked = false;
                    }
                });
                updateSelectedGeographies();
            });
        });
    }

    // ─── Form Validation ───
    function validateForm() {
        let isValid = true;

        REQUIRED_FIELDS.forEach(field => {
            const el = document.getElementById(field.id);
            const group = el.closest('.form-group');
            const value = el.value.trim();

            if (!value) {
                group.classList.add('has-error');
                isValid = false;
            } else {
                group.classList.remove('has-error');
            }
        });

        return isValid;
    }

    // Clear error on input change
    REQUIRED_FIELDS.forEach(field => {
        const el = document.getElementById(field.id);
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
            const group = el.closest('.form-group');
            if (el.value.trim()) {
                group.classList.remove('has-error');
            }
        });
    });

    // ─── Form Submission ───
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!validateForm()) {
            // Scroll to first error
            const firstError = form.querySelector('.has-error');
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        // Build campaign context object
        const campaignContext = {
            industry: document.getElementById('industry').value,
            company_name: document.getElementById('company_name').value.trim(),
            product_description: document.getElementById('product_description').value.trim(),
            target_customer: document.getElementById('target_customer').value,
            target_geography: selectedGeographies.length > 0 ? selectedGeographies.join(', ') : 'Global',
            outreach_channel: document.getElementById('outreach_channel').value,
            campaign_goal: document.getElementById('campaign_goal').value,
        };

        // Set loading state
        setLoadingState(true);

        try {
            // Save to localStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(campaignContext));

            // Attempt to save to Flask backend
            await saveToBackend(campaignContext);

            // Show success toast
            showSuccessToast();

            // Redirect to Stage 2 after a short delay
            setTimeout(() => {
                // For now, redirect to a placeholder Stage 2 page
                // In production, this would be: window.location.href = 'leads.html';
                window.location.href = 'stage2.html';
            }, 1800);

        } catch (error) {
            console.warn('Backend save failed, data saved to localStorage only:', error.message);

            // Still show success — localStorage is the primary store
            showSuccessToast();

            setTimeout(() => {
                window.location.href = 'stage2.html';
            }, 1800);
        } finally {
            setLoadingState(false);
        }
    });

    // ─── Backend Save ───
    async function saveToBackend(data) {
        const response = await fetch(FLASK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        return await response.json();
    }

    // ─── UI Helpers ───
    function setLoadingState(loading) {
        if (loading) {
            submitBtn.classList.add('btn-loading');
            submitBtn.innerHTML = `
                <svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving…
            `;
        } else {
            submitBtn.classList.remove('btn-loading');
            submitBtn.innerHTML = `
                Save & Continue
                <i data-lucide="arrow-right" class="w-4 h-4 transition-transform group-hover:translate-x-1"></i>
            `;
            // Re-render lucide icons so the arrow appears
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    function showSuccessToast() {
        successToast.classList.remove('hidden');
        // Re-render icons inside toast
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        setTimeout(() => {
            successToast.classList.add('hidden');
        }, 3000);
    }

    // ─── Restore form data from localStorage (if exists) ───
    function restoreFormData() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;

        try {
            const data = JSON.parse(saved);

            if (data.industry) document.getElementById('industry').value = data.industry;
            if (data.company_name) document.getElementById('company_name').value = data.company_name;
            if (data.product_description) document.getElementById('product_description').value = data.product_description;
            if (data.target_customer) document.getElementById('target_customer').value = data.target_customer;
            if (data.campaign_goal) document.getElementById('campaign_goal').value = data.campaign_goal;

            // Restore geographies
            if (data.target_geography) {
                const geos = data.target_geography.split(', ').map(g => g.trim());
                geoCheckboxes.forEach(cb => {
                    if (geos.includes(cb.value)) {
                        cb.checked = true;
                    }
                });
                updateSelectedGeographies();
            }
        } catch (e) {
            console.warn('Could not restore form data:', e);
        }
    }

    restoreFormData();
});

