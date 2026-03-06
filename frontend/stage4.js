const API_BASE = ""; // Use relative paths
const CONTEXT_KEY = "campaign_context";

const workflowCards = document.querySelectorAll(".workflow-card");
const executionSection = document.getElementById("execution-section");
const connectGmailBtn = document.getElementById("connect-gmail");
const authContainer = document.getElementById("auth-container");
const launchContainer = document.getElementById("launch-container");
const launchNowBtn = document.getElementById("launch-now");
const statusContainer = document.getElementById("status-container");
const progressBar = document.getElementById("progress-bar");
const progressPercent = document.getElementById("progress-percent");
const statusText = document.getElementById("status-text");

let selectedWorkflow = null;
let currentRunId = new URLSearchParams(window.location.search).get("run_id");
let isPolling = false;

// Removed OAuth redirect logic
async function init() {
    if (window.location.hostname === "127.0.0.1") {
        console.warn("Please use http://localhost:8000 for consistency.");
    }
    
    const savedContext = JSON.parse(localStorage.getItem(CONTEXT_KEY) || "{}");
    console.log("Current Stage 4 Context:", savedContext);
    
    if (savedContext.outreach_channel === "WhatsApp") {
        console.log("Activating WhatsApp UI Mode...");
        setupWhatsAppUI();
    } else {
        console.log("Activating Email UI Mode (Checking SMTP)...");
        await checkConnection();
    }
}

function setupWhatsAppUI() {
    // Hide email-specific auth
    authContainer.classList.add("hidden");
    launchContainer.classList.remove("hidden");
    
    // Update headers
    const mainTitle = document.querySelector("h1");
    if (mainTitle) mainTitle.textContent = "Choose Your WhatsApp Workflow";
    
    // Update launch text
    launchNowBtn.innerHTML = `<i data-lucide="zap" class="w-4 h-4 mr-2"></i> Launch WhatsApp Campaign`;
    if (typeof lucide !== "undefined") lucide.createIcons();

    // Replace workflow cards with WhatsApp templates
    const grid = document.querySelector("main .grid");
    if (grid) {
        grid.innerHTML = `
            <div class="workflow-card bg-white p-8 rounded-3xl border border-surface-200 shadow-sm hover:shadow-xl transition-all flex flex-col group cursor-pointer" data-workflow="whatsapp-direct">
                <div class="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-600 mb-6 group-hover:bg-brand-500 group-hover:text-black transition-colors">
                    <i data-lucide="message-square" class="w-8 h-8"></i>
                </div>
                <h3 class="text-2xl font-bold text-black mb-3">Direct Message</h3>
                <p class="text-surface-600 text-sm mb-6 flex-1">Send a hyper-personalized WhatsApp message directly to your leads' phones. High response rates guaranteed.</p>
                <button class="w-full py-3 rounded-xl bg-black text-white font-bold text-sm group-hover:bg-brand-500 group-hover:text-black transition-colors">Select Template</button>
            </div>
            <div class="workflow-card bg-white p-8 rounded-3xl border border-surface-200 shadow-sm hover:shadow-xl transition-all flex flex-col group cursor-pointer" data-workflow="nurture">
                <div class="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-600 mb-6 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                    <i data-lucide="refresh-cw" class="w-8 h-8"></i>
                </div>
                <h3 class="text-2xl font-bold text-black mb-3">WhatsApp Sequence</h3>
                <p class="text-surface-600 text-sm mb-6 flex-1">Strategic follow-ups on WhatsApp if they don't respond. Maintains a professional human touch in chats.</p>
                <button class="w-full py-3 rounded-xl bg-black text-white font-bold text-sm group-hover:bg-blue-500 group-hover:text-white transition-colors">Select Template</button>
            </div>
            <div class="workflow-card bg-white p-8 rounded-3xl border border-surface-200 shadow-sm hover:shadow-xl transition-all flex flex-col group cursor-pointer" data-workflow="whatsapp-broadcast">
                <div class="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center text-purple-600 mb-6 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                    <i data-lucide="users" class="w-8 h-8"></i>
                </div>
                <h3 class="text-2xl font-bold text-black mb-3">Bulk Broadcast</h3>
                <p class="text-surface-600 text-sm mb-6 flex-1">Rapid notification system across all selected leads. Perfect for announcements or limited-time events.</p>
                <button class="w-full py-3 rounded-xl bg-black text-white font-bold text-sm group-hover:bg-purple-500 group-hover:text-white transition-colors">Select Template</button>
            </div>
        `;
        
        // Re-attach listeners for new cards
        document.querySelectorAll(".workflow-card").forEach(card => {
            card.addEventListener("click", () => {
                document.querySelectorAll(".workflow-card").forEach(c => c.classList.remove("border-black", "ring-2", "ring-black"));
                card.classList.add("border-black", "ring-2", "ring-black");
                selectedWorkflow = card.dataset.workflow;
                executionSection.classList.remove("hidden");
                executionSection.scrollIntoView({ behavior: 'smooth' });
            });
        });
        if (typeof lucide !== "undefined") lucide.createIcons();
    }
}

async function checkConnection() {
    console.log("Checking SMTP connection status...");
    try {
        const res = await fetch(`${API_BASE}/api/auth/check`);
        const data = await res.json();
        console.log("Auth Check Result:", data);
        if (data.authenticated) {
            authContainer.classList.add("hidden");
            launchContainer.classList.remove("hidden");
            if (data.user) {
               launchContainer.insertAdjacentHTML('afterbegin', `<div id="smtp-banner" class="mb-4 text-xs font-semibold text-surface-500 bg-surface-50 p-2 rounded border border-surface-100 italic flex justify-between items-center">
                    <span>Configured SMTP: ${data.user}</span>
                    <button onclick="toggleSMTPForm()" class="text-brand-600 hover:underline">Change</button>
               </div>`);
            }
        } else {
            console.warn("SMTP NOT configured.");
            authContainer.classList.remove("hidden");
            launchContainer.classList.add("hidden");
        }
    } catch (err) {
        console.error("Auth check failed critical error:", err);
    }
}

workflowCards.forEach(card => {
    card.addEventListener("click", () => {
        if (card.classList.contains("cursor-not-allowed")) return;
        
        // Visual Selection
        workflowCards.forEach(c => c.classList.remove("border-black", "ring-2", "ring-black"));
        card.classList.add("border-black", "ring-2", "ring-black");
        
        selectedWorkflow = card.dataset.workflow;
        executionSection.classList.remove("hidden");
        executionSection.scrollIntoView({ behavior: 'smooth' });
    });
});

connectGmailBtn.addEventListener("click", () => {
    toggleSMTPForm();
});

function toggleSMTPForm() {
    const existingForm = document.getElementById("smtp-form-modal");
    if (existingForm) {
        existingForm.remove();
        return;
    }

    const modal = document.createElement("div");
    modal.id = "smtp-form-modal";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4";
    modal.innerHTML = `
        <div class="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md border border-brand-100 animate-in fade-in zoom-in duration-300">
            <h3 class="text-2xl font-bold text-black mb-6">Configure SMTP</h3>
            <div class="space-y-4">
                <div>
                    <label class="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-1">SMTP Host</label>
                    <input type="text" id="smtp-host" placeholder="smtp.gmail.com" class="w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500" value="smtp.gmail.com">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-1">Port</label>
                        <input type="number" id="smtp-port" placeholder="587" class="w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500" value="587">
                    </div>
                    <div class="flex items-end pb-3">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="smtp-tls" checked class="w-5 h-5 accent-brand-500 rounded-lg">
                            <span class="text-sm font-semibold">Use TLS</span>
                        </label>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-1">Username (Email)</label>
                    <input type="email" id="smtp-user" placeholder="your@email.com" class="w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500">
                </div>
                <div>
                    <label class="block text-xs font-bold text-surface-500 uppercase tracking-wider mb-1">App Password</label>
                    <input type="password" id="smtp-pass" placeholder="•••• •••• •••• ••••" class="w-full px-4 py-3 rounded-xl bg-surface-50 border border-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500">
                </div>
                <div class="pt-4 flex gap-3">
                    <button onclick="toggleSMTPForm()" class="flex-1 px-6 py-3 rounded-xl border border-surface-200 font-bold hover:bg-surface-50 transition-colors">Cancel</button>
                    <button id="save-smtp-btn" class="flex-2 px-6 py-3 rounded-xl bg-brand-500 text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand-500/20">Save & Test</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("save-smtp-btn").addEventListener("click", async () => {
        const btn = document.getElementById("save-smtp-btn");
        const payload = {
            smtp_host: document.getElementById("smtp-host").value,
            smtp_port: parseInt(document.getElementById("smtp-port").value),
            smtp_user: document.getElementById("smtp-user").value,
            smtp_pass: document.getElementById("smtp-pass").value,
            use_tls: document.getElementById("smtp-tls").checked
        };

        btn.disabled = true;
        btn.innerHTML = `<span class="animate-spin inline-block mr-2">⏳</span> Testing...`;

        try {
            const res = await fetch(`${API_BASE}/api/auth/smtp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || "Connection failed");

            alert("SMTP Connected Successfully!");
            modal.remove();
            
            // Remove existing banner if any
            const oldBanner = document.getElementById("smtp-banner");
            if (oldBanner) oldBanner.remove();
            
            checkConnection();
        } catch (err) {
            alert("SMTP Error: " + err.message);
            btn.disabled = false;
            btn.innerHTML = `Save & Test`;
        }
    });
}

launchNowBtn.addEventListener("click", async () => {
    if (!currentRunId) {
        alert("No valid campaign run identified.");
        return;
    }

    if (!selectedWorkflow) {
        alert("Please select a workflow card first.");
        return;
    }

    console.log(`Launching campaign ${currentRunId} with workflow ${selectedWorkflow}`);
    launchNowBtn.disabled = true;
    launchNowBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Initializing Launch...`;
    if (typeof lucide !== "undefined") lucide.createIcons();

    try {
        const res = await fetch(`${API_BASE}/api/campaign/launch/${currentRunId}?workflow=${selectedWorkflow}`, {
            method: "POST"
        });
        const data = await res.json();
        console.log("Launch response:", data);
        
        if (!res.ok) throw new Error(data.detail || "Launch failed");

        launchContainer.classList.add("hidden");
        statusContainer.classList.remove("hidden");
        startPolling();

    } catch (err) {
        console.error("Launch process failed:", err);
        alert("Launch failed: " + err.message);
        launchNowBtn.disabled = false;
        launchNowBtn.innerHTML = `<i data-lucide="rocket" class="w-5 h-5"></i> Launch Campaign Now`;
    }
});

function startPolling() {
    if (isPolling) return;
    isPolling = true;
    
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/campaign/status/${currentRunId}`);
            const data = await res.json();
            
            const percent = data.total > 0 ? Math.round((data.sent / data.total) * 100) : 0;
            progressBar.style.width = `${percent}%`;
            progressPercent.textContent = `${percent}%`;
            
            if (data.status === "completed") {
                statusText.innerHTML = `
                    <div class="flex flex-col items-center gap-2 p-6 bg-brand-50 border border-brand-200 rounded-2xl animate-pulse">
                        <i data-lucide="party-popper" class="w-10 h-10 text-brand-600"></i>
                        <span class="text-brand-600 font-extrabold text-lg">Campaign Successfully Sent!</span>
                        <p class="text-sm text-brand-700">${data.sent} personalized emails reached their destinations.</p>
                    </div>
                `;
                alert("Campaign Success: All emails have been delivered!");
                clearInterval(interval);
                isPolling = false;
                if (typeof lucide !== "undefined") lucide.createIcons();
                
                // Redirect to dashboard after showing success
                setTimeout(() => {
                    window.location.href = "outreach_dashboard.html";
                }, 2500);
            } else if (data.status.startsWith("error")) {
                const errMsg = data.status.replace('error: ', '');
                statusText.innerHTML = `
                    <div class="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                        <span class="font-bold">Sending Halted:</span> ${errMsg}
                    </div>
                `;
                alert("Sending Halted: " + errMsg);
                clearInterval(interval);
                isPolling = false;
            } else {
                statusText.innerHTML = `
                    <div class="flex items-center justify-between text-sm font-semibold">
                        <span class="text-surface-600">Delivering Sequence...</span>
                        <span class="text-black">${data.sent} / ${data.total}</span>
                    </div>
                `;
            }

        } catch (err) {
            console.error("Polling error", err);
        }
    }, 2000);
}

function confetti() {
    // Simple visual feedback
    const end = Date.now() + 2 * 1000;
    // Just a placeholder for actual confetti if library was present
    console.log("CONFETTI!");
}

init();
