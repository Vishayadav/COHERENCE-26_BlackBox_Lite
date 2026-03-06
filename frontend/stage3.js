const API_BASE = "";
const CONTEXT_KEY = "campaign_context";
const EMAILS_KEY = "generated_emails_v2";

const intentForm = document.getElementById("intent-form");
const generateBtn = document.getElementById("generate-btn");
const previewSection = document.getElementById("preview-section");
const leadCardsContainer = document.getElementById("lead-cards-container");
const downloadBtn = document.getElementById("download-csv-btn");
const continueBtn = document.getElementById("continue-workflow-btn");

// Refine Sidebar Elements
const refineOverlay = document.getElementById("refine-overlay");
const refineSidebar = document.getElementById("refine-sidebar");
const closeRefine = document.getElementById("close-refine");
const refineLeadInfo = document.getElementById("refine-lead-info");
const refineFeedback = document.getElementById("refine-feedback");
const submitRefine = document.getElementById("submit-refine");
const refineLoading = document.getElementById("refine-loading");

let currentLeads = [];
let leadEmails = {}; // { lead_id: { variants: [], selectedIdx: 0 } }
let activeRefineLead = null;

async function init() {
    await fetchLeads();
    const existingData = localStorage.getItem(EMAILS_KEY);
    if (existingData) {
        leadEmails = JSON.parse(existingData);
        renderLeadCards();
        previewSection.classList.remove("hidden");
    }
    
    // Auto-fill from context
    const savedContext = JSON.parse(localStorage.getItem(CONTEXT_KEY) || "{}");
    if (savedContext.industry) {
        document.getElementById("target_audience").value = savedContext.target_customer || "";
        document.getElementById("product_description").value = savedContext.product_description || "";
        document.getElementById("campaign_goal").value = savedContext.campaign_goal || "Book a Demo";
        
        if (savedContext.outreach_channel === "WhatsApp") {
            document.getElementById("ai_prompt").value = "Generate 3 personalized WhatsApp message variants. Keep them concise (under 300 chars), professional yet conversational. NO placeholders like [Name].";
            document.querySelectorAll('h1').forEach(h1 => {
                if (h1.textContent.includes("Email")) h1.textContent = h1.textContent.replace("Email", "WhatsApp");
            });
            // Update Continue Button text
            const btn = document.getElementById("continue-workflow-btn");
            if (btn) btn.innerHTML = `<i data-lucide="zap" class="w-4 h-4 mr-2"></i> Continue to WhatsApp Engine`;
        }
    }
}

async function fetchLeads() {
    try {
        const response = await fetch(`${API_BASE}/api/leads`);
        const data = await response.json();
        currentLeads = data.items || [];
    } catch (err) {
        console.error("Failed to fetch leads", err);
    }
}

intentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    generateBtn.disabled = true;
    const originalBtnText = generateBtn.innerHTML;
    generateBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Initializing AI Engine...`;
    if (typeof lucide !== "undefined") lucide.createIcons();

    const personalization_variables = Array.from(document.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);

    const payload = {
        campaign_name: document.getElementById("campaign_name").value,
        target_audience: document.getElementById("target_audience").value,
        product_description: document.getElementById("product_description").value,
        value_proposition: document.getElementById("value_proposition").value,
        campaign_goal: document.getElementById("campaign_goal").value,
        personalization_variables: personalization_variables,
        prompt: document.getElementById("ai_prompt").value,
        lead_ids: currentLeads.map(l => l.lead_id).slice(0, 5) // Generate for first 5 to show personalization
    };

    try {
        const response = await fetch(`${API_BASE}/api/generate-emails`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Generation failed");

        // Map results
        leadEmails = {};
        result.data.forEach(item => {
            leadEmails[item.lead_id] = {
                variants: item.variants,
                selectedIdx: 0
            };
        });

        saveAndRender();
        previewSection.classList.remove("hidden");
        previewSection.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = originalBtnText;
        if (typeof lucide !== "undefined") lucide.createIcons();
    }
});

function saveAndRender() {
    localStorage.setItem(EMAILS_KEY, JSON.stringify(leadEmails));
    renderLeadCards();
}

function renderLeadCards() {
    leadCardsContainer.innerHTML = "";
    
    currentLeads.forEach(lead => {
        const data = leadEmails[lead.lead_id];
        if (!data) return;

        const card = document.createElement("div");
        card.className = "bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden flex flex-col md:flex-row";
        
        const activeVariant = data.variants[data.selectedIdx];

        card.innerHTML = `
            <!-- Left Header -->
            <div class="w-full md:w-72 bg-surface-50 p-6 border-b md:border-b-0 md:border-r border-surface-200">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white font-bold">
                        ${lead.name.charAt(0)}
                    </div>
                    <div>
                        <h4 class="font-bold text-black text-sm">${lead.name}</h4>
                        <p class="text-[10px] font-semibold text-surface-500 uppercase tracking-tight">${lead.company}</p>
                    </div>
                </div>
                
                <div class="space-y-2">
                    <p class="text-xs text-surface-600"><i data-lucide="mail" class="w-3.5 h-3.5 inline mr-1"></i> ${lead.email}</p>
                    ${lead.phone ? `<p class="text-xs text-surface-600"><i data-lucide="phone" class="w-3.5 h-3.5 inline mr-1"></i> ${lead.phone}</p>` : ''}
                    <p class="text-xs text-surface-600"><i data-lucide="briefcase" class="w-3.5 h-3.5 inline mr-1"></i> ${lead.industry}</p>
                </div>

                <div class="mt-8">
                    <p class="text-[10px] font-bold text-surface-400 uppercase tracking-widest mb-3">Variants</p>
                    <div class="flex flex-col gap-2">
                        ${data.variants.map((v, i) => `
                            <button onclick="switchVariant(${lead.lead_id}, ${i})" class="text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all ${data.selectedIdx === i ? 'bg-black text-white shadow-md' : 'bg-white text-surface-600 border border-surface-200 hover:bg-surface-100'}">
                                Variant ${i + 1}
                            </button>
                        `).join("")}
                    </div>
                </div>
            </div>

            <!-- Right Content -->
            <div class="flex-1 p-6 flex flex-col">
                <div class="flex items-center justify-between mb-4">
                    <div class="px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-[10px] font-bold uppercase tracking-wider">
                        Personalized Sequence
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="openRefine(${lead.lead_id})" class="p-2 text-surface-600 hover:text-black hover:bg-surface-100 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-bold">
                            <i data-lucide="wand-2" class="w-3.5 h-3.5"></i> Refine with AI
                        </button>
                    </div>
                </div>

                <div class="mb-4">
                    <span class="text-[10px] font-bold text-surface-400 uppercase tracking-widest block mb-1">Subject</span>
                    <h5 class="text-sm font-bold text-black border-b border-surface-100 pb-2">${activeVariant.subject}</h5>
                </div>

                <div class="flex-1">
                    <span class="text-[10px] font-bold text-surface-400 uppercase tracking-widest block mb-1">Body</span>
                    <div class="text-sm text-surface-600 leading-relaxed whitespace-pre-wrap font-medium p-4 bg-surface-50 rounded-xl border border-surface-100 min-h-[150px]">
                        ${activeVariant.body}
                    </div>
                </div>
            </div>
        `;
        leadCardsContainer.appendChild(card);
    });
    if (typeof lucide !== "undefined") lucide.createIcons();
}

window.switchVariant = (leadId, idx) => {
    leadEmails[leadId].selectedIdx = idx;
    saveAndRender();
};

window.openRefine = (leadId) => {
    activeRefineLead = currentLeads.find(l => l.lead_id === leadId);
    if (!activeRefineLead) return;

    refineLeadInfo.textContent = `${activeRefineLead.name} @ ${activeRefineLead.company}`;
    refineFeedback.value = "";
    
    refineOverlay.classList.remove("hidden");
    setTimeout(() => {
        refineSidebar.classList.remove("translate-x-full");
    }, 10);
};

closeRefine.addEventListener("click", () => {
    refineSidebar.classList.add("translate-x-full");
    setTimeout(() => {
        refineOverlay.classList.add("hidden");
    }, 300);
});

submitRefine.addEventListener("click", async () => {
    const feedback = refineFeedback.value.trim();
    if (!feedback) return;

    const leadData = leadEmails[activeRefineLead.lead_id];
    const current = leadData.variants[leadData.selectedIdx];

    refineLoading.classList.remove("hidden");
    submitRefine.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/refine-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                lead_name: activeRefineLead.name,
                company: activeRefineLead.company,
                current_subject: current.subject,
                current_body: current.body,
                feedback: feedback
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error("Refinement failed");

        // Add refined version as a new variant
        leadData.variants.push({
            subject: result.subject,
            body: result.body
        });
        leadData.selectedIdx = leadData.variants.length - 1;

        saveAndRender();
        closeRefine.click();

    } catch (err) {
        alert("Error: " + err.message);
    } finally {
        refineLoading.classList.add("hidden");
        submitRefine.disabled = false;
    }
});

continueBtn.addEventListener("click", async () => {
    const selectedData = [];
    currentLeads.forEach(lead => {
        const data = leadEmails[lead.lead_id];
        if (data) {
            const v = data.variants[data.selectedIdx];
            selectedData.push({
                lead_id: lead.lead_id,
                name: lead.name,
                email: lead.email,
                phone: lead.phone || "",
                subject: v.subject,
                body: v.body
            });
        }
    });

    if (!selectedData.length) {
        alert("Please generate emails first!");
        return;
    }

    // Placeholder Check Guard
    const placeholderRegex = /\[.*?\]|\{\{.*?\}\}|<.*?>/;
    const hasPlaceholders = selectedData.some(e => placeholderRegex.test(e.subject) || placeholderRegex.test(e.body));
    
    if (hasPlaceholders) {
        if (!confirm("Caution: We detected potential placeholders (like [Name] or {{Company}}) in your emails. Are you sure you want to save? We recommend refining them first.")) {
            return;
        }
    }

    continueBtn.disabled = true;
    const originalText = continueBtn.innerHTML;
    continueBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Finalizing Campaign...`;
    if (typeof lucide !== "undefined") lucide.createIcons();

    try {
        const response = await fetch(`${API_BASE}/api/save-campaign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                campaign_name: document.getElementById("campaign_name").value || "Unnamed Campaign",
                emails: selectedData
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error("Failed to save campaign");

        alert(`Campaign "${document.getElementById("campaign_name").value}" has been saved and is ready for sending!\nRun ID: ${result.run_id}`);
        
        window.location.href = `stage4.html?run_id=${result.run_id}`;

    } catch (err) {
        alert("Error saving campaign: " + err.message);
    } finally {
        continueBtn.disabled = false;
        continueBtn.innerHTML = originalText;
        if (typeof lucide !== "undefined") lucide.createIcons();
    }
});

downloadBtn.addEventListener("click", () => {
    const selectedData = [];
    currentLeads.forEach(lead => {
        const data = leadEmails[lead.lead_id];
        if (data) {
            const v = data.variants[data.selectedIdx];
            selectedData.push({
                lead_id: lead.lead_id,
                name: lead.name,
                email: lead.email,
                phone: lead.phone || "",
                subject: v.subject,
                body: v.body
            });
        }
    });

    if (!selectedData.length) return;

    let csvContent = "data:text/csv;charset=utf-8,LeadID,Name,Email,Phone,Subject,Body\n";
    selectedData.forEach(row => {
        const line = [
            row.lead_id,
            `"${row.name.replace(/"/g, '""')}"`,
            row.email,
            `"${row.phone}"`,
            `"${row.subject.replace(/"/g, '""')}"`,
            `"${row.body.replace(/"/g, '""')}"`
        ].join(",");
        csvContent += line + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = "personalized_campaign.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

init();
