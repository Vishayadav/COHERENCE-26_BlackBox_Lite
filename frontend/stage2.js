const API_BASE = "";
const CONTEXT_KEY = "campaign_context";

const tabUploadBtn = document.getElementById("tab-upload");
const tabGenerateBtn = document.getElementById("tab-generate");
const panelUpload = document.getElementById("panel-upload");
const panelGenerate = document.getElementById("panel-generate");
const csvUploadForm = document.getElementById("csv-upload-form");
const generateForm = document.getElementById("generate-form");
const uploadStatus = document.getElementById("upload-status");
const generateStatus = document.getElementById("generate-status");
const csvDownloadLink = document.getElementById("csv-download-link");
const leadTableBody = document.getElementById("lead-table-body");
const campaignSummary = document.getElementById("campaign-summary");
const summaryDetails = document.getElementById("summary-details");

if (typeof lucide !== "undefined") {
  lucide.createIcons();
}

function setActiveTab(tab) {
  const uploadActive = tab === "upload";
  panelUpload.classList.toggle("hidden", !uploadActive);
  panelGenerate.classList.toggle("hidden", uploadActive);

  tabUploadBtn.classList.toggle("bg-brand-600", uploadActive);
  tabUploadBtn.classList.toggle("text-white", uploadActive);
  tabUploadBtn.classList.toggle("border", !uploadActive);
  tabUploadBtn.classList.toggle("border-surface-700", !uploadActive);
  tabUploadBtn.classList.toggle("text-surface-300", !uploadActive);

  tabGenerateBtn.classList.toggle("bg-brand-600", !uploadActive);
  tabGenerateBtn.classList.toggle("text-white", !uploadActive);
  tabGenerateBtn.classList.toggle("border", uploadActive);
  tabGenerateBtn.classList.toggle("border-surface-700", uploadActive);
  tabGenerateBtn.classList.toggle("text-surface-300", uploadActive);
}

function renderSummary() {
  const raw = localStorage.getItem(CONTEXT_KEY);
  if (!raw) {
    campaignSummary.classList.add("hidden");
    return null;
  }

  try {
    const data = JSON.parse(raw);
    const fields = [
      { label: "Industry", value: data.industry },
      { label: "Company", value: data.company_name },
      { label: "Target", value: data.target_customer },
      { label: "Geography", value: data.target_geography || "Global" },
      { label: "Channel", value: data.outreach_channel || "Email" },
      { label: "Goal", value: data.campaign_goal },
    ];

    summaryDetails.innerHTML = fields
      .map(
        (field) => `
        <div>
          <span class="text-surface-500 text-xs font-semibold">${field.label}</span>
          <p class="text-black font-bold">${field.value || "-"}</p>
        </div>
      `
      )
      .join("");
    return data;
  } catch (error) {
    console.warn("Could not parse campaign context:", error);
    campaignSummary.classList.add("hidden");
    return null;
  }
}

function renderLeads(items) {
  if (!items || !items.length) {
    leadTableBody.innerHTML = `
      <tr>
        <td class="px-3 py-3 text-surface-500" colspan="6">No leads yet.</td>
      </tr>
    `;
    return;
  }

  leadTableBody.innerHTML = items
    .slice(0, 40)
    .map(
      (lead) => `
      <tr class="border-t border-surface-800/70">
        <td class="px-3 py-2">${lead.name || "-"}</td>
        <td class="px-3 py-2">${lead.company || "-"}</td>
        <td class="px-3 py-2">${lead.email || "-"}</td>
        <td class="px-3 py-2">${lead.industry || "-"}</td>
        <td class="px-3 py-2">${lead.location || "-"}</td>
        <td class="px-3 py-2">${lead.source || "-"}</td>
      </tr>
    `
    )
    .join("");
}

async function fetchAllLeads() {
  try {
    const response = await fetch(`${API_BASE}/api/leads`);
    if (!response.ok) return;
    const data = await response.json();
    renderLeads(data.items || []);
  } catch (error) {
    console.warn("Could not load existing leads:", error);
  }
}

tabUploadBtn.addEventListener("click", () => setActiveTab("upload"));
tabGenerateBtn.addEventListener("click", () => setActiveTab("generate"));

csvUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadStatus.textContent = "Uploading...";
  csvDownloadLink.classList.add("hidden");

  const fileInput = document.getElementById("csv-file");
  const file = fileInput.files?.[0];
  if (!file) {
    uploadStatus.textContent = "Please select a CSV file.";
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${API_BASE}/api/leads/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Upload failed");
    }

    uploadStatus.textContent = `Inserted ${data.inserted}, rejected ${data.rejected}.`;
    renderLeads(data.items || []);
  } catch (error) {
    uploadStatus.textContent = `Upload failed: ${error.message}`;
  }
});

generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateStatus.textContent = "Generating...";
  csvDownloadLink.classList.add("hidden");

  const campaignContext = renderSummary() || {};
  const payload = {
    mode: document.getElementById("lead-mode").value,
    location: document.getElementById("lead-location").value.trim(),
    max_results: Number(document.getElementById("lead-count").value),
    campaign_context: campaignContext,
  };

  try {
    const response = await fetch(`${API_BASE}/api/leads/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Generation failed");
    }

    generateStatus.textContent = `Generated ${data.count} leads via ${data.source}.`;
    renderLeads(data.items || []);

    if (data.download_url) {
      csvDownloadLink.href = `${API_BASE}${data.download_url}`;
      csvDownloadLink.classList.remove("hidden");
    }
  } catch (error) {
    generateStatus.textContent = `Generation failed: ${error.message}`;
  }
});

setActiveTab("upload");
renderSummary();
renderLeads([]);
fetchAllLeads();
