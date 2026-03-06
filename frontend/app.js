const STORAGE_KEY = "outreachflow_campaign_context";
const STORAGE_LIST_KEY = "outreachflow_campaign_context_history";

const landing = document.getElementById("landing");
const formSection = document.getElementById("formSection");
const startAutomationBtn = document.getElementById("startAutomationBtn");
const campaignForm = document.getElementById("campaignForm");
const statusText = document.getElementById("statusText");
const contextPreview = document.getElementById("contextPreview");

startAutomationBtn.addEventListener("click", () => {
  formSection.classList.remove("hidden");
  formSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

function getMultiSelectValues(selectId) {
  const select = document.getElementById(selectId);
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function buildContextObject() {
  return {
    industry: document.getElementById("industry").value.trim(),
    company_name: document.getElementById("companyName").value.trim(),
    product: document.getElementById("productDescription").value.trim(),
    target_customer: document.getElementById("targetCustomerType").value.trim(),
    region: getMultiSelectValues("targetGeography"),
    preferred_channel: document.getElementById("preferredChannel").value.trim(),
    campaign_goal: document.getElementById("campaignGoal").value.trim(),
    created_at: new Date().toISOString(),
  };
}

function updatePreview(contextObj) {
  contextPreview.textContent = JSON.stringify(contextObj, null, 2);
}

function persistLocal(contextObj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contextObj));
  const history = JSON.parse(localStorage.getItem(STORAGE_LIST_KEY) || "[]");
  history.push(contextObj);
  localStorage.setItem(STORAGE_LIST_KEY, JSON.stringify(history));
}

async function syncToBackend(contextObj) {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contextObj),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }
    return true;
  } catch (error) {
    return false;
  }
}

campaignForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusText.textContent = "Saving context...";

  const contextObj = buildContextObject();
  persistLocal(contextObj);
  updatePreview(contextObj);

  const backendSaved = await syncToBackend(contextObj);
  statusText.textContent = backendSaved
    ? "Saved in localStorage and backend local DB."
    : "Saved in localStorage. Backend not reachable.";
});

(() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    updatePreview(JSON.parse(saved));
  }
})();
