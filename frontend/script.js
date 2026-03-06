/**
 * OutreachFlow AI - Campaign Setup Form Logic
 * Handles form validation, geography multi-select, localStorage persistence,
 * and backend submission with endpoint fallback.
 */

document.addEventListener("DOMContentLoaded", () => {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  const form = document.getElementById("campaign-form");
  const geoToggle = document.getElementById("geo-toggle");
  const geoOptions = document.getElementById("geo-options");
  const geoChevron = document.getElementById("geo-chevron");
  const geoPlaceholder = document.getElementById("geo-placeholder");
  const geoTagsContainer = document.getElementById("geo-tags");
  const geoDropdown = document.getElementById("geo-dropdown");
  const geoCheckboxes = document.querySelectorAll(".geo-checkbox");
  const successToast = document.getElementById("success-toast");
  const submitBtn = document.getElementById("submit-btn");
  const channelChips = document.querySelectorAll(".channel-chip");
  const outreachChannelInput = document.getElementById("outreach_channel");

  if (
    !form ||
    !geoToggle ||
    !geoOptions ||
    !geoChevron ||
    !geoPlaceholder ||
    !geoTagsContainer ||
    !geoDropdown ||
    !successToast ||
    !submitBtn
  ) {
    console.error("Setup form initialization failed: required elements not found.");
    return;
  }

  const BACKEND_ENDPOINTS = [
    "http://127.0.0.1:8000/api/context",
    "http://127.0.0.1:5000/save-campaign",
  ];
  const STORAGE_KEY = "campaign_context";

  const REQUIRED_FIELDS = [
    { id: "industry", label: "Industry" },
    { id: "company_name", label: "Company Name" },
    { id: "product_description", label: "Product Description" },
    { id: "target_customer", label: "Target Customer Type" },
    { id: "campaign_goal", label: "Campaign Goal" },
  ];

  let selectedGeographies = [];

  geoToggle.addEventListener("click", (event) => {
    event.preventDefault();
    const isOpen = !geoOptions.classList.contains("hidden");
    toggleGeoDropdown(!isOpen);
  });

  document.addEventListener("click", (event) => {
    if (!geoDropdown.contains(event.target)) {
      toggleGeoDropdown(false);
    }
  });

  function toggleGeoDropdown(open) {
    geoOptions.classList.toggle("hidden", !open);
    geoChevron.style.transform = open ? "rotate(180deg)" : "rotate(0deg)";
  }

  geoCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", updateSelectedGeographies);
  });

  // Channel Selection
  channelChips.forEach(chip => {
    chip.addEventListener("click", () => {
      channelChips.forEach(c => {
        c.classList.remove("selected", "border-black", "ring-1", "ring-black", "bg-brand-50");
        c.classList.add("border-surface-200", "bg-surface-50");
        
        // Fix text colors for non-selected
        const span = c.querySelector("span:not(.bg-brand-200)");
        if (span) {
           span.classList.remove("text-brand-700", "font-semibold");
           span.classList.add("text-surface-600", "font-medium");
        }
      });
      
      chip.classList.add("selected", "border-black", "ring-1", "ring-black", "bg-brand-50");
      chip.classList.remove("border-surface-200", "bg-surface-50");
      
      // Fix text colors for selected
      const span = chip.querySelector("span:not(.bg-brand-200)");
      if (span) {
          span.classList.add("text-brand-700", "font-semibold");
          span.classList.remove("text-surface-600", "font-medium");
      }
      
      const channel = chip.dataset.channel;
      if (outreachChannelInput) outreachChannelInput.value = channel;
    });
  });

  function updateSelectedGeographies() {
    selectedGeographies = Array.from(geoCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    renderGeoTags();
    updateGeoPlaceholder();
  }

  function updateGeoPlaceholder() {
    if (selectedGeographies.length === 0) {
      geoPlaceholder.textContent = "Select regions";
      geoPlaceholder.classList.add("text-surface-500");
      geoPlaceholder.classList.remove("text-white");
      return;
    }

    geoPlaceholder.textContent = `${selectedGeographies.length} region${selectedGeographies.length > 1 ? "s" : ""} selected`;
    geoPlaceholder.classList.remove("text-surface-500");
    geoPlaceholder.classList.add("text-white");
  }

  function renderGeoTags() {
    geoTagsContainer.innerHTML = "";
    selectedGeographies.forEach((geo) => {
      const tag = document.createElement("span");
      tag.className = "geo-tag";
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

    geoTagsContainer.querySelectorAll("button[data-geo]").forEach((button) => {
      button.addEventListener("click", () => {
        const geoValue = button.dataset.geo;
        geoCheckboxes.forEach((cb) => {
          if (cb.value === geoValue) cb.checked = false;
        });
        updateSelectedGeographies();
      });
    });
  }

  function validateForm() {
    let isValid = true;
    REQUIRED_FIELDS.forEach((field) => {
      const element = document.getElementById(field.id);
      if (!element) return;
      const group = element.closest(".form-group");
      const value = element.value.trim();

      if (!value) {
        group?.classList.add("has-error");
        isValid = false;
      } else {
        group?.classList.remove("has-error");
      }
    });
    return isValid;
  }

  REQUIRED_FIELDS.forEach((field) => {
    const element = document.getElementById(field.id);
    if (!element) return;
    const eventType = element.tagName === "SELECT" ? "change" : "input";
    element.addEventListener(eventType, () => {
      const group = element.closest(".form-group");
      if (element.value.trim()) group?.classList.remove("has-error");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!validateForm()) {
      const firstError = form.querySelector(".has-error");
      firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const campaignContext = {
      industry: document.getElementById("industry").value,
      company_name: document.getElementById("company_name").value.trim(),
      product_description: document.getElementById("product_description").value.trim(),
      target_customer: document.getElementById("target_customer").value,
      target_geography: selectedGeographies.length ? selectedGeographies.join(", ") : "Global",
      outreach_channel: document.getElementById("outreach_channel").value,
      campaign_goal: document.getElementById("campaign_goal").value,
    };

    setLoadingState(true);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(campaignContext));
      await saveToBackend(campaignContext);
      showSuccessToast();
      setTimeout(() => {
        window.location.href = "stage2.html";
      }, 1800);
    } catch (error) {
      console.warn("Backend save failed, data saved to localStorage only:", error.message);
      showSuccessToast();
      setTimeout(() => {
        window.location.href = "stage2.html";
      }, 1800);
    } finally {
      setLoadingState(false);
    }
  });

  async function saveToBackend(data) {
    let lastError = new Error("No backend endpoint reachable");

    for (const endpoint of BACKEND_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(`Server ${endpoint} responded with ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  function setLoadingState(loading) {
    if (loading) {
      submitBtn.classList.add("btn-loading");
      submitBtn.innerHTML = `
        <svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Saving...
      `;
      return;
    }

    submitBtn.classList.remove("btn-loading");
    submitBtn.innerHTML = `
      Save & Continue
      <i data-lucide="arrow-right" class="w-4 h-4 transition-transform group-hover:translate-x-1"></i>
    `;
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  }

  function showSuccessToast() {
    successToast.classList.remove("hidden");
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
    setTimeout(() => {
      successToast.classList.add("hidden");
    }, 3000);
  }

  function restoreFormData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const data = JSON.parse(saved);

      if (data.industry) document.getElementById("industry").value = data.industry;
      if (data.company_name) document.getElementById("company_name").value = data.company_name;
      if (data.product_description) document.getElementById("product_description").value = data.product_description;
      if (data.target_customer) document.getElementById("target_customer").value = data.target_customer;
      if (data.campaign_goal) document.getElementById("campaign_goal").value = data.campaign_goal;

      if (data.target_geography) {
        const geos = data.target_geography.split(",").map((g) => g.trim());
        geoCheckboxes.forEach((cb) => {
          if (geos.includes(cb.value)) cb.checked = true;
        });
        updateSelectedGeographies();
      }

      if (data.outreach_channel) {
        const targetChip = Array.from(channelChips).find(c => c.dataset.channel === data.outreach_channel);
        if (targetChip) targetChip.click();
      }
    } catch (error) {
      console.warn("Could not restore form data:", error);
    }
  }

  restoreFormData();
});
