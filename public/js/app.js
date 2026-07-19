async function fetchData(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Server error');
        }
        return data;
    } catch (err) {
        console.error(`Fetch error (${url}):`, err);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {

    // --- Audio Effects ---
    const clickSound = new Audio('/assets/freesound_community-mouse-click-104737.wav');
    const closeSound = new Audio('/assets/mixkit-stapling-paper-2995.wav');
    clickSound.load();
    closeSound.load();

    document.addEventListener('click', (e) => {
        const member = JSON.parse(localStorage.getItem('crm_member') || '{}');
        const settings = member.settings || { sound_enabled: true };
        if (settings.sound_enabled === false) return; // Sounds disabled

        const target = e.target;
        // Check for close/cancel buttons first
        if (target.closest('.btn-close') || target.closest('[onclick*="close"]') || target.closest('[onclick*="Cancel"]') || target.closest('[onclick*="toggleAddTeamForm"]')) {
            closeSound.currentTime = 0;
            closeSound.play().catch(() => { });
        } else if (target.closest('.btn') || target.closest('.nav-item') || target.closest('button') || target.closest('.sub-nav-item')) {
            clickSound.currentTime = 0;
            clickSound.play().catch(() => { });
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('wf-staff-weight')) {
            if (window.adjustWfSliderLimits) window.adjustWfSliderLimits(e.target);
            if (window.updateWfWeightPercentages) window.updateWfWeightPercentages();
        }
    });

    // --- UI Selectors ---
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const viewSections = document.querySelectorAll('.view-section');
    const createAutomationBtn = document.getElementById('createAutomationBtn');
    const createWorkflowBtn = document.getElementById('createWorkflowBtn');
    const backToAutomations = document.getElementById('backToAutomations');
    const automationListView = document.getElementById('automation-list-view');
    const automationBuilderView = document.getElementById('automation-builder-view');
    const saveAutomationBtn = document.getElementById('saveAutomation');
    const previewArea = document.getElementById('previewArea');
    const previewBubble = document.getElementById('previewBubble');
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');
    const stepSettings = document.getElementById('step-settings');
    // waTemplateSelect removed — no #waTemplate select exists; using waMessage textarea directly
    const emailSubjectInput = document.getElementById('emailSubject');
    const emailBodyInput = document.getElementById('emailBody');
    const waMessageInput = document.getElementById('waMessage');

    const templates = {
        welcome_msg: "Hi {{name}}! 👋 Thanks for reaching out to us. How can we help you today?",
        followup_msg: "Hey {{name}}, just following up on our previous conversation. Do you have any questions?",
        appointment_msg: "Great news {{name}}! Your appointment has been confirmed for tomorrow at 10 AM."
    };

    const brandColors = [
        '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
        '#ec4899', '#64748b', '#2dd4bf', '#f43f5e', '#a855f7'
    ];

    let currentStages = [];
    let selectedStageColor = brandColors[0];

    // --- Pagination State ---
    let currentPage = 1;
    let leadsLimit = 20;
    let totalLeads = 0;

    // --- Backend API Sync Logic ---

    async function updateLeadStatus(leadId, newStatus) {
        console.log(`Updating lead ${leadId} to ${newStatus}`);
        const result = await fetchData(`/api/leads/${leadId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });

        if (result) {
            loadDashboardData();
            // Refresh current page
            loadLeads();
        }
    }
    window.updateLeadStatus = updateLeadStatus;

    async function loadLeads() {
        const tbody = document.getElementById('leads-table-body');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align:center; padding:60px;">
                        <div class="loader-spinner" style="display:inline-block; width:28px; height:28px; border:3px solid #e2e8f0; border-radius:50%; border-top-color:#3b4250; animation:spin 1s linear infinite; margin-bottom:12px;"></div>
                        <p style="font-size:13px; color:#7a8292; font-weight:400; margin:0;">Loading leads...</p>
                    </td>
                </tr>
            `;
        }

        const countData = await fetchData('/api/leads/count');
        if (countData && !countData.error) {
            totalLeads = countData.total;
        }

        const leads = await fetchData(`/api/leads?page=${currentPage}&limit=${leadsLimit}`);
        if (leads && !leads.error) {
            renderLeads(leads);
        }
    }

    window.changePage = async (delta) => {
        currentPage += delta;
        const totalPages = Math.ceil(totalLeads / leadsLimit);
        if (currentPage < 1) currentPage = 1;
        if (currentPage > totalPages) currentPage = totalPages;

        await loadLeads();
    };

    async function loadStages() {
        const stages = await fetchData('/api/stages');
        if (stages) {
            currentStages = stages;
            renderFlows();
            return stages;
        }
        return [];
    }

    async function loadInitialData() {
        await loadStages(); // Load stages first as other views depend on them

        await loadLeads();

        const automations = await fetchData('/api/automations');
        if (automations) renderAutomations(automations);

        loadDashboardData();
        loadFieldMappings();
        setupIntegrationTabs();
        initMappingSortables();
        refreshMappingSchema();
        loadWorkflows();
    }

    function setupIntegrationTabs() {
        const tabs = document.querySelectorAll('.sub-nav-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');

                // Toggle active class on tabs
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Toggle visibility of content
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.remove('active');
                });
                document.getElementById(`tab-${target}`).classList.add('active');

                if (target === 'facebook-forms') {
                    loadFacebookFormsTab();
                }

                if (window.feather) window.feather.replace();
            });
        });
    }

    let latestLeadPreview = null;
    let mappingGroups = {};

    function initMappingSortables() {
        const pillBank = document.getElementById('pillBank');
        const slots = ['slot-name', 'slot-email', 'slot-phone'];

        if (!pillBank) return;

        // The Pill Bank (Source)
        mappingGroups.bank = new Sortable(pillBank, {
            group: 'mapping',
            animation: 150,
            ghostClass: 'sortable-ghost'
        });

        // The Target Slots
        slots.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                new Sortable(el, {
                    group: 'mapping',
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    onAdd: (evt) => {
                        // If slot already has a pill, move the old one back to the bank
                        if (el.children.length > 2) {
                            const oldPill = Array.from(el.children).find(c => c !== evt.item && c.classList.contains('mapping-pill'));
                            if (oldPill) pillBank.appendChild(oldPill);
                        }
                        updateMappingPreview();
                    },
                    onRemove: () => {
                        updateMappingPreview();
                    }
                });
            }
        });
    }

    window.refreshMappingSchema = async () => {
        const schema = await fetchData('/api/leads/schema');
        
        // Use a quiet try/catch or custom fetch handling for /api/leads/latest to suppress 404 console alerts on empty DB
        let latest = null;
        try {
            const res = await fetch('/api/leads/latest');
            if (res.ok) {
                latest = await res.json();
            }
        } catch (e) {
            // Suppress error quietly
        }

        if (schema && schema.keys) {
            const bank = document.getElementById('pillBank');
            bank.innerHTML = '';

            const mappedKeys = Array.from(document.querySelectorAll('.mapping-targets .mapping-pill')).map(p => p.getAttribute('data-key'));

            schema.keys.filter(k => !mappedKeys.includes(k)).forEach(key => {
                const pill = document.createElement('div');
                pill.className = 'mapping-pill';
                // Replace underscores with spaces for readability
                pill.textContent = key.replace(/_/g, ' ');
                pill.setAttribute('data-key', key);
                bank.appendChild(pill);
            });
        }

        if (latest) {
            latestLeadPreview = latest;
            updateMappingPreview();
        }
    };

    function updateMappingPreview() {
        if (!latestLeadPreview) return;

        const mapping = {
            name: document.querySelector('#slot-name .mapping-pill')?.getAttribute('data-key'),
            email: document.querySelector('#slot-email .mapping-pill')?.getAttribute('data-key'),
            phone: document.querySelector('#slot-phone .mapping-pill')?.getAttribute('data-key')
        };

        const raw = latestLeadPreview.raw || {};

        const finalName = mapping.name ? (raw[mapping.name] || 'N/A') : 'Not Mapped';
        const finalEmail = mapping.email ? (raw[mapping.email] || 'N/A') : 'Not Mapped';
        const finalPhone = mapping.phone ? (raw[mapping.phone] || 'N/A') : 'Not Mapped';

        // Update technical labels in slot descriptions
        document.getElementById('preview-name').textContent = mapping.name || '-';
        document.getElementById('preview-email').textContent = mapping.email || '-';
        document.getElementById('preview-phone').textContent = mapping.phone || '-';

        // Update Horizontal Strip Preview
        const nameHeader = document.getElementById('preview-name-header');
        const emailHeader = document.getElementById('preview-email-header');
        const phoneHeader = document.getElementById('preview-phone-header');
        const sourceBadge = document.getElementById('preview-source-badge');
        const avatar = document.getElementById('preview-avatar');

        nameHeader.textContent = finalName;
        emailHeader.textContent = finalEmail;
        phoneHeader.textContent = finalPhone;

        if (mapping.name && raw[mapping.name]) {
            avatar.textContent = raw[mapping.name].charAt(0).toUpperCase();
            avatar.style.background = 'var(--text-primary)';
        } else {
            avatar.textContent = '?';
            avatar.style.background = '#94a3b8';
        }

        sourceBadge.textContent = latestLeadPreview.source || 'Direct Sync';

        ['name', 'email', 'phone'].forEach(field => {
            const slot = document.getElementById(`slot-${field}`);
            const placeholder = slot.querySelector('.slot-placeholder');
            const hasPill = slot.querySelector('.mapping-pill');
            if (placeholder) placeholder.style.display = hasPill ? 'none' : 'block';
        });
    }

    window.saveVisualMapping = async () => {
        const mapping = {
            name: document.querySelector('#slot-name .mapping-pill')?.getAttribute('data-key'),
            email: document.querySelector('#slot-email .mapping-pill')?.getAttribute('data-key'),
            phone: document.querySelector('#slot-phone .mapping-pill')?.getAttribute('data-key')
        };

        // 1. Save preferences
        const saveResult = await fetchData('/api/settings', {
            method: 'POST',
            body: JSON.stringify({
                mapping_name: mapping.name || 'name',
                mapping_email: mapping.email || 'email',
                mapping_phone: mapping.phone || 'phone'
            })
        });

        if (saveResult) {
            // 2. Trigger retroactive re-mapping
            const remapResult = await fetchData('/api/leads/remap', { method: 'POST' });

            if (remapResult) {
                alert(`Mapping Saved! Updated ${remapResult.count} existing leads.`);
                // 3. Refresh UI
                loadLeads(); // Refresh table
                refreshMappingSchema(); // Refresh preview strip
            }
        }
    };

    async function loadFieldMappings() {
        const settings = await fetchData('/api/settings');
        if (settings) {
            setTimeout(() => {
                const mappingKeys = {
                    name: settings.mapping_name,
                    email: settings.mapping_email,
                    phone: settings.mapping_phone
                };

                Object.keys(mappingKeys).forEach(field => {
                    const key = mappingKeys[field];
                    if (key) {
                        const pill = Array.from(document.querySelectorAll('.mapping-pill')).find(p => p.getAttribute('data-key') === key);
                        const slot = document.getElementById(`slot-${field}`);
                        if (pill && slot) slot.appendChild(pill);
                    }
                });
                updateMappingPreview();
            }, 500);
        }
    }



    window.confirmResetLeads = async () => {
        if (confirm("Are you sure you want to delete ALL leads? This cannot be undone. You should only do this if you want to start a fresh sync with new mappings.")) {
            const result = await fetchData('/api/leads', { method: 'DELETE' });
            if (result && !result.error) {
                alert("All leads have been cleared successfully.");
                currentPage = 1;
                await loadLeads();
                loadDashboardData();
            }
        }
    };

    function renderLeads(leads) {
        // --- 1. Render Table View ---
        const tbody = document.getElementById('leads-table-body');
        if (tbody) {
            if (leads.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" style="padding: 0;">
                            <div class="empty-state-card" style="border:none; background:transparent; box-shadow:none; padding:40px 20px; margin:0 auto;">
                                <div class="empty-state-icon-wrapper">
                                    <i data-feather="users"></i>
                                </div>
                                <h3 class="empty-state-title">No leads found</h3>
                                <p class="empty-state-desc">Start adding leads manually or connect automatic webhook integrations to capture incoming prospects.</p>
                                <button class="empty-state-cta-btn" onclick="openModal()">
                                    <i data-feather="plus"></i> Add New Lead
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                tbody.innerHTML = leads.map(lead => `
                    <tr>
                        <td>
                            <div class="table-user">
                                <div class="avatar">${lead.name[0]}</div>
                                <div>
                                    ${lead.name}
                                    <p>${lead.email || lead.phone || 'No contact'}</p>
                                </div>
                            </div>
                        </td>
                        <td><span class="badge badge-manual">${lead.source || 'Manual'}</span></td>
                        <td>
                            <select class="status-select" onchange="updateLeadStatus(${lead.id}, this.value)">
                                ${currentStages.map(s => `
                                    <option value="${s.name}" ${lead.status === s.name ? 'selected' : ''}>
                                        ${s.name.charAt(0).toUpperCase() + s.name.slice(1)}
                                    </option>
                                `).join('')}
                            </select>
                        </td>
                        <td>${lead.company ? `<span style="font-size:13px;">${lead.company}</span>` : '<span class="text-muted">-</span>'}</td>
                        <td>${lead.assigned_to || '<span class="text-muted">Unassigned</span>'}</td>
                        <td>${new Date(lead.created_at).toLocaleDateString()}</td>
                        <td><button class="btn btn-secondary btn-sm" onclick='openDrawer(${JSON.stringify(lead)})'>View</button></td>
                    </tr>
                `).join('');
            }
        }


        // Update Pagination Info
        const totalPages = Math.ceil(totalLeads / leadsLimit) || 1;
        const start = (currentPage - 1) * leadsLimit + 1;
        const end = Math.min(currentPage * leadsLimit, totalLeads);

        const statusEl = document.getElementById('pagination-status');
        if (statusEl) {
            statusEl.textContent = totalLeads > 0
                ? `Showing ${start}-${end} of ${totalLeads} leads`
                : `Showing 0 leads`;
        }

        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');

        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

        // --- 2. Render Kanban Board (Dynamic Columns) ---
        const boardContainer = document.getElementById('leads-board-view');
        if (boardContainer) {
            boardContainer.innerHTML = ''; // Clear board

            // Create columns based on currentStages
            currentStages.forEach(stage => {
                const column = document.createElement('div');
                column.className = 'kanban-column';
                column.innerHTML = `
                    <div class="column-header">
                        <div><span class="status-dot" style="background: ${stage.color || '#3b82f6'}"></span> ${stage.name.charAt(0).toUpperCase() + stage.name.slice(1)}</div>
                        <span class="column-count" id="count-${stage.name}">0</span>
                    </div>
                    <div class="column-body" id="board-${stage.name}"></div>
                `;
                boardContainer.appendChild(column);
            });

            // Populate columns with leads
            leads.forEach(lead => {
                const colBody = document.getElementById('board-' + lead.status);
                if (colBody) {
                    const card = document.createElement('div');
                    card.className = 'card kanban-card';
                    card.dataset.id = lead.id;
                    card.style.flexShrink = '0';
                    card.innerHTML = `
                        <h4 class="card-title">${lead.name}</h4>
                        <p class="card-subtitle">${lead.phone || 'No phone'}</p>
                        <div class="card-footer">
                            <span class="badge ${lead.source === 'Meta Ads' ? 'badge-meta' : 'badge-manual'}">${lead.source}</span>
                        </div>
                    `;
                    card.addEventListener('click', () => openDrawer(lead));
                    colBody.appendChild(card);
                }
            });

            // Re-initialize SortableJS for new columns
            initSortable();
        }

        updateColumnCounts();
        refreshIcons();
    }

    function initSortable() {
        if (typeof Sortable === 'undefined') return;
        const boardColumns = document.querySelectorAll('.column-body');
        boardColumns.forEach(col => {
            new Sortable(col, {
                group: 'shared',
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: async function (evt) {
                    const leadId = evt.item.dataset.id;
                    const newStatus = evt.to.id.replace('board-', '');
                    await updateLeadStatus(leadId, newStatus);
                }
            });
        });
    }

    function renderFlows() {
        const lockedFirst = document.getElementById('flows-locked-first');
        const lockedLast = document.getElementById('flows-locked-last');
        const list = document.getElementById('flows-list');
        if (!list) return;

        const firstStage = currentStages.find(s => s.name === 'new');
        const lastStage = currentStages.find(s => s.name === 'closed');
        const middleStages = currentStages.filter(s => s.name !== 'new' && s.name !== 'closed');

        // Render locked first
        if (lockedFirst && firstStage) {
            lockedFirst.innerHTML = renderLockedStageCard(firstStage, 'Start');
        }

        // Render locked last
        if (lockedLast && lastStage) {
            lockedLast.innerHTML = renderLockedStageCard(lastStage, 'End');
        }

        // Render draggable middle stages
        list.innerHTML = middleStages.map(s => `
            <div class="flow-card" data-id="${s.id}" style="border-left: 4px solid ${s.color}">
                <div class="flow-card-drag"><i data-feather="menu"></i></div>
                <div class="flow-card-info">
                    <div class="automation-title">${capitalize(s.name)}</div>
                    <div class="automation-desc">Drag to reorder</div>
                </div>
                <div class="flow-card-color" style="background: ${s.color}; width: 14px; height: 14px; border-radius: 50%;"></div>
                <button class="btn btn-secondary btn-sm" onclick="deleteStage(${s.id})">
                    <i data-feather="trash-2" style="width:14px;height:14px"></i>
                </button>
            </div>
        `).join('');

        // Init SortableJS for reordering
        if (typeof Sortable !== 'undefined') {
            new Sortable(list, {
                animation: 200,
                ghostClass: 'sortable-ghost',
                handle: '.flow-card-drag',
                onEnd: async function () {
                    const cards = list.querySelectorAll('.flow-card');
                    // 'new' is always 0, so middle stages start at 1
                    const order = Array.from(cards).map((card, i) => ({
                        id: parseInt(card.dataset.id),
                        order_index: i + 1 // +1 because 'new' is at 0
                    }));
                    await fetchData('/api/stages/reorder', {
                        method: 'PUT',
                        body: JSON.stringify({ order })
                    });
                    await loadStages();
                    const leads = await fetchData('/api/leads');
                    if (leads) renderLeads(leads);
                }
            });
        }

        refreshIcons();
    }

    function renderLockedStageCard(stage, label) {
        return `
            <div class="flow-card flow-card-locked" style="border-left: 4px solid ${stage.color}">
                <div class="flow-card-drag" style="opacity: 0.2; cursor: default"><i data-feather="lock"></i></div>
                <div class="flow-card-info">
                    <div class="automation-title">${capitalize(stage.name)}</div>
                    <div class="automation-desc">${label} — System stage, always ${label === 'Start' ? 'first' : 'last'}</div>
                </div>
                <div class="flow-card-color" style="background: ${stage.color}; width: 14px; height: 14px; border-radius: 50%;"></div>
            </div>
        `;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // --- Add Stage Modal ---
    window.openAddStageModal = () => {
        const overlay = document.getElementById('overlay');
        const modal = document.getElementById('addStageModal');
        const presetsContainer = document.getElementById('colorPresets');

        overlay.classList.add('active');
        modal.classList.add('active');

        document.getElementById('stageName').value = '';
        selectedStageColor = brandColors[0];

        // Populate Presets
        if (presetsContainer) {
            presetsContainer.innerHTML = brandColors.map(color => `
                <div class="color-preset ${color === selectedStageColor ? 'active' : ''}" 
                     style="background: ${color}" 
                     onclick="selectStageColor('${color}', this)">
                </div>
            `).join('');
        }

        updateColorDisplay(selectedStageColor);
        refreshIcons();
    };

    window.selectStageColor = (color, element) => {
        selectedStageColor = color;
        // Update active class
        document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
        if (element) element.classList.add('active');

        updateColorDisplay(color);
    };

    function updateColorDisplay(color) {
        const colorInput = document.getElementById('stageColor');
        const colorHex = document.getElementById('stageColorHex');
        if (colorInput) colorInput.value = color;
        if (colorHex) colorHex.textContent = color;
    }

    window.closeAddStageModal = () => {
        document.getElementById('overlay').classList.remove('active');
        document.getElementById('addStageModal').classList.remove('active');
    };

    // Live hex preview for custom picker
    const stageColorInput = document.getElementById('stageColor');
    if (stageColorInput) {
        stageColorInput.addEventListener('input', () => {
            selectedStageColor = stageColorInput.value;
            document.getElementById('stageColorHex').textContent = selectedStageColor;
            // Remove active from presets since we are using custom
            document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
        });
    }

    window.submitNewStage = async (e) => {
        e.preventDefault();
        const name = document.getElementById('stageName').value.trim();
        const color = selectedStageColor;
        if (!name) return;

        await fetchData('/api/stages', {
            method: 'POST',
            body: JSON.stringify({ name, color })
        });
        closeAddStageModal();
        await loadStages();
        const leads = await fetchData('/api/leads');
        if (leads) renderLeads(leads);
    };

    window.deleteStage = async (id) => {
        if (!confirm("Are you sure? Leads in this stage will be moved to the first stage.")) return;

        const result = await fetchData(`/api/stages/${id}`, { method: 'DELETE' });
        if (result && result.error) {
            alert(result.error);
            return;
        }
        await loadStages();
        const leads = await fetchData('/api/leads');
        if (leads) renderLeads(leads);
    };

    window.openCreateAutomation = () => {
        const btn = document.getElementById('createAutomationBtn');
        if (btn) btn.click();
    };

    function renderAutomations(automations) {
        const grid = document.getElementById('automation-list-view');
        if (!grid) return;

        grid.innerHTML = '';

        if (!automations || automations.length === 0) {
            grid.innerHTML = `
                <div class="empty-state-card" style="grid-column: 1 / -1; margin: 40px auto;">
                    <div class="empty-state-icon-wrapper">
                        <i data-feather="zap"></i>
                    </div>
                    <h3 class="empty-state-title">No automations yet</h3>
                    <p class="empty-state-desc">Create automatic triggers like sending WhatsApp messages or Email drips when leads change stages.</p>
                    <button class="empty-state-cta-btn" onclick="openCreateAutomation()">
                        <i data-feather="plus"></i> Create Automation
                    </button>
                </div>
            `;
        } else {
            automations.forEach(auto => {
                const card = document.createElement('div');
                card.className = 'card automation-card';
                card.innerHTML = `
                    <div class="automation-card-header">
                        <div class="automation-icon"><i data-feather="${auto.action === 'send_whatsapp' ? 'message-circle' : 'mail'}"></i></div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <button class="btn-icon delete-auto-btn" title="Delete Automation" style="background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px;">
                                <i data-feather="trash-2" style="width: 16px;"></i>
                            </button>
                            <label class="toggle">
                                <input type="checkbox" class="auto-toggle" ${auto.active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <div class="automation-title">${auto.name}</div>
                        <div class="automation-desc">Trigger: ${auto.trigger.replace('_', ' ')} | Action: ${auto.action.replace('_', ' ')}</div>
                    </div>
                `;

                // Event Listeners
                const toggle = card.querySelector('.auto-toggle');
                toggle.addEventListener('change', async (e) => {
                    await fetchData(`/api/automations/${auto.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ active: e.target.checked })
                    });
                });

                const deleteBtn = card.querySelector('.delete-auto-btn');
                deleteBtn.addEventListener('click', async () => {
                    if (confirm(`Are you sure you want to delete "${auto.name}"?`)) {
                        await fetchData(`/api/automations/${auto.id}`, { method: 'DELETE' });
                        // Refresh both list and feed
                        const updated = await fetchData('/api/automations');
                        renderAutomations(updated);
                    }
                });

                grid.appendChild(card);
            });
        }
        refreshIcons();
    }

    function updateColumnCounts() {
        document.querySelectorAll('.kanban-column').forEach(col => {
            const count = col.querySelectorAll('.kanban-card').length;
            const countEl = col.querySelector('.column-count');
            if (countEl) countEl.textContent = count;
        });
    }

    // --- Form Submissions ---

    const leadForm = document.getElementById('addLeadModal').querySelector('form');
    if (leadForm) {
        leadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                name: document.getElementById('leadName').value,
                email: document.getElementById('leadEmail').value,
                phone: document.getElementById('leadPhone').value,
                source: 'Manual'
            };

            const result = await fetchData('/api/leads', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            if (result) {
                closeModal();
                loadInitialData();
            }
        });
    }

    if (saveAutomationBtn) {
        saveAutomationBtn.addEventListener('click', async () => {
            const name = document.getElementById('automationName').value || 'New Automation';
            const triggerCard = document.querySelector('#step1 .selection-card.selected');
            const actionCard = document.querySelector('#step2 .selection-card.selected');

            if (!triggerCard || !actionCard) {
                alert('Please select a trigger and an action');
                return;
            }

            const trigger = triggerCard.getAttribute('data-trigger');
            const action = actionCard.getAttribute('data-action');
            let settings = {};

            if (action === 'send_whatsapp') {
                settings.body = document.getElementById('waMessage').value;
            } else {
                settings.subject = document.getElementById('emailSubject').value;
                settings.body = document.getElementById('emailBody').value;
            }

            const result = await fetchData('/api/automations', {
                method: 'POST',
                body: JSON.stringify({ name, trigger, action, settings })
            });

            if (result) {
                alert(`Success! "${name}" has been created and activated.`);
                automationBuilderView.style.display = 'none';
                const listsView = document.getElementById('automations-lists-view');
                if (listsView) listsView.style.display = 'grid';
                const automationsHeader = document.getElementById('automationsMainHeader');
                if (automationsHeader) automationsHeader.style.display = 'flex';
                // Immediately refresh the automation list without a full reload
                const updatedAutomations = await fetchData('/api/automations');
                if (updatedAutomations) renderAutomations(updatedAutomations);
            }
        });
    }

    // =========================================================================
    // WORKFLOWS CONTROLLER & BUILDER
    // =========================================================================

    let currentWfSteps = [];
    let currentEditingStepIndex = null;

    // Dropdown Trigger Logic
    const createDropdownBtn = document.getElementById('createDropdownBtn');
    const createDropdownMenu = document.getElementById('createDropdownMenu');
    
    if (createDropdownBtn && createDropdownMenu) {
        createDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const visible = createDropdownMenu.style.display === 'block';
            createDropdownMenu.style.display = visible ? 'none' : 'block';
        });
        
        document.addEventListener('click', () => {
            createDropdownMenu.style.display = 'none';
        });
    }

    if (createWorkflowBtn) {
        createWorkflowBtn.addEventListener('click', () => {
            openCreateWorkflow();
        });
    }

    // Load & Render Workflows list
    async function loadWorkflows() {
        const listContainer = document.getElementById('wf-list-container');
        if (!listContainer) return;
        listContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">Loading workflows...</div>';

        const workflows = await fetchData('/api/workflows');
        if (!workflows || workflows.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state-card" style="margin: 40px auto; max-width: 480px;">
                    <div class="empty-state-icon-wrapper">
                        <i data-feather="git-branch"></i>
                    </div>
                    <h3 class="empty-state-title">No workflows yet</h3>
                    <p class="empty-state-desc">Create powerful multi-step campaigns to sort, distribute, and follow up with leads automatically.</p>
                    <button class="empty-state-cta-btn" onclick="openCreateWorkflow()">
                        <i data-feather="plus"></i> Create Workflow
                    </button>
                </div>
            `;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        listContainer.innerHTML = '';
        workflows.forEach(wf => {
            const card = document.createElement('div');
            card.className = 'workflow-card';
            
            const steps = wf.steps || [];
            const stepPills = steps.map((s, idx) => {
                let icon = 'help-circle';
                if (s.type === 'assign_staff') icon = 'user-check';
                else if (s.type === 'send_email') icon = 'mail';
                else if (s.type === 'send_whatsapp') icon = 'message-circle';
                else if (s.type === 'notify_team') icon = 'bell';
                return `<span class="workflow-step-pill"><i data-feather="${icon}"></i> ${idx + 1}</span>`;
            }).join(' <i data-feather="chevrons-right" style="width:12px;color:var(--text-muted);"></i> ');

            card.innerHTML = `
                <div class="workflow-card-icon">
                    <i data-feather="git-branch"></i>
                </div>
                <div class="workflow-card-body">
                    <div class="workflow-card-name">${wf.name}</div>
                    <div class="workflow-card-meta">
                        <span>Trigger: Source = <strong>${wf.trigger === 'any' ? 'Any Source' : wf.trigger}</strong></span>
                        <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
                            ${stepPills || '<span style="font-size:12px;color:var(--text-muted);">No steps defined</span>'}
                        </div>
                    </div>
                </div>
                <div class="workflow-card-actions">
                    <button class="btn-icon delete-wf-btn" title="Delete Workflow" style="background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 6px;">
                        <i data-feather="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                    <label class="toggle">
                        <input type="checkbox" class="wf-toggle" ${wf.active ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;

            const toggle = card.querySelector('.wf-toggle');
            toggle.addEventListener('change', async (e) => {
                await fetchData(`/api/workflows/${wf.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ active: e.target.checked })
                });
            });

            const deleteBtn = card.querySelector('.delete-wf-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete workflow "${wf.name}"?`)) {
                    await fetchData(`/api/workflows/${wf.id}`, { method: 'DELETE' });
                    loadWorkflows();
                }
            });

            // Open workflow edit on clicking body
            const cardBody = card.querySelector('.workflow-card-body');
            if (cardBody) {
                cardBody.style.cursor = 'pointer';
                cardBody.addEventListener('click', () => {
                    openEditWorkflow(wf);
                });
            }

            listContainer.appendChild(card);
        });

        if (typeof feather !== 'undefined') feather.replace();
    }

    // Populate trigger select custom dropdown
    async function populateWfTriggerSources() {
        const triggerSelect = document.getElementById('wfTriggerSource');
        const customWrapper = document.getElementById('wfTriggerSourceWrapper');
        if (!triggerSelect || !customWrapper) return;

        const leads = await fetchData('/api/leads');
        const sources = new Set(['Manual', 'Meta', 'Web Form', 'Facebook Forms']);
        if (leads && Array.isArray(leads)) {
            leads.forEach(l => { if (l.source) sources.add(l.source); });
        }

        const sourceIcons = {
            Meta: 'facebook', 'Web Form': 'globe', 'Facebook Forms': 'facebook',
            Manual: 'edit', any: 'globe'
        };

        // Rebuild select options
        triggerSelect.innerHTML = '<option value="any">Any Source</option>';
        sources.forEach(src => {
            const opt = document.createElement('option');
            opt.value = src;
            opt.textContent = src;
            triggerSelect.appendChild(opt);
        });

        // Rebuild custom options
        const optionsContainer = customWrapper.querySelector('.custom-options-container');
        if (optionsContainer) {
            optionsContainer.innerHTML = '';
            
            const currentVal = triggerSelect.value || 'any';

            // Add "Any Source" option
            const optAny = document.createElement('div');
            optAny.className = `custom-option ${currentVal === 'any' ? 'selected' : ''}`;
            optAny.setAttribute('data-value', 'any');
            optAny.innerHTML = `<i data-feather="globe"></i> <span>Any Source</span>`;
            optionsContainer.appendChild(optAny);

            // Add other options
            sources.forEach(src => {
                const iconName = sourceIcons[src] || 'zap';
                const opt = document.createElement('div');
                opt.className = `custom-option ${currentVal === src ? 'selected' : ''}`;
                opt.setAttribute('data-value', src);
                opt.innerHTML = `<i data-feather="${iconName}"></i> <span>${src}</span>`;
                optionsContainer.appendChild(opt);
            });
        }

        // Toggle custom options popover
        const selectTrigger = customWrapper.querySelector('.custom-select-trigger');
        if (selectTrigger) {
            selectTrigger.onclick = (e) => {
                e.stopPropagation();
                const container = customWrapper.querySelector('.custom-options-container');
                if (container) {
                    const isVisible = container.style.display === 'block';
                    container.style.display = isVisible ? 'none' : 'block';
                    customWrapper.classList.toggle('active', !isVisible);
                }
            };
        }

        // Handle custom option selection
        customWrapper.querySelectorAll('.custom-option').forEach(opt => {
            opt.onclick = (e) => {
                e.stopPropagation();
                const val = opt.getAttribute('data-value');
                triggerSelect.value = val;

                // Update select trigger styling & text
                const triggerText = selectTrigger.querySelector('.custom-select-trigger-text');
                const triggerIcon = selectTrigger.querySelector('.custom-select-trigger-icon');
                const valLabel = opt.querySelector('span').textContent;
                const valIcon = opt.querySelector('svg').outerHTML;
                
                if (triggerText) triggerText.textContent = valLabel;
                if (triggerIcon) triggerIcon.innerHTML = valIcon;

                // Update select highlight
                customWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');

                // Close options
                const container = customWrapper.querySelector('.custom-options-container');
                if (container) container.style.display = 'none';
                customWrapper.classList.remove('active');

                // Update natural language workflow preview token
                const token = document.getElementById('wfSourceToken');
                if (token) {
                    token.textContent = val === 'any' ? 'Any Source' : val;
                }
            };
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            const container = customWrapper.querySelector('.custom-options-container');
            if (container) container.style.display = 'none';
            customWrapper.classList.remove('active');
        });

        if (typeof feather !== 'undefined') feather.replace();
    }

    let currentEditingWfId = null;

    // Bind real-time token text to name input changes
    const wfNameInput = document.getElementById('wfName');
    if (wfNameInput) {
        wfNameInput.addEventListener('input', () => {
            const val = wfNameInput.value.trim();
            const token = document.getElementById('wfNameToken');
            if (token) token.textContent = val || 'Untitled Workflow';
            const headerName = document.getElementById('wfHeaderName');
            if (headerName) headerName.textContent = val || 'Untitled Workflow';
        });
    }

    // Toggle doc sections Name and Trigger inline panels
    window.toggleWfDocSection = (section) => {
        // Collapse all inline config panels first
        document.querySelectorAll('.wf-step-config-inline').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.wf-step-row').forEach(r => r.classList.remove('expanded'));

        const nameCard = document.getElementById('wfNameCard');
        const triggerCard = document.getElementById('wfTriggerCard');
        const namePanel = document.getElementById('wfNameConfigPanel');
        const triggerPanel = document.getElementById('wfTriggerConfigPanel');

        if (section === 'name' && namePanel && nameCard) {
            namePanel.style.display = 'block';
            nameCard.classList.add('expanded');
        } else if (section === 'trigger' && triggerPanel && triggerCard) {
            triggerPanel.style.display = 'block';
            triggerCard.classList.add('expanded');
        }
    };

    // Reset workflow builder to initial state
    function resetWfBuilder() {
        currentWfSteps = [];
        currentEditingWfId = null;
        
        // Reset name input & token
        const nameInput = document.getElementById('wfName');
        if (nameInput) nameInput.value = '';
        const nameToken = document.getElementById('wfNameToken');
        if (nameToken) nameToken.textContent = 'Untitled Workflow';
        const headerName = document.getElementById('wfHeaderName');
        if (headerName) headerName.textContent = 'Untitled Workflow';

        // Reset trigger source select & token
        const srcSelect = document.getElementById('wfTriggerSource');
        if (srcSelect) srcSelect.value = 'any';
        const srcToken = document.getElementById('wfSourceToken');
        if (srcToken) srcToken.textContent = 'Any Source';

        // Collapse trigger and name panels
        toggleWfDocSection('name');

        renderWfStepsList();
    }

    // Unsaved changes confirmation dialog
    function confirmWfSwitch() {
        const nameInput = document.getElementById('wfName');
        const nameVal = nameInput ? nameInput.value.trim() : '';
        const hasUnsaved = nameVal !== '' || currentWfSteps.length > 0;
        if (hasUnsaved) {
            return confirm("You have unsaved changes. Switch workflow and discard current edits?");
        }
        return true;
    }

    // Populate active workflows list in switcher
    async function loadWorkflowSwitcherList() {
        const switcherList = document.getElementById('wfSwitcherList');
        if (!switcherList) return;

        const list = await fetchData('/api/workflows') || [];
        switcherList.innerHTML = '';

        const activeList = list.filter(w => w.id !== currentEditingWfId);
        if (activeList.length === 0) {
            switcherList.innerHTML = `<div class="text-muted" style="padding: 8px 12px; font-size:12px; text-align: center;">No other workflows found</div>`;
            return;
        }

        activeList.forEach(wf => {
            const opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'custom-option';
            opt.style.width = '100%';
            opt.style.border = 'none';
            opt.style.background = 'transparent';
            opt.style.textAlign = 'left';
            opt.style.cursor = 'pointer';
            opt.innerHTML = `<i data-feather="git-branch" style="width: 14px; height: 14px;"></i> <span>${escapeHtml(wf.name)}</span>`;
            opt.onclick = async (e) => {
                e.stopPropagation();
                if (confirmWfSwitch()) {
                    await openEditWorkflow(wf);
                    document.getElementById('wfSwitcherDropdown').style.display = 'none';
                    document.getElementById('wfSwitcherWrapper').classList.remove('active');
                }
            };
            switcherList.appendChild(opt);
        });

        if (typeof feather !== 'undefined') feather.replace();
    }

    // Open workflow in editing mode
    window.openEditWorkflow = async (wf) => {
        window.wfTeamMembers = await fetchData('/api/team') || [];
        
        const listsView = document.getElementById('automations-lists-view');
        if (listsView) listsView.style.display = 'none';
        document.getElementById('wf-builder-view').style.display = 'block';
        document.getElementById('automationsMainHeader').style.display = 'none';

        currentEditingWfId = wf.id;

        const nameInput = document.getElementById('wfName');
        if (nameInput) nameInput.value = wf.name || '';
        const nameToken = document.getElementById('wfNameToken');
        if (nameToken) nameToken.textContent = wf.name || 'Untitled Workflow';
        const headerName = document.getElementById('wfHeaderName');
        if (headerName) headerName.textContent = wf.name || 'Untitled Workflow';

        const srcSelect = document.getElementById('wfTriggerSource');
        if (srcSelect) srcSelect.value = wf.trigger || 'any';
        const srcToken = document.getElementById('wfSourceToken');
        if (srcToken) srcToken.textContent = wf.trigger === 'any' ? 'Any Source' : wf.trigger;

        currentWfSteps = wf.steps || [];
        await populateWfTriggerSources();
        renderWfStepsList();

        // Collapse all inline cards
        document.querySelectorAll('.wf-step-config-inline').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.wf-step-row').forEach(r => r.classList.remove('expanded'));

        await loadWorkflowSwitcherList();
        if (typeof feather !== 'undefined') feather.replace();
    };

    // Toggle switcher popover
    const switcherWrapper = document.getElementById('wfSwitcherWrapper');
    const switcherTrigger = document.querySelector('.wf-header-switcher-trigger');
    const switcherDropdown = document.getElementById('wfSwitcherDropdown');
    const switcherNewBtn = document.getElementById('wfSwitcherNewBtn');

    if (switcherTrigger && switcherDropdown && switcherWrapper) {
        switcherTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const visible = switcherDropdown.style.display === 'block';
            switcherDropdown.style.display = visible ? 'none' : 'block';
            switcherWrapper.classList.toggle('active', !visible);
        });

        document.addEventListener('click', () => {
            if (switcherDropdown) switcherDropdown.style.display = 'none';
            if (switcherWrapper) switcherWrapper.classList.remove('active');
        });

        if (switcherNewBtn) {
            switcherNewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirmWfSwitch()) {
                    openCreateWorkflow();
                    switcherDropdown.style.display = 'none';
                    switcherWrapper.classList.remove('active');
                }
            });
        }
    }

    // Open Workflow Builder for a new workflow
    window.openCreateWorkflow = async () => {
        window.wfTeamMembers = await fetchData('/api/team') || [];
        const listsView = document.getElementById('automations-lists-view');
        if (listsView) listsView.style.display = 'none';
        document.getElementById('wf-builder-view').style.display = 'block';
        document.getElementById('automationsMainHeader').style.display = 'none';
        resetWfBuilder();
        populateWfTriggerSources();
        await loadWorkflowSwitcherList();
        if (typeof feather !== 'undefined') feather.replace();
    };

    // Close Workflow Builder / Go back
    const wfBackToList = document.getElementById('wfBackToList');
    if (wfBackToList) {
        wfBackToList.addEventListener('click', () => {
            if (confirmWfSwitch()) {
                document.getElementById('wf-builder-view').style.display = 'none';
                const listsView = document.getElementById('automations-lists-view');
                if (listsView) listsView.style.display = 'grid';
                document.getElementById('automationsMainHeader').style.display = 'flex';
                loadWorkflows();
            }
        });
    }

    // Wire up Add Step Popover trigger and selection options
    const addStepWrapper = document.getElementById('addStepWrapper');
    const addStepTriggerBtn = document.getElementById('addStepTriggerBtn');
    const addStepPopover = document.getElementById('addStepPopover');
    if (addStepTriggerBtn && addStepPopover && addStepWrapper) {
        addStepTriggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const visible = addStepPopover.style.display === 'block';
            addStepPopover.style.display = visible ? 'none' : 'block';
            addStepWrapper.classList.toggle('active', !visible);
        });

        document.addEventListener('click', () => {
            addStepPopover.style.display = 'none';
            addStepWrapper.classList.remove('active');
        });

        addStepPopover.querySelectorAll('.custom-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.getAttribute('data-step-type');
                const config = {};
                
                // Set default configurations based on step type
                if (type === 'assign_staff') {
                    config.mode = 'even';
                    config.staff = [];
                } else if (type === 'send_email') {
                    config.subject = '';
                    config.body = '';
                } else if (type === 'send_whatsapp') {
                    config.body = '';
                } else if (type === 'notify_team') {
                    config.title = '';
                    config.body = '';
                }

                currentWfSteps.push({ type, config });
                renderWfStepsList();

                // Open the new step immediately
                setTimeout(() => {
                    toggleWfStepConfig(currentWfSteps.length - 1);
                }, 80);
            });
        });
    }

    function getWfStepSentenceHtml(step, idx) {
        if (step.type === 'assign_staff') {
            return `Then assign lead to: <span class="token-link">Team Selection</span>`;
        } else if (step.type === 'send_email') {
            const subject = step.config.subject || '';
            const subjectText = subject ? `"${subject}"` : 'empty subject';
            return `Then send email: <span class="token-link">${escapeHtml(subjectText)}</span>`;
        } else if (step.type === 'send_whatsapp') {
            const body = step.config.body || '';
            const bodyText = body ? `"${body.substring(0, 30)}${body.length > 30 ? '...' : ''}"` : 'empty message';
            return `Then send WhatsApp: <span class="token-link">${escapeHtml(bodyText)}</span>`;
        } else if (step.type === 'notify_team') {
            const title = step.config.title || '';
            const titleText = title ? `"${title}"` : 'empty title';
            return `Then notify team: <span class="token-link">${escapeHtml(titleText)}</span>`;
        }
        return '';
    }

    // Build the inline configuration panel markup for the step accordion
    function getWfStepConfigPanelHtml(step, idx) {
        if (step.type === 'assign_staff') {
            const team = window.wfTeamMembers || [];
            const currentStaff = step.config.staff || [];
            const isWeighted = step.config.mode === 'weighted';

            const checkboxesHtml = team.map(m => {
                const matched = currentStaff.find(s => s.name === m.name);
                const checked = matched ? 'checked' : '';
                const weightVal = matched ? (matched.weight || 1) : 1;
                const initials = m.name ? m.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '??';
                const roleCapitalized = m.role ? m.role.charAt(0).toUpperCase() + m.role.slice(1) : 'Employee';
                
                return `
                    <div class="staff-weight-row ${checked ? 'selected' : ''}">
                        <label class="staff-check-label-wrapper">
                            <input type="checkbox" class="wf-staff-cb" data-staff-name="${m.name}" ${checked} onchange="toggleWfWeightViewInline(${idx})">
                            <div class="staff-avatar">${initials}</div>
                            <div class="staff-meta">
                                <span class="staff-check-label">${m.name}</span>
                                <span class="staff-subtext">${roleCapitalized} &bull; ${m.email}</span>
                            </div>
                        </label>
                        <div class="staff-weight-container" style="${isWeighted && checked ? 'display:flex;' : 'display:none;'}">
                            <span class="weight-percentage"></span>
                            <div class="select-wrapper">
                                <span class="weight-label">Weight:</span>
                                <select class="staff-weight-select wf-staff-weight" data-staff-name="${m.name}" onchange="saveInlineWfStepConfig(${idx})">
                                    <option value="${weightVal}" selected>${weightVal}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="inline-config-group">
                    <label>Distribution Mode</label>
                    <div class="dist-toggle-row">
                        <button type="button" class="dist-btn mode-toggle-btn ${!isWeighted ? 'active' : ''}" data-mode="even" onclick="setWfDistModeInline(${idx}, 'even')">Even (Round-Robin)</button>
                        <button type="button" class="dist-btn mode-toggle-btn ${isWeighted ? 'active' : ''}" data-mode="weighted" onclick="setWfDistModeInline(${idx}, 'weighted')">Weighted</button>
                    </div>
                </div>
                <div class="inline-config-group">
                    <label>Select Team Members</label>
                    <div class="staff-select-list">
                        ${checkboxesHtml || '<div style="padding:12px; text-align:center; color:var(--text-muted);">Please add team members in settings first.</div>'}
                    </div>
                </div>
            `;
        } else if (step.type === 'send_email') {
            const subjectVal = step.config.subject || '';
            const bodyVal = step.config.body || '';
            return `
                <div class="inline-config-group">
                    <label>Subject</label>
                    <input type="text" class="form-input wf-email-subject" value="${escapeHtml(subjectVal)}" placeholder="e.g. Welcome {{name}}!" oninput="saveInlineWfStepConfig(${idx})">
                </div>
                <div class="inline-config-group">
                    <label>Body Content</label>
                    <textarea class="form-input wf-email-body" rows="4" placeholder="Write your email body..." oninput="saveInlineWfStepConfig(${idx})">${escapeHtml(bodyVal)}</textarea>
                    <div class="variable-legend">
                        <span>Placeholders:</span>
                        <code onclick="insertWfTagInline(${idx}, 'wf-email-body', '{{name}}')">{{name}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-email-body', '{{email}}')">{{email}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-email-body', '{{source}}')">{{source}}</code>
                    </div>
                </div>
            `;
        } else if (step.type === 'send_whatsapp') {
            const bodyVal = step.config.body || '';
            return `
                <div class="inline-config-group">
                    <label>Message Text</label>
                    <textarea class="form-input wf-wa-body" rows="4" placeholder="Hi {{name}}, thanks for your interest..." oninput="saveInlineWfStepConfig(${idx})">${escapeHtml(bodyVal)}</textarea>
                    <div class="variable-legend">
                        <span>Placeholders:</span>
                        <code onclick="insertWfTagInline(${idx}, 'wf-wa-body', '{{name}}')">{{name}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-wa-body', '{{email}}')">{{email}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-wa-body', '{{source}}')">{{source}}</code>
                    </div>
                </div>
            `;
        } else if (step.type === 'notify_team') {
            const titleVal = step.config.title || '';
            const bodyVal = step.config.body || '';
            return `
                <div class="inline-config-group">
                    <label>Notification Title</label>
                    <input type="text" class="form-input wf-notify-title" value="${escapeHtml(titleVal)}" placeholder="e.g. New Lead: {{name}}" oninput="saveInlineWfStepConfig(${idx})">
                </div>
                <div class="inline-config-group">
                    <label>Notification Body</label>
                    <textarea class="form-input wf-notify-body" rows="3" placeholder="Write notifications for staff..." oninput="saveInlineWfStepConfig(${idx})">${escapeHtml(bodyVal)}</textarea>
                    <div class="variable-legend">
                        <span>Placeholders:</span>
                        <code onclick="insertWfTagInline(${idx}, 'wf-notify-body', '{{name}}')">{{name}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-notify-body', '{{source}}')">{{source}}</code>
                        <code onclick="insertWfTagInline(${idx}, 'wf-notify-body', '{{assigned}}')">{{assigned}}</code>
                    </div>
                </div>
            `;
        }
        return '';
    }

    // Render Steps List inside Builder
    function renderWfStepsList() {
        const list = document.getElementById('wfStepsList');
        if (!list) return;

        list.innerHTML = '';
        currentWfSteps.forEach((step, idx) => {
            const row = document.createElement('div');
            row.className = 'wf-step-row';
            row.setAttribute('data-step-index', idx);

            row.innerHTML = `
                <div class="wf-step-header" onclick="toggleWfStepConfig(${idx})">
                    <div class="wf-step-num">${idx + 1}</div>
                    <div class="wf-step-sentence">
                        ${getWfStepSentenceHtml(step, idx)}
                    </div>
                    <div class="wf-step-actions-simple">
                        <button type="button" title="Move Up" onclick="moveStep(${idx}, -1); event.stopPropagation();">
                            <i data-feather="arrow-up"></i>
                        </button>
                        <button type="button" title="Move Down" onclick="moveStep(${idx}, 1); event.stopPropagation();">
                            <i data-feather="arrow-down"></i>
                        </button>
                        <button type="button" class="danger" title="Remove Step" onclick="removeStep(${idx}); event.stopPropagation();">
                            <i data-feather="x"></i>
                        </button>
                    </div>
                </div>
                <div class="wf-step-config-inline" style="display: none;">
                    ${getWfStepConfigPanelHtml(step, idx)}
                </div>
            `;

            list.appendChild(row);
            
            // Re-apply dropdown allocation settings if it is a staff assignment step
            if (step.type === 'assign_staff') {
                adjustWfSliderLimitsInline(idx);
                updateWfWeightPercentagesInline(idx);
            }
        });

        if (typeof feather !== 'undefined') feather.replace();
    }

    // Step Operations
    window.removeStep = (idx) => {
        currentWfSteps.splice(idx, 1);
        renderWfStepsList();
        
        if (currentWfSteps.length === 0) {
            const step3 = document.getElementById('wf-step3');
            if (step3) step3.classList.add('disabled');
        }
    };

    window.moveStep = (idx, direction) => {
        const target = idx + direction;
        if (target < 0 || target >= currentWfSteps.length) return;
        const temp = currentWfSteps[idx];
        currentWfSteps[idx] = currentWfSteps[target];
        currentWfSteps[target] = temp;
        renderWfStepsList();
        
        // Retain focus/expand for the moved step
        toggleWfStepConfig(target);
    };

    // Toggle expand/collapse inline configuration panels
    window.toggleWfStepConfig = (idx) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;
        
        const panel = row.querySelector('.wf-step-config-inline');
        if (!panel) return;
        
        const isCollapsed = panel.style.display === 'none';
        
        // Collapse all other panels to keep vertical view clean
        document.querySelectorAll('.wf-step-config-inline').forEach(p => p.style.display = 'none');
        document.querySelectorAll('.wf-step-row').forEach(r => r.classList.remove('expanded'));
        
        if (isCollapsed) {
            panel.style.display = 'block';
            row.classList.add('expanded');
        }
    };

    // Auto-Save configuration values inside inline fields
    window.saveInlineWfStepConfig = (idx) => {
        const step = currentWfSteps[idx];
        if (!step) return;

        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;

        const cfg = {};

        if (step.type === 'assign_staff') {
            const activeModeBtn = row.querySelector('.mode-toggle-btn.active');
            cfg.mode = activeModeBtn ? activeModeBtn.getAttribute('data-mode') : 'even';
            cfg.staff = [];

            row.querySelectorAll('.wf-staff-cb:checked').forEach(cb => {
                const name = cb.getAttribute('data-staff-name');
                const selectEl = row.querySelector(`.wf-staff-weight[data-staff-name="${name}"]`);
                const weightVal = selectEl ? parseInt(selectEl.value) : 1;
                cfg.staff.push({ name, weight: weightVal || 1 });
            });
        } else if (step.type === 'send_email') {
            cfg.subject = (row.querySelector('.wf-email-subject')?.value || '').trim();
            cfg.body = (row.querySelector('.wf-email-body')?.value || '').trim();
        } else if (step.type === 'send_whatsapp') {
            cfg.body = (row.querySelector('.wf-wa-body')?.value || '').trim();
        } else if (step.type === 'notify_team') {
            cfg.title = (row.querySelector('.wf-notify-title')?.value || '').trim();
            cfg.body = (row.querySelector('.wf-notify-body')?.value || '').trim();
        }

        step.config = cfg;
        
        // Instantly update sentence preview tokens
        updateWfStepSentenceText(idx);
    };

    // Update sentence preview in real-time
    window.updateWfStepSentenceText = (idx) => {
        const step = currentWfSteps[idx];
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!step || !row) return;
        
        const sentenceEl = row.querySelector('.wf-step-sentence');
        if (sentenceEl) {
            sentenceEl.innerHTML = getWfStepSentenceHtml(step, idx);
        }
    };

    // Dynamic Distribution mode toggles
    window.setWfDistModeInline = (idx, mode) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;
        
        const btns = row.querySelectorAll('.mode-toggle-btn');
        btns.forEach(btn => {
            if (btn.getAttribute('data-mode') === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        toggleWfWeightViewInline(idx);
    };

    // Toggle staff weights block based on selected mode & checkbox checks
    window.toggleWfWeightViewInline = (idx) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;

        const activeModeBtn = row.querySelector('.mode-toggle-btn.active');
        const isWeighted = activeModeBtn && activeModeBtn.getAttribute('data-mode') === 'weighted';

        row.querySelectorAll('.wf-staff-cb').forEach(cb => {
            const name = cb.getAttribute('data-staff-name');
            const weightInput = row.querySelector(`.wf-staff-weight[data-staff-name="${name}"]`);
            const staffRow = cb.closest('.staff-weight-row');
            
            if (staffRow) {
                if (cb.checked) {
                    staffRow.classList.add('selected');
                } else {
                    staffRow.classList.remove('selected');
                }
            }
            
            if (weightInput) {
                const container = weightInput.closest('.staff-weight-container');
                if (container) {
                    container.style.display = (cb.checked && isWeighted) ? 'flex' : 'none';
                }
            }
        });

        adjustWfSliderLimitsInline(idx);
        updateWfWeightPercentagesInline(idx);
        saveInlineWfStepConfig(idx);
    };

    // Dynamic select budget allocator
    window.adjustWfSliderLimitsInline = (idx, changedSelect = null) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;

        const checkedDropdowns = [];
        row.querySelectorAll('.wf-staff-cb').forEach(cb => {
            if (cb.checked) {
                const name = cb.getAttribute('data-staff-name');
                const dropdown = row.querySelector(`.wf-staff-weight[data-staff-name="${name}"]`);
                if (dropdown) checkedDropdowns.push(dropdown);
            }
        });

        if (checkedDropdowns.length === 0) return;

        if (checkedDropdowns.length === 1) {
            checkedDropdowns[0].innerHTML = '<option value="10" selected>10</option>';
            return;
        }

        checkedDropdowns.forEach(dropdown => {
            const currentVal = parseInt(dropdown.value) || 1;
            
            let sumOthers = 0;
            checkedDropdowns.forEach(other => {
                if (other !== dropdown) {
                    sumOthers += parseInt(other.value) || 1;
                }
            });
            
            const maxAllowed = 10 - sumOthers;
            const finalMax = Math.max(1, maxAllowed);
            
            dropdown.innerHTML = '';
            for (let i = 1; i <= finalMax; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i;
                if (i === currentVal) {
                    opt.selected = true;
                }
                dropdown.appendChild(opt);
            }
            
            if (currentVal > finalMax) {
                dropdown.value = finalMax;
            }
        });
    };

    // Update weight shares percentages display
    window.updateWfWeightPercentagesInline = (idx) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;

        let total = 0;
        const checkedStaff = [];
        
        row.querySelectorAll('.wf-staff-cb').forEach(cb => {
            if (cb.checked) {
                const name = cb.getAttribute('data-staff-name');
                const weightInput = row.querySelector(`.wf-staff-weight[data-staff-name="${name}"]`);
                const val = weightInput ? (parseInt(weightInput.value) || 1) : 1;
                checkedStaff.push({ cb, val, name });
                total += val;
            }
        });

        row.querySelectorAll('.staff-weight-row').forEach(sr => {
            const pctEl = sr.querySelector('.weight-percentage');
            if (pctEl) pctEl.textContent = '';
        });

        if (total > 0) {
            checkedStaff.forEach(item => {
                const sr = item.cb.closest('.staff-weight-row');
                if (sr) {
                    const pctEl = sr.querySelector('.weight-percentage');
                    if (pctEl) {
                        const pct = Math.round((item.val / total) * 100);
                        pctEl.textContent = `${pct}% share`;
                    }
                }
            });
        }
    };

    // Insert Tag tokens into email/whatsapp message texts
    window.insertWfTagInline = (idx, textareaClass, tag) => {
        const row = document.querySelector(`.wf-step-row[data-step-index="${idx}"]`);
        if (!row) return;

        const el = row.querySelector(`.${textareaClass}`);
        if (!el) return;

        const start = el.selectionStart;
        const end = el.selectionEnd;
        const text = el.value;
        
        el.value = text.substring(0, start) + tag + text.substring(end);
        el.focus();
        el.selectionStart = el.selectionEnd = start + tag.length;

        saveInlineWfStepConfig(idx);
    };

    function escapeHtml(string) {
        if (!string) return '';
        return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // Save and Publish Workflow
    const wfSaveBtn = document.getElementById('wfSaveBtn');
    if (wfSaveBtn) {
        wfSaveBtn.addEventListener('click', async () => {
            const name = document.getElementById('wfName').value.trim();
            const source = document.getElementById('wfTriggerSource').value;

            if (!name) {
                alert('Please give this workflow a name.');
                return;
            }
            if (currentWfSteps.length === 0) {
                alert('Please add at least one step to this workflow.');
                return;
            }

            // Verify all steps are fully configured
            for (let i = 0; i < currentWfSteps.length; i++) {
                const s = currentWfSteps[i];
                if (s.type === 'assign_staff') {
                    if (!s.config.staff || s.config.staff.length === 0) {
                        alert(`Step ${i + 1} (Assign Staff) must have at least one team member selected.`);
                        return;
                    }
                } else if (s.type === 'send_email') {
                    if (!s.config.subject || !s.config.body) {
                        alert(`Step ${i + 1} (Send Email) must have both subject and body configured.`);
                        return;
                    }
                } else if (s.type === 'send_whatsapp') {
                    if (!s.config.body) {
                        alert(`Step ${i + 1} (Send WhatsApp) must have message body configured.`);
                        return;
                    }
                } else if (s.type === 'notify_team') {
                    if (!s.config.title || !s.config.body) {
                        alert(`Step ${i + 1} (Notify Team) must have both title and body configured.`);
                        return;
                    }
                }
            }

            let result;
            if (currentEditingWfId) {
                result = await fetchData(`/api/workflows/${currentEditingWfId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        name,
                        trigger: source,
                        steps: currentWfSteps
                    })
                });
            } else {
                result = await fetchData('/api/workflows', {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        trigger: source,
                        steps: currentWfSteps
                    })
                });
            }

            if (result) {
                showToast(`Workflow "${name}" saved and activated successfully!`);
                
                // Reset views
                document.getElementById('wf-builder-view').style.display = 'none';
                const listsView = document.getElementById('automations-lists-view');
                if (listsView) listsView.style.display = 'grid';
                document.getElementById('automationsMainHeader').style.display = 'flex';
                
                loadWorkflows();
            }
        });
    }

    // Load everything on start
    loadInitialData();


    // --- Modal / Drawer Interactivity ---
    const overlay = document.getElementById('overlay');
    const leadDrawer = document.getElementById('leadDrawer');
    const addLeadModal = document.getElementById('addLeadModal');

    window.currentDrawerLead = null;

    window.openDrawer = async (lead) => {
        window.currentDrawerLead = lead;


        // Update header
        const initials = (lead.name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById('drawerAvatar');
        if (avatarEl) avatarEl.textContent = initials;
        document.getElementById('drawerLeadName').textContent = lead.name;
        const stageBadge = document.getElementById('drawerStageBadge');
        if (stageBadge) stageBadge.textContent = lead.status ? lead.status.charAt(0).toUpperCase() + lead.status.slice(1) : '';

        // Populate edit fields
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('drawerEditName', lead.name);
        setVal('drawerEditEmail', lead.email);
        setVal('drawerEditPhone', lead.phone);
        setVal('drawerEditCompany', lead.company);
        setVal('drawerEditSource', lead.source);
        setVal('drawerEditValue', lead.value || 0);

        // Populate stage select
        const stageSelect = document.getElementById('drawerEditStage');
        if (stageSelect) {
            stageSelect.innerHTML = currentStages.map(s =>
                `<option value="${s.name}" ${lead.status === s.name ? 'selected' : ''}>${s.name.charAt(0).toUpperCase() + s.name.slice(1)}</option>`
            ).join('');
        }

        // Populate assigned select
        const assignedSelect = document.getElementById('drawerEditAssigned');
        if (assignedSelect) {
            const team = await fetchData('/api/team');
            if (team) {
                assignedSelect.innerHTML = '<option value="">Unassigned</option>' + team.map(m =>
                    `<option value="${m.name}" ${lead.assigned_to === m.name ? 'selected' : ''}>${m.name}</option>`
                ).join('');
            }
        }

        // Custom data
        const customDataSection = document.getElementById('drawerCustomDataSection');
        const customDataFields = document.getElementById('drawerCustomDataFields');

        if (lead.custom_data) {
            try {
                const customData = JSON.parse(lead.custom_data);
                const keys = Object.keys(customData);
                if (keys.length > 0) {
                    customDataSection.style.display = 'block';
                    customDataFields.innerHTML = keys.map(k => `
                        <div style="background: var(--bg-main); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); font-size: 13px; word-break: break-word;">
                            <span style="color: var(--text-secondary); display: block; font-size: 11px; margin-bottom: 2px;">${k}</span>
                            <span style="color: var(--text-primary); font-family: monospace;">${customData[k] || '-'}</span>
                        </div>
                    `).join('');
                } else { customDataSection.style.display = 'none'; }
            } catch (e) { customDataSection.style.display = 'none'; }
        } else { customDataSection.style.display = 'none'; }

        // Load timeline
        const logs = await fetchData(`/api/leads/${lead.id}/logs`);
        renderTimeline('leadTimeline', logs);

        // Load tasks for this lead
        loadDrawerTasks(lead.id);

        // Reset to info tab
        document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.drawer-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.drawer-tab[data-tab="info"]').classList.add('active');
        document.getElementById('drawer-tab-info').classList.add('active');

        refreshIcons();
        overlay.classList.add('active');
        leadDrawer.classList.add('active');
    };

    function renderTimeline(containerId, logs) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!logs || logs.length === 0) {
            container.innerHTML = '<div class="empty-state">No activity history for this lead.</div>';
            return;
        }

        container.innerHTML = logs.map(log => `
            <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                    <div class="timeline-time">${new Date(log.timestamp).toLocaleString()}</div>
                    <div class="timeline-desc">${log.message}</div>
                </div>
            </div>
        `).join('');
    }

    window.closeDrawer = () => {
        overlay.classList.remove('active');
        leadDrawer.classList.remove('active');
    };

    window.openModal = () => {
        overlay.classList.add('active');
        addLeadModal.classList.add('active');
    };

    window.closeModal = () => {
        overlay.classList.remove('active');
        const modals = document.querySelectorAll('.modal');
        modals.forEach(m => m.classList.remove('active'));
    };

    overlay.addEventListener('click', () => {
        closeDrawer();
        closeModal();
    });

    const addLeadBtn = document.getElementById('addLeadBtn');
    if (addLeadBtn) {
        addLeadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });
    }


    // --- Chart.js Dashboard Logic ---
    let sourceChart, conversionChart;

    const dashboardRange = document.getElementById('dashboardRange');
    if (dashboardRange) {
        dashboardRange.addEventListener('change', () => {
            loadDashboardData(dashboardRange.value);
        });
    }

    async function loadDashboardData(range = '7d') {
        const stats = await fetchData(`/api/stats/dashboard?range=${range}`);
        if (!stats) return;

        updateStatCards(stats.summary);
        renderCharts(stats);

        // Overdue tasks KPI
        const overdueEl = document.getElementById('stat-overdue-tasks');
        if (overdueEl && stats.tasks) overdueEl.textContent = stats.tasks.overdue;

        // Funnel chart
        const funnelEl = document.getElementById('funnelChart');
        if (funnelEl && stats.funnel) {
            const maxCount = Math.max(...stats.funnel.map(f => f.count), 1);
            funnelEl.innerHTML = stats.funnel.map(f => `
                <div class="funnel-bar-row">
                    <div class="funnel-label">${f.stage}</div>
                    <div class="funnel-bar-track">
                        <div class="funnel-bar-fill" style="width:${(f.count / maxCount) * 100}%; background:${f.color || '#6366f1'};"></div>
                    </div>
                    <div class="funnel-count">${f.count}</div>
                </div>
            `).join('');
        }
    }

    function updateStatCards(summary) {
        const updateCard = (id, data) => {
            const valEl = document.getElementById(`stat-${id}`);
            const trendEl = document.getElementById(`trend-${id}`);
            if (valEl) valEl.textContent = data.value.toLocaleString();

            if (trendEl && data.growth !== undefined) {
                const growth = data.growth;
                const isPositive = growth >= 0;
                trendEl.textContent = `${isPositive ? '+' : ''}${growth}% vs prev period`;
                trendEl.style.color = isPositive ? '#10b981' : '#ef4444';
            }
        };

        updateCard('total-leads', summary.total);
        updateCard('active-deals', summary.active);
        updateCard('conversions', summary.conversions);
    }

    let trendChart = null;

    function renderCharts(stats) {
        // Source Distribution Chart
        const ctxSource = document.getElementById('sourceChart');
        if (ctxSource) {
            const labels = stats.sources.map(s => s.name);
            const data = stats.sources.map(s => s.value);

            if (sourceChart) {
                sourceChart.data.labels = labels;
                sourceChart.data.datasets[0].data = data;
                sourceChart.update();
            } else {
                sourceChart = new Chart(ctxSource, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b'],
                            borderWidth: 0,
                            hoverOffset: 10
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, padding: 20 } }
                        },
                        cutout: '55%'
                    }
                });
            }
        }

        // Trend Chart (Lead Volume)
        const ctxTrend = document.getElementById('trendChart');
        if (ctxTrend && stats.trend) {
            const labels = stats.trend.map(t => t.date);
            const data = stats.trend.map(t => t.count);

            if (trendChart) {
                trendChart.data.labels = labels;
                trendChart.data.datasets[0].data = data;
                trendChart.update();
            } else {
                trendChart = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            label: 'New Leads',
                            data,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99,102,241,0.08)',
                            tension: 0.4,
                            fill: true,
                            pointRadius: 4,
                            pointBackgroundColor: '#6366f1'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } },
                            x: { grid: { display: false } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }
    }

    // --- Navigation & View Switching ---
    // --- History API Routing ---
    window.navigateToView = (targetView, updateState = true) => {
        // Exclude invalid/system tabs or default to dashboard
        if (!targetView || targetView === '/' || targetView === 'index.html') {
            targetView = 'dashboard';
        }

        // Verify permission
        const currentMember = JSON.parse(localStorage.getItem('crm_member') || '{}');
        const token = localStorage.getItem('crm_token');

        // If not logged in, we must not navigate inside yet
        if (!token) return;

        const isAuthorized = currentMember.role === 'admin' ||
            targetView === 'account' ||
            (currentMember.permissions && currentMember.permissions.includes(targetView));

        if (!isAuthorized) {
            alert(`Access Denied: You do not have permissions to access the ${targetView} module.`);
            const defaultView = (currentMember.permissions && currentMember.permissions[0]) || 'account';
            navigateToView(defaultView, true);
            return;
        }

        // Clear bulk selections if navigating away from the team view
        if (targetView !== 'team' && typeof selectedBulkMemberIds !== 'undefined') {
            selectedBulkMemberIds.clear();
            if (typeof updateSelectedBulkCount === 'function') {
                updateSelectedBulkCount();
            }
        }

        // Update Navigation UI active states
        navItems.forEach(nav => {
            if (nav.getAttribute('data-view') === targetView) {
                nav.classList.add('active');
            } else {
                nav.classList.remove('active');
            }
        });

        // Hide all sections and show target
        viewSections.forEach(section => {
            if (section.id === targetView) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });

        // Force close any active modals/drawers and hide overlay
        const overlay = document.getElementById('overlay');
        const leadDrawer = document.getElementById('leadDrawer');
        const addLeadModal = document.getElementById('addLeadModal');

        if (overlay) overlay.classList.remove('active');
        if (leadDrawer) leadDrawer.classList.remove('active');
        if (addLeadModal) addLeadModal.classList.remove('active');

        // Reset Automations & Workflows view to List mode
        if (targetView === 'automations') {
            const listsView = document.getElementById('automations-lists-view');
            const builderView = document.getElementById('automation-builder-view');
            const wfBuilderView = document.getElementById('wf-builder-view');

            if (listsView) listsView.style.display = 'grid';
            if (builderView) builderView.style.display = 'none';
            if (wfBuilderView) wfBuilderView.style.display = 'none';

            const activeSection = document.getElementById(targetView);
            const header = activeSection?.querySelector('.section-header');
            if (header) header.style.display = 'flex';

            loadWorkflows();
        }

        // Load data for the active view
        if (targetView === 'dashboard') {
            loadDashboardData();
        } else if (targetView === 'flows') {
            loadStages();
        } else if (targetView === 'activity') {
            loadActivityData();
        } else if (targetView === 'contacts') {
            loadContacts();
        } else if (targetView === 'tasks') {
            loadTasks();
        } else if (targetView === 'team') {
            loadTeam();
        } else if (targetView === 'account') {
            loadMyAccountDetails();
        } else if (targetView === 'integrations') {
            loadMetaStatus();
        }

        // Update address bar
        if (updateState) {
            history.pushState({ view: targetView }, '', '/' + targetView);
        }
    };

    // Bind sidebar clicks to router
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.getAttribute('data-view');
            navigateToView(targetView, true);
        });
    });

    // Listen to browser Back / Forward events
    window.addEventListener('popstate', (e) => {
        const view = (e.state && e.state.view) || window.location.pathname.substring(1) || 'dashboard';
        navigateToView(view, false);
    });


    async function loadActivityData() {
        const logs = await fetchData('/api/logs');
        if (logs) {
            const container = document.getElementById('activity-feed-container');
            if (container) {
                if (logs.length === 0) {
                    container.innerHTML = '<div class="empty-state">No system activity recorded yet.</div>';
                } else {
                    container.innerHTML = logs.map(log => `
                        <div class="timeline-item">
                            <i data-feather="terminal" class="timeline-dot" style="width: 14px; height: 14px; background: var(--bg-card); padding: 4px; border: 1px solid var(--border-color); border-radius: 50%; left: -11px; top: 0;"></i>
                            <div class="timeline-content">
                                <div class="timeline-time">${new Date(log.timestamp).toLocaleString()} | <strong>${log.lead_name || 'System'}</strong></div>
                                <div class="timeline-desc" style="font-family: monospace; font-size: 12px; color: var(--text-secondary); background: var(--bg-main); padding: 8px; border-radius: 4px; border: 1px solid var(--border-color);">${log.message}</div>
                            </div>
                        </div>
                    `).join('');
                    refreshIcons();
                }
            }
        }
    }

    // --- Automation Builder logic ---
    if (createAutomationBtn && backToAutomations) {
        createAutomationBtn.addEventListener('click', () => {
            const listsView = document.getElementById('automations-lists-view');
            if (listsView) listsView.style.display = 'none';
            automationBuilderView.style.display = 'block';
            // Hide parent section header to avoid title overlap
            const sectionHeader = automationBuilderView.closest('.view-section').querySelector('.section-header');
            if (sectionHeader) sectionHeader.style.display = 'none';
            resetBuilder();
            // Refresh icons in case any were missed
            if (typeof feather !== 'undefined') feather.replace();
        });

        backToAutomations.addEventListener('click', () => {
            automationBuilderView.style.display = 'none';
            const listsView = document.getElementById('automations-lists-view');
            if (listsView) listsView.style.display = 'grid';
            // Show parent section header again
            const sectionHeader = automationBuilderView.closest('.view-section').querySelector('.section-header');
            if (sectionHeader) sectionHeader.style.display = 'flex';
        });
    }

    // Name step Continue button — unlocks trigger step
    const autoNameContinueBtn = document.getElementById('autoNameContinueBtn');
    const automationNameInput = document.getElementById('automationName');
    if (autoNameContinueBtn && automationNameInput) {
        autoNameContinueBtn.addEventListener('click', () => {
            const nameVal = automationNameInput.value.trim();
            const step0 = document.getElementById('step0');
            if (!nameVal) {
                automationNameInput.classList.add('input-error');
                if (step0) {
                    step0.classList.add('shake-element');
                    setTimeout(() => step0.classList.remove('shake-element'), 300);
                }
                return;
            }
            const step1 = document.getElementById('step1');
            if (step1) {
                step1.classList.remove('disabled');
                step1.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            updateProgress(2);
        });

        automationNameInput.addEventListener('input', () => {
            automationNameInput.classList.remove('input-error');
        });
    }

    // Selection Handling
    const selectionCards = document.querySelectorAll('.selection-card');
    selectionCards.forEach(card => {
        card.addEventListener('click', () => {
            const parentStep = card.closest('.builder-step');

            // Clear selections in this step
            parentStep.querySelectorAll('.selection-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            // Move to next step
            if (card.hasAttribute('data-trigger')) {
                updateProgress(2);
                step2.classList.remove('disabled');
                step2.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (card.hasAttribute('data-action')) {
                const action = card.getAttribute('data-action');
                showActionSettings(action);
            }
        });
    });

    function showActionSettings(action) {
        stepSettings.classList.remove('disabled');
        stepSettings.style.display = 'block';
        previewArea.style.display = 'block'; // Show mobile preview

        document.getElementById('settings-whatsapp').style.display = action === 'send_whatsapp' ? 'block' : 'none';
        document.getElementById('settings-email').style.display = action === 'send_email' ? 'block' : 'none';

        // Update Preview
        if (action === 'send_whatsapp') {
            updateWhatsAppPreview();
        } else {
            updateEmailPreview();
        }

        step3.classList.remove('disabled');
        updateProgress(4);
    }

    function updateWhatsAppPreview() {
        const msg = waMessageInput ? waMessageInput.value : '';
        
        const bubbleText = document.getElementById('previewBubbleText');
        const bubbleMeta = document.getElementById('previewBubbleMeta');
        if (bubbleText) {
            bubbleText.textContent = msg || "Hi {{name}}! \ud83d\udc4b Thanks for reaching out. How can we help?";
        }
        if (bubbleMeta) {
            bubbleMeta.style.display = 'flex';
        }
        
        // Toggle mockup sections
        document.getElementById('waHeader').style.display = 'flex';
        document.getElementById('waInputMock').style.display = 'flex';
        document.getElementById('emailHeader').style.display = 'none';
        document.getElementById('emailDetailsBar').style.display = 'none';

        // Layout styling
        const screen = document.getElementById('mobileScreen');
        if (screen) {
            screen.style.background = '#0b141a'; // WhatsApp dark background
            screen.style.justifyContent = 'flex-end';
            screen.classList.add('wa-wallpaper');
        }
        previewBubble.className = 'chat-bubble left';
        
        if (typeof feather !== 'undefined') feather.replace();
    }

    function updateEmailPreview() {
        const subject = emailSubjectInput ? emailSubjectInput.value : '';
        const body = emailBodyInput ? emailBodyInput.value : '';
        
        const bubbleMeta = document.getElementById('previewBubbleMeta');
        if (bubbleMeta) {
            bubbleMeta.style.display = 'none';
        }
        
        previewBubble.innerHTML = body ? body.replace(/\n/g, '<br>') : "Email body content...";
        
        // Update subject preview line
        const subjectLine = document.getElementById('previewEmailSubject');
        if (subjectLine) subjectLine.textContent = subject || "(No Subject)";

        // Toggle mockup sections
        document.getElementById('waHeader').style.display = 'none';
        document.getElementById('waInputMock').style.display = 'none';
        document.getElementById('emailHeader').style.display = 'flex';
        document.getElementById('emailDetailsBar').style.display = 'block';

        // Layout styling
        const screen = document.getElementById('mobileScreen');
        if (screen) {
            screen.style.background = '#ffffff'; // Email white layout
            screen.style.justifyContent = 'flex-start';
            screen.classList.remove('wa-wallpaper');
        }
        previewBubble.className = 'chat-bubble left email-style';

        if (typeof feather !== 'undefined') feather.replace();
    }

    // Input Listeners for Preview
    if (waMessageInput) waMessageInput.addEventListener('input', updateWhatsAppPreview);
    if (emailSubjectInput) emailSubjectInput.addEventListener('input', updateEmailPreview);
    if (emailBodyInput) emailBodyInput.addEventListener('input', updateEmailPreview);

    function updateProgress(stepNumber) {
        document.querySelectorAll('.progress-step').forEach(step => {
            const stepVal = parseInt(step.getAttribute('data-step'));
            if (stepVal <= stepNumber) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
            }
        });
    }

    function resetBuilder() {
        const step1 = document.getElementById('step1');
        if (step1) step1.classList.add('disabled');
        step2.classList.add('disabled');
        step3.classList.add('disabled');
        stepSettings.style.display = 'none';
        previewArea.style.display = 'none';
        
        // Hide mockup headers/inputs
        document.getElementById('waHeader').style.display = 'none';
        document.getElementById('waInputMock').style.display = 'none';
        document.getElementById('emailHeader').style.display = 'none';
        document.getElementById('emailDetailsBar').style.display = 'none';

        // Only clear selection cards — do not touch step0 (name step, always active)
        selectionCards.forEach(c => c.classList.remove('selected'));
        document.getElementById('automationName').value = '';
        updateProgress(1);
    }

    // Dashboard View Toggles (Sidebar)
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Chart re-rendering handled by loadDashboardData() via navigateToView
        });
    });

    // Leads View Toggles (List vs Board)
    const viewToggles = document.querySelectorAll('.view-toggle');
    const viewContainers = document.querySelectorAll('.leads-view-container');

    viewToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            const target = toggle.getAttribute('data-target');

            // Update Toggle Buttons
            viewToggles.forEach(bt => bt.classList.remove('active'));
            toggle.classList.add('active');

            // Update View Containers
            viewContainers.forEach(container => {
                if (container.id === target) {
                    container.classList.add('active');
                } else {
                    container.classList.remove('active');
                }
            });

            // If switching to board, refresh Sortable or handle anything specific
            if (target === 'leads-board-view') {
                updateColumnCounts();
            }
        });
    });

    // Final global icon replacement
    if (typeof feather !== 'undefined') {
        feather.replace();
    }

    // --- META SETUP GUIDE LOGIC ---

    let currentMetaStep = 1;
    const metaSetupModal = document.getElementById('metaSetupModal');

    window.openMetaSetup = async () => {
        currentMetaStep = 1;
        overlay.classList.add('active');
        metaSetupModal.classList.add('active');

        // Fetch existing settings to pre-fill
        const settings = await fetchData('/api/settings');
        if (settings && settings.meta_app_id) {
            const appIdInput = document.getElementById('metaAppId');
            if (appIdInput) appIdInput.value = settings.meta_app_id;
        }

        updateMetaStepUI();
    };

    window.closeMetaSetup = () => {
        overlay.classList.remove('active');
        metaSetupModal.classList.remove('active');
    };

    window.changeMetaStep = (val) => {
        currentMetaStep += val;
        if (currentMetaStep < 1) currentMetaStep = 1;
        if (currentMetaStep > 4) {
            closeMetaSetup();
            return;
        }
        updateMetaStepUI();
    };

    function refreshIcons() {
        if (typeof feather !== 'undefined') {
            try {
                feather.replace();
            } catch (e) {
                console.warn('Feather replacement failed:', e);
            }
        }
    }

    function updateMetaStepUI() {
        // Hide all steps
        document.querySelectorAll('.meta-step').forEach(s => s.style.display = 'none');
        // Show current
        const activeStep = document.getElementById(`meta-step-${currentMetaStep}`);
        if (activeStep) activeStep.style.display = 'block';

        // Update Header
        const titles = [
            "Step 1: Expose Your Server",
            "Step 2: Connect Meta Account",
            "Step 3: Select Facebook Page",
            "Step 4: Configure Webhook",
            "Step 5: All Ready!"
        ];
        document.getElementById('metaStepTitle').textContent = titles[currentMetaStep - 1] || "Setup Guide";

        // Update Buttons
        const backBtn = document.getElementById('metaBackBtn');
        const nextBtn = document.getElementById('metaNextBtn');

        backBtn.style.visibility = currentMetaStep === 1 ? 'hidden' : 'visible';

        // Step 2 (Discovery) and Step 3 (Selection) require specific actions, so hide Next
        const REQUIRES_ACTION = currentMetaStep === 2 || currentMetaStep === 3;
        nextBtn.style.display = REQUIRES_ACTION ? 'none' : 'block';
        nextBtn.textContent = currentMetaStep === 5 ? 'Finish' : 'Next Step';

        refreshIcons();
    }

    // --- FACEBOOK SDK & AUTH LOGIC ---

    const FB_SDK_INIT_MAX_RETRIES = 10;
    let fbInitRetries = 0;

    function initFacebookSDK(appId) {
        if (!appId) return;

        if (typeof FB === 'undefined') {
            if (fbInitRetries < FB_SDK_INIT_MAX_RETRIES) {
                fbInitRetries++;
                setTimeout(() => initFacebookSDK(appId), 500);
            } else {
                alert("Facebook SDK failed to load. Please check your internet connection and App ID.");
            }
            return;
        }

        try {
            FB.init({
                appId: appId,
                cookie: true,
                xfbml: true,
                version: 'v19.0'
            });
            console.log("FB SDK Initialized with App ID:", appId);
        } catch (e) {
            console.error("FB Init Failed:", e);
        }
    }

    window.connectFacebook = () => {
        const appId = document.getElementById('metaAppId').value;
        if (!appId) {
            alert("Please enter your Meta App ID first.");
            return;
        }

        // Initialize immediately if not already done
        initFacebookSDK(appId);

        // Ensure we wait a moment or check if FB is ready
        if (typeof FB === 'undefined') {
            alert("Facebook SDK is still loading. Please wait a second and try again.");
            return;
        }

        FB.getLoginStatus(function (response) {
            // Force a fresh login to ensure we get a fresh token with correct scopes
            FB.login(function (loginResponse) {
                if (loginResponse.authResponse) {
                    processMetaAuth(loginResponse.authResponse.accessToken, appId);
                } else {
                    console.log('User cancelled login or did not fully authorize.');
                }
            }, {
                scope: 'pages_show_list,pages_read_engagement,pages_manage_ads,leads_retrieval,business_management',
                auth_type: 'rerequest' // Important to ask again for permissions if they were skipped
            });
        });
    };

    async function processMetaAuth(userToken, appId) {
        const result = await fetchData('/api/meta/pages', {
            method: 'POST',
            body: JSON.stringify({ userToken, appId })
        });

        if (result && result.success && result.pages) {
            renderMetaPages(result.pages, appId);
            changeMetaStep(1); // Move to Step 3 (Selection)
        } else {
            alert("Connection failed: " + (result ? result.error : "Unknown error"));
        }
    }

    function renderMetaPages(pages, appId) {
        const container = document.getElementById('meta-page-list');
        if (!container) return;

        if (pages.length === 0) {
            container.innerHTML = `<div class="text-secondary small" style="text-align: center; padding: 20px;">No business pages found.</div>`;
            return;
        }

        container.innerHTML = pages.map(page => `
            <div class="card selection-card" style="margin-bottom: 8px; padding: 16px;">
                <div class="selection-icon" style="background: #eef2ff;">
                    <i data-feather="flag"></i>
                </div>
                <div style="flex: 1">
                    <div class="automation-title">${page.name}</div>
                    <div class="automation-desc">${page.category || 'Facebook Page'}</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick='selectMetaPage(${JSON.stringify({
            appId,
            pageId: page.id,
            pageToken: page.access_token,
            pageName: page.name
        })})'>Select</button>
            </div>
        `).join('');

        refreshIcons();
    }

    // --- FACEBOOK QUICK CONNECT FLOW ---
    let quickMetaAppId = null;
    let quickMetaUserToken = null;
    let quickMetaPageData = null;

    window.loadMetaStatus = async () => {
        const status = await fetchData('/api/meta/status');
        const badge = document.getElementById('metaStatusBadge');
        const desc = document.getElementById('metaConnectionDesc');
        const quickBtn = document.getElementById('metaQuickConnectBtn');
        const disconnectBtn = document.getElementById('metaDisconnectBtn');
        const syncBtn = document.getElementById('metaSyncLeadsBtn');

        if (status && status.connected) {
            if (badge) {
                badge.textContent = 'Connected';
                badge.className = 'badge active';
                badge.style.background = '#e6f4ea';
                badge.style.color = '#137333';
            }
            if (desc) {
                let info = `Connected to page: <strong>${status.pageName}</strong> (ID: ${status.pageId})`;
                if (status.adAccountName) {
                    info += `<br>Linked Ad Account: <strong>${status.adAccountName}</strong> (ID: ${status.adAccountId})`;
                }
                
                // Fetch and render campaigns list
                desc.innerHTML = info + `<div style="margin-top: 12px; font-size:12px; color: var(--text-muted);">Fetching linked campaigns...</div>`;
                
                const campaigns = await fetchData('/api/meta/campaigns');
                if (campaigns && campaigns.length > 0) {
                    const listHtml = campaigns.map(c => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 4px 0; border-bottom: 1px dashed var(--border-color); font-size: 12px;">
                            <span style="font-weight: 500; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 70%;">${c.name}</span>
                            <span class="badge" style="padding: 2px 6px; font-size: 10px; background: ${c.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)'}; color: ${c.status === 'ACTIVE' ? '#10b981' : '#64748b'};">${c.status}</span>
                        </div>
                    `).join('');
                    desc.innerHTML = info + `
                        <div style="margin-top: 14px; border-top: 1px solid var(--border-color); padding-top: 10px; text-align: left;">
                            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Campaigns (${campaigns.length})</span>
                            <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px;">
                                ${listHtml}
                            </div>
                        </div>
                    `;
                } else {
                    desc.innerHTML = info + `<div style="margin-top: 12px; font-size:12px; color: var(--text-muted);">No active campaigns found on this Ad Account.</div>`;
                }
            }
            if (quickBtn) quickBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
            if (syncBtn) syncBtn.style.display = 'inline-flex';
        } else {
            if (badge) {
                badge.textContent = 'Not Connected';
                badge.className = 'badge new';
                badge.style.background = '';
                badge.style.color = '';
            }
            if (desc) desc.textContent = 'Automatically ingest leads from your Facebook & Instagram campaigns.';
            if (quickBtn) quickBtn.style.display = 'inline-flex';
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (syncBtn) syncBtn.style.display = 'none';
        }
        refreshIcons();
    };

    window.loadFacebookFormsTab = async () => {
        const container = document.getElementById('meta-forms-container');
        if (!container) return;

        container.innerHTML = '<div class="card" style="padding: 40px; text-align: center;"><div style="font-size: 14px; color: var(--text-muted);">Fetching Facebook lead forms...</div></div>';

        // Check if Meta is connected
        const status = await fetchData('/api/meta/status');
        if (!status || !status.connected) {
            container.innerHTML = `
                <div class="card" style="padding: 40px; text-align: center;">
                    <div style="background: rgba(6, 104, 225, 0.1); color: #0668E1; width: 64px; height: 64px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
                        <i data-feather="facebook" style="width: 32px; height: 32px;"></i>
                    </div>
                    <h3 style="font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">Facebook Account Not Connected</h3>
                    <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 24px; max-width: 400px; margin-left: auto; margin-right: auto;">
                        Connect your Facebook account under the <strong>Lead Sources</strong> tab to view and manage your lead generation forms.
                    </p>
                    <button class="btn btn-primary" onclick="document.querySelector('[data-tab=\\'sources\\']').click()" style="margin: 0 auto;">Go to Lead Sources</button>
                </div>
            `;
            if (window.feather) window.feather.replace();
            return;
        }

        // Fetch forms
        const forms = await fetchData('/api/meta/forms');
        if (!forms || forms.length === 0) {
            container.innerHTML = `
                <div class="card" style="padding: 40px; text-align: center;">
                    <div style="font-size: 14px; color: var(--text-muted);">No lead generation forms found for page <strong>${status.pageName}</strong>.</div>
                </div>
            `;
            return;
        }

        // Render forms table
        const rows = forms.map(f => {
            const statusColor = f.status === 'ACTIVE' ? '#10b981' : '#64748b';
            const statusBg = f.status === 'ACTIVE' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)';
            return `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="font-weight: 600; color: var(--text-primary); padding: 16px 24px;">${f.name}</td>
                    <td style="padding: 16px 24px;">${f.pageName}</td>
                    <td style="padding: 16px 24px;">
                        <span class="badge" style="background: ${statusBg}; color: ${statusColor}; border: none; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${f.status}</span>
                    </td>
                    <td style="padding: 16px 24px;">${f.leadsCount} leads</td>
                    <td style="padding: 16px 24px; text-align: right;">
                        <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                            <button class="btn btn-secondary btn-sm" onclick="syncMetaLeadsDirect('${f.id}')" style="gap: 4px; padding: 6px 12px; font-size: 12px;">
                                <i data-feather="refresh-cw" style="width: 12px; height: 12px;"></i> Sync Leads
                            </button>
                            <button class="btn btn-primary btn-sm" onclick="document.querySelector('[data-tab=\\'mapping\\']').click()" style="padding: 6px 12px; font-size: 12px;">
                                Map Fields
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <div class="card" style="overflow: hidden; padding: 0; border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); background: var(--bg-light);">
                            <th style="text-align: left; padding: 16px 24px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-color);">Form Name</th>
                            <th style="text-align: left; padding: 16px 24px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-color);">Facebook Page</th>
                            <th style="text-align: left; padding: 16px 24px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-color);">Status</th>
                            <th style="text-align: left; padding: 16px 24px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-color);">Sync Stats</th>
                            <th style="text-align: right; padding: 16px 24px; font-weight: 600; color: var(--text-muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border-color);">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;

        if (window.feather) window.feather.replace();
    };

    window.syncMetaLeadsDirect = async (formId) => {
        showToast("Starting manual lead sync...", "info");
        try {
            const res = await fetchData('/api/meta/sync-leads', { method: 'POST' });
            if (res && res.success) {
                showToast(`Synced ${res.count} existing leads from Facebook forms successfully!`);
                loadLeads();
                loadFacebookFormsTab();
            } else {
                showToast("Failed to sync leads: " + (res ? res.error : "Unknown error"), "error");
            }
        } catch (e) {
            showToast("Sync error: " + e.message, "error");
        }
    };

    window.syncMetaLeads = async () => {
        const btn = document.getElementById('metaSyncLeadsBtn');
        if (!btn) return;
        
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i data-feather="loader" class="spin" style="width:13px;height:13px;"></i> Syncing...';
        refreshIcons();

        try {
            const res = await fetchData('/api/meta/sync-leads', { method: 'POST' });
            if (res && res.success) {
                showToast(`Synced ${res.count} existing leads from Facebook forms successfully!`);
                // If on Leads view, refresh leads
                const activeSection = document.querySelector('.view-section.active');
                if (activeSection && activeSection.id === 'leads') {
                    loadLeads();
                }
            } else {
                showToast("Failed to sync leads: " + (res ? res.error : "Unknown error"), "error");
            }
        } catch (e) {
            showToast("Sync error: " + e.message, "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            refreshIcons();
        }
    };

    window.openMetaQuickConnect = async () => {
        const config = await fetchData('/api/meta/app-config');
        if (!config || !config.appId) {
            alert("Meta App ID is not configured in the server's .env file. Please edit your .env file and set META_APP_ID.");
            return;
        }
        quickMetaAppId = config.appId;
        
        // Reset steps
        document.querySelectorAll('.meta-quick-step').forEach(s => s.style.display = 'none');
        document.getElementById('meta-quick-auth').style.display = 'block';
        document.getElementById('metaQuickTitle').textContent = "Step 1: Auth SimpleFunnel";

        const modal = document.getElementById('metaQuickConnectModal');
        overlay.classList.add('active');
        modal.classList.add('active');
        refreshIcons();
    };

    window.closeMetaQuickConnect = () => {
        overlay.classList.remove('active');
        document.getElementById('metaQuickConnectModal').classList.remove('active');
        loadMetaStatus();
    };

    window.startMetaQuickAuth = () => {
        if (!quickMetaAppId) return;

        initFacebookSDK(quickMetaAppId);

        if (typeof FB === 'undefined') {
            alert("Facebook SDK is still loading. Please wait a second and try again.");
            return;
        }

        FB.getLoginStatus(function (response) {
            FB.login(function (loginResponse) {
                if (loginResponse.authResponse) {
                    quickMetaUserToken = loginResponse.authResponse.accessToken;
                    showMetaQuickPages();
                } else {
                    console.log('User cancelled login or did not fully authorize.');
                }
            }, {
                scope: 'pages_show_list,pages_read_engagement,pages_manage_ads,leads_retrieval,ads_management,business_management',
                auth_type: 'rerequest'
            });
        });
    };

    async function showMetaQuickPages() {
        if (!quickMetaUserToken) return;

        document.querySelectorAll('.meta-quick-step').forEach(s => s.style.display = 'none');
        const pageStep = document.getElementById('meta-quick-page');
        pageStep.style.display = 'block';
        document.getElementById('metaQuickTitle').textContent = "Step 2: Choose Page";

        const listContainer = document.getElementById('meta-quick-pages-list');
        listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Fetching pages...</div>';

        const result = await fetchData('/api/meta/pages', {
            method: 'POST',
            body: JSON.stringify({ userToken: quickMetaUserToken })
        });

        if (result && result.success && result.pages) {
            if (result.pages.length === 0) {
                listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No pages found. Make sure you are an admin.</div>';
                return;
            }

            listContainer.innerHTML = result.pages.map(page => `
                <div class="card selection-card" style="margin-bottom: 8px; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; min-height: 64px;">
                    <div style="flex: 1; text-align: left; min-width: 0;">
                        <div style="font-weight:600; color:var(--text-primary); font-size:14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${page.name}</div>
                        <div style="font-size:11px; color:var(--text-muted);">${page.category || 'Facebook Page'}</div>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="selectMetaQuickPage('${page.id}', '${page.access_token}', '${page.name.replace(/'/g, "\\'")}')">Select</button>
                </div>
            `).join('');
        } else {
            listContainer.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px;">Error: ${result ? result.error : 'Failed to retrieve pages'}</div>`;
        }
    }

    window.selectMetaQuickPage = (pageId, pageToken, pageName) => {
        quickMetaPageData = { pageId, pageToken, pageName };
        showMetaQuickAds();
    };

    async function showMetaQuickAds() {
        if (!quickMetaUserToken) return;

        document.querySelectorAll('.meta-quick-step').forEach(s => s.style.display = 'none');
        const adsStep = document.getElementById('meta-quick-ads');
        adsStep.style.display = 'block';
        document.getElementById('metaQuickTitle').textContent = "Step 3: Choose Ad Account";

        const listContainer = document.getElementById('meta-quick-ads-list');
        listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Fetching ad accounts...</div>';

        const result = await fetchData('/api/meta/adaccounts', {
            method: 'POST',
            body: JSON.stringify({ userToken: quickMetaUserToken })
        });

        if (result && result.success && result.adaccounts) {
            const displayAccounts = result.adaccounts;

            if (displayAccounts.length === 0) {
                listContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No ad accounts found.</div>';
                return;
            }

            const statusNames = {
                1: 'Active',
                2: 'Disabled',
                3: 'Unpaid Bills',
                7: 'Pending Risk Review',
                9: 'In Grace Period',
                100: 'Pending Settlement',
                101: 'Pending System Decision',
                102: 'Pending Settlement'
            };

            listContainer.innerHTML = displayAccounts.map(acc => {
                const statusLabel = statusNames[acc.account_status] || `Status ${acc.account_status}`;
                const statusBadge = acc.account_status !== 1 
                    ? ` | <span style="color:#ef4444; font-weight: 500;">(${statusLabel})</span>` 
                    : '';
                return `
                    <div class="card selection-card" style="margin-bottom: 8px; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; min-height: 64px;">
                        <div style="flex: 1; text-align: left; min-width: 0;">
                            <div style="font-weight:600; color:var(--text-primary); font-size:14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${acc.name}</div>
                            <div style="font-size:11px; color:var(--text-muted);">ID: ${acc.id}${statusBadge}</div>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="selectMetaQuickAdAccount('${acc.id}', '${acc.name.replace(/'/g, "\\'")}')">Link</button>
                    </div>
                `;
            }).join('');
        } else {
            listContainer.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px;">Error: ${result ? result.error : 'Failed to retrieve ad accounts'}</div>`;
        }
    }

    window.selectMetaQuickAdAccount = async (adAccountId, adAccountName) => {
        if (!quickMetaPageData) return;

        const payload = {
            ...quickMetaPageData,
            adAccountId,
            adAccountName,
            userToken: quickMetaUserToken
        };

        const result = await fetchData('/api/meta/save-page', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result && result.success) {
            showMetaQuickSuccess();
        } else {
            alert("Failed to save selection: " + (result ? result.error : "Unknown error"));
        }
    };

    window.skipMetaQuickAds = async () => {
        if (!quickMetaPageData) return;

        const payload = {
            ...quickMetaPageData,
            userToken: quickMetaUserToken
        };

        const result = await fetchData('/api/meta/save-page', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (result && result.success) {
            showMetaQuickSuccess();
        } else {
            alert("Failed to save selection: " + (result ? result.error : "Unknown error"));
        }
    };

    function showMetaQuickSuccess() {
        document.querySelectorAll('.meta-quick-step').forEach(s => s.style.display = 'none');
        document.getElementById('meta-quick-success').style.display = 'block';
        document.getElementById('meta-quick-success-desc').innerHTML = `Connected Facebook Page: <strong>${quickMetaPageData.pageName}</strong> successfully!`;
        document.getElementById('metaQuickTitle').textContent = "Connection Successful";
        refreshIcons();
    }

    window.disconnectMeta = async () => {
        if (confirm("Are you sure you want to disconnect Facebook Integration?")) {
            const res = await fetchData('/api/meta/disconnect', { method: 'DELETE' });
            if (res && res.success) {
                showToast("Meta integration disconnected.");
                loadMetaStatus();
            }
        }
    };

    window.copyText = (elementId) => {
        const input = document.getElementById(elementId);
        input.select();
        document.execCommand("copy");
        const btn = input.nextElementSibling;
        const originalText = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = originalText, 2000);
    };

    // --- INTEGRATION UTILITIES ---

    // Google Sheets Modal Logic
    let currentGSStep = 1;
    const TOTAL_GS_STEPS = 3;

    window.openGSheetsSetup = () => {
        const overlay = document.getElementById('overlay');
        const modal = document.getElementById('gSheetsSetupModal');
        overlay.classList.add('active');
        modal.classList.add('active');
        currentGSStep = 1;

        // Dynamically inject the actual webhook URL if ngrok is active
        const actualWebhookUrl = document.getElementById('webhookUrl').textContent;
        const scriptCode = document.getElementById('gsScriptCode');
        if (scriptCode) {
            scriptCode.textContent = scriptCode.textContent.replace("YOUR_NGROK_URL/api/webhooks/generic", actualWebhookUrl);
        }

        updateGSStepUI();
    };

    window.closeGSheetsSetup = () => {
        document.getElementById('overlay').classList.remove('active');
        document.getElementById('gSheetsSetupModal').classList.remove('active');
    };

    window.changeGSStep = (delta) => {
        currentGSStep += delta;
        if (currentGSStep < 1) currentGSStep = 1;
        if (currentGSStep > TOTAL_GS_STEPS) {
            closeGSheetsSetup();
            return;
        }
        updateGSStepUI();
    };

    function updateGSStepUI() {
        document.querySelectorAll('.gs-step').forEach(s => s.style.display = 'none');
        const activeStep = document.getElementById(`gs-step-${currentGSStep}`);
        if (activeStep) activeStep.style.display = 'block';

        const titles = [
            "Step 1: Connect Meta to Google Sheets",
            "Step 2: Add the Bridge Script",
            "Step 3: Set Trigger & Finish"
        ];
        document.getElementById('gsStepTitle').textContent = titles[currentGSStep - 1];

        const backBtn = document.getElementById('gsBackBtn');
        const nextBtn = document.getElementById('gsNextBtn');

        backBtn.style.visibility = currentGSStep === 1 ? 'hidden' : 'visible';
        nextBtn.textContent = currentGSStep === TOTAL_GS_STEPS ? 'Finish Setup' : 'Next Step';
    }

    window.copyGsScript = () => {
        const scriptCode = document.getElementById('gsScriptCode').textContent;
        navigator.clipboard.writeText(scriptCode).then(() => {
            alert('Apps Script Code copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy code:', err);
        });
    };

    window.copyWebhookUrl = () => {
        const url = window.location.origin + '/api/webhooks/generic';
        navigator.clipboard.writeText(url).then(() => {
            alert('Webhook URL copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    };

    window.showFormSnippet = () => {
        const snippet = `
<!-- Minimal CRM Lead Capture Form -->
<form action="http://localhost:3000/api/webhooks/generic" method="POST">
    <input type="text" name="name" placeholder="Full Name" required>
    <input type="email" name="email" placeholder="Email Address">
    <input type="tel" name="phone" placeholder="Phone Number">
    <input type="hidden" name="source" value="Website Form">
    <button type="submit">Send Message</button>
</form>
        `.trim();

        // Use a simple alert for now, or could use a modal
        alert("Copy this HTML to your website:\n\n" + snippet);
    };

    // --- CSV IMPORT LOGIC ---

    const importModal = document.getElementById('importModal');
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');
    const uploadState = document.getElementById('import-upload-state');
    const previewState = document.getElementById('import-preview-state');
    const previewBody = document.getElementById('import-preview-body');
    const rowCountEl = document.getElementById('import-row-count');
    const importFooter = document.getElementById('import-modal-footer');

    let parsedLeads = [];

    window.openImportModal = () => {
        overlay.classList.add('active');
        importModal.classList.add('active');
        resetImport();
    };

    window.closeImportModal = () => {
        overlay.classList.remove('active');
        importModal.classList.remove('active');
        resetImport();
    };

    window.resetImport = () => {
        parsedLeads = [];
        uploadState.style.display = 'block';
        previewState.style.display = 'none';
        importFooter.style.display = 'none';
        if (fileInput) fileInput.value = '';
        if (previewBody) previewBody.innerHTML = '';
        refreshIcons();
    };

    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover'].forEach(name => {
            dropzone.addEventListener(name, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(name => {
            dropzone.addEventListener(name, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                if (name === 'drop') {
                    const files = e.dataTransfer.files;
                    if (files.length) handleFile(files[0]);
                }
            });
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });
    }

    function handleFile(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Please select a valid CSV file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            processCSV(text);
        };
        reader.readAsText(file);
    }

    function processCSV(text) {
        const rows = text.split('\n').filter(row => row.trim() !== '');
        if (rows.length === 0) return;

        // Skip header if it looks like one (contains 'name' or 'email')
        let startIndex = 0;
        const firstRow = rows[0].toLowerCase();
        if (firstRow.includes('name') || firstRow.includes('email') || firstRow.includes('phone')) {
            startIndex = 1;
        }

        parsedLeads = rows.slice(startIndex).map(row => {
            const columns = row.split(',').map(col => col.trim().replace(/^"|"$/g, ''));
            return {
                name: columns[0] || '',
                email: columns[1] || '',
                phone: columns[2] || ''
            };
        }).filter(lead => lead.name); // Ignore if name is missing

        if (parsedLeads.length === 0) {
            alert('No valid leads found in the CSV. Make sure the first column contains names.');
            return;
        }

        renderImportPreview();
    }

    function renderImportPreview() {
        uploadState.style.display = 'none';
        previewState.style.display = 'block';
        importFooter.style.display = 'flex';

        rowCountEl.textContent = `${parsedLeads.length} leads found`;

        previewBody.innerHTML = parsedLeads.map(lead => `
            <tr>
                <td>${lead.name}</td>
                <td><span class="text-secondary">${lead.email || '-'}</span></td>
                <td><span class="text-secondary">${lead.phone || '-'}</span></td>
            </tr>
        `).join('');
    }

    window.submitLeadImport = async () => {
        if (parsedLeads.length === 0) return;

        const result = await fetchData('/api/leads/import', {
            method: 'POST',
            body: JSON.stringify({ leads: parsedLeads })
        });

        if (result && result.success) {
            alert(`Successfully imported ${result.count} leads!`);
            closeImportModal();
            const leads = await fetchData('/api/leads');
            if (leads) renderLeads(leads);
            loadDashboardData();
        } else {
            alert('Import failed: ' + (result ? result.error : 'Unknown error'));
        }
    };

    // --- INIT SYSTEM ---
    (async () => {
        if (typeof checkUserSession === 'function') {
            checkUserSession();
        }
        if (typeof populateFilterDropdowns === 'function') {
            await populateFilterDropdowns();
        }
        // Preload tasks badge count
        const taskStats = await fetchData('/api/tasks?status=open');
        if (taskStats) {
            const today = new Date().toISOString().split('T')[0];
            const overdueCount = taskStats.filter(t => t.due_date && t.due_date < today).length;
            const badge = document.getElementById('tasks-overdue-badge');
            if (badge && overdueCount > 0) {
                badge.textContent = overdueCount;
                badge.style.display = 'inline-flex';
            }
        }
    })();

});

// --- GLOBAL GATEWAY CONFIGURATION ---
// Defined outside the listener to ensure they are available immediately for inline onclicks
let currentGatewayType = null;

window.openGatewaySettings = async (type) => {
    console.log(`Opening gateway settings for: ${type}`);
    currentGatewayType = type;
    const modal = document.getElementById('gatewayModal');
    const overlay = document.getElementById('overlay');
    const title = document.getElementById('gatewayModalTitle');
    const emailForm = document.getElementById('emailGatewayForm');
    const whatsappForm = document.getElementById('whatsappGatewayForm');

    if (!modal || !overlay) return console.error('Gateway UI elements missing');

    // Reset and Toggle forms
    emailForm.style.display = type === 'email' ? 'block' : 'none';
    whatsappForm.style.display = type === 'whatsapp' ? 'block' : 'none';
    title.textContent = type === 'email' ? 'Connect Your Email' : 'Connect Your WhatsApp';

    // Set default provider if email
    if (type === 'email' && typeof selectEmailProvider === 'function') {
        selectEmailProvider('gmail');
    }

    // Load existing settings
    try {
        const settings = await fetchData('/api/settings');
        if (settings) {
            if (type === 'email') {
                if (settings.smtp_host) document.getElementById('smtp_host').value = settings.smtp_host;
                if (settings.smtp_port) document.getElementById('smtp_port').value = settings.smtp_port;
                if (settings.smtp_from) document.getElementById('smtp_from').value = settings.smtp_from;
                document.getElementById('smtp_user').value = settings.smtp_user || '';
                document.getElementById('smtp_pass').value = settings.smtp_pass || '';

                // If we have a host, update the provider icons to match
                if (settings.smtp_host.includes('gmail')) selectEmailProvider('gmail');
                if (settings.smtp_host.includes('office365') || settings.smtp_host.includes('outlook')) selectEmailProvider('outlook');
            } else {
                document.getElementById('twilio_sid').value = settings.twilio_sid || '';
                document.getElementById('twilio_token').value = settings.twilio_token || '';
                document.getElementById('twilio_phone').value = settings.twilio_phone || '';
            }
        }
    } catch (e) {
        console.warn('Failed to load gateway settings:', e);
    }

    overlay.classList.add('active');
    modal.classList.add('active');
    if (window.refreshIcons) window.refreshIcons();
};

window.saveGatewaySettings = async () => {
    const payload = {};
    if (currentGatewayType === 'email') {
        payload.smtp_host = document.getElementById('smtp_host').value;
        payload.smtp_port = document.getElementById('smtp_port').value;
        payload.smtp_from = document.getElementById('smtp_from').value;
        payload.smtp_user = document.getElementById('smtp_user').value;
        payload.smtp_pass = document.getElementById('smtp_pass').value;
    } else {
        payload.twilio_sid = document.getElementById('twilio_sid').value;
        payload.twilio_token = document.getElementById('twilio_token').value;
        payload.twilio_phone = document.getElementById('twilio_phone').value;
    }

    const result = await fetchData('/api/settings', {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    if (result) {
        alert(`${currentGatewayType === 'email' ? 'Email' : 'WhatsApp'} Gateway settings saved!`);
        updateGatewayStatusBadges();
        closeModal();
    }
};

window.testGatewayConnection = async (e) => {
    // Handle both passed event and window.event
    const eventObj = e || window.event;
    const btn = eventObj ? eventObj.target.closest('button') : null;
    const originalText = btn ? btn.innerHTML : 'Test';
    const recipient = document.getElementById('test_recipient') ? document.getElementById('test_recipient').value : '';

    if (btn) {
        btn.innerHTML = 'Testing...';
        btn.disabled = true;
    }

    try {
        const result = await fetchData('/api/test-gateways', {
            method: 'POST',
            body: JSON.stringify({
                type: currentGatewayType,
                recipient: recipient // Send custom recipient if provided
            })
        });

        if (result && result.success) {
            alert('Test Success! ' + result.message);
            if (window.loadActivityFeed) window.loadActivityFeed();
        } else {
            alert('Test Failed: ' + (result ? result.message : 'Check your settings.'));
        }
    } catch (error) {
        alert('Error testing gateway: ' + error.message);
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
};

async function updateGatewayStatusBadges() {
    try {
        const settings = await fetchData('/api/settings');
        if (settings) {
            const emailBadge = document.getElementById('badge-email-status');
            const whatsappBadge = document.getElementById('badge-whatsapp-status');

            if (emailBadge && settings.smtp_host && settings.smtp_user) {
                emailBadge.textContent = 'Active';
                emailBadge.style.background = '#e6f4ea';
                emailBadge.style.color = '#137333';
            }
            if (whatsappBadge && settings.twilio_sid && settings.twilio_token) {
                whatsappBadge.textContent = 'Active';
                whatsappBadge.style.background = '#e6f4ea';
                whatsappBadge.style.color = '#137333';
            }
        }
    } catch (e) { }
}

// Re-expose refreshIcons for external use if needed
window.refreshIcons = () => {
    if (typeof feather !== 'undefined') feather.replace();
};

// --- SIMPLIFIED PROVIDER LOGIC ---
window.selectEmailProvider = (provider) => {
    const gmailBtn = document.getElementById('prov-gmail');
    const outlookBtn = document.getElementById('prov-outlook');
    const hostInput = document.getElementById('smtp_host');
    const portInput = document.getElementById('smtp_port');

    // Toggle active state visuals
    gmailBtn.style.borderColor = provider === 'gmail' ? 'var(--primary-color)' : 'var(--border-color)';
    gmailBtn.style.background = provider === 'gmail' ? 'rgba(79, 70, 229, 0.05)' : 'transparent';
    outlookBtn.style.borderColor = provider === 'outlook' ? 'var(--primary-color)' : 'var(--border-color)';
    outlookBtn.style.background = provider === 'outlook' ? 'rgba(79, 70, 229, 0.05)' : 'transparent';

    if (provider === 'gmail') {
        hostInput.value = 'smtp.gmail.com';
        portInput.value = '465';
    } else if (provider === 'outlook') {
        hostInput.value = 'smtp.office365.com';
        portInput.value = '587';
    }
};

window.toggleAdvancedEmail = () => {
    const advFields = document.getElementById('advanced-email-fields');
    const isHidden = advFields.style.display === 'none';
    advFields.style.display = isHidden ? 'block' : 'none';
};

console.log('--- SimpleFunnel CRM: Messaging Engine Loaded ---');

/* ========================================================
   CRM v2 — NEW MODULE JAVASCRIPT
   ======================================================== */

// --- DRAWER TAB SWITCHING ---
document.addEventListener('click', (e) => {
    const tab = e.target.closest('.drawer-tab');
    if (!tab) return;
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.drawer-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const content = document.getElementById(`drawer-tab-${tabName}`);
    if (content) content.classList.add('active');
});

// --- SAVE LEAD EDITS ---
window.saveLeadEdits = async () => {
    if (!window.currentDrawerLead) return;
    const lead = window.currentDrawerLead;
    const payload = {
        name: document.getElementById('drawerEditName').value,
        email: document.getElementById('drawerEditEmail').value,
        phone: document.getElementById('drawerEditPhone').value,
        company: document.getElementById('drawerEditCompany').value,
        source: document.getElementById('drawerEditSource').value,
        value: parseFloat(document.getElementById('drawerEditValue').value) || 0,
        status: document.getElementById('drawerEditStage').value,
        assigned_to: document.getElementById('drawerEditAssigned').value
    };
    const result = await fetchData(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (result) {
        window.currentDrawerLead = result;
        document.getElementById('drawerLeadName').textContent = result.name;
        const stageBadge = document.getElementById('drawerStageBadge');
        if (stageBadge) stageBadge.textContent = result.status;
        showToast('Lead updated successfully!');
        loadLeads();
        loadDashboardData();
    }
};

// --- LEAD NOTES ---
window.submitLeadNote = async () => {
    if (!window.currentDrawerLead) return;
    const input = document.getElementById('drawerNoteInput');
    const msg = input.value.trim();
    if (!msg) return;
    const result = await fetchData(`/api/leads/${window.currentDrawerLead.id}/notes`, { method: 'POST', body: JSON.stringify({ message: msg }) });
    if (result) {
        input.value = '';
        const logs = await fetchData(`/api/leads/${window.currentDrawerLead.id}/logs`);
        renderTimeline('leadTimeline', logs);
        showToast('Note added!');
    }
};

// --- DRAWER TASK CREATION ---
window.submitDrawerTask = async () => {
    if (!window.currentDrawerLead) return;
    const title = document.getElementById('drawerTaskTitle').value.trim();
    if (!title) return;
    const payload = {
        title,
        lead_id: window.currentDrawerLead.id,
        due_date: document.getElementById('drawerTaskDue').value,
        priority: document.getElementById('drawerTaskPriority').value
    };
    const result = await fetchData('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    if (result) {
        document.getElementById('drawerTaskTitle').value = '';
        loadDrawerTasks(window.currentDrawerLead.id);
        showToast('Task created!');
    }
};

async function loadDrawerTasks(leadId) {
    const tasks = await fetchData(`/api/tasks?lead_id=${leadId}`);
    const container = document.getElementById('drawerTasksList');
    if (!container) return;
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size:13px; padding:8px 0;">No tasks yet.</div>';
        return;
    }
    container.innerHTML = tasks.map(t => renderTaskCard(t)).join('');
    feather.replace();
}

function renderTaskCard(task) {
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = task.due_date && task.due_date < today && task.status === 'open';
    const isDone = task.status === 'done';
    const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
    return `
        <div class="task-card ${isOverdue ? 'overdue' : ''} ${isDone ? 'done' : ''}">
            <div class="task-check ${isDone ? 'done' : ''}" onclick="toggleTask(${task.id}, '${task.status}')"></div>
            <div class="priority-dot ${task.priority || 'medium'}" style="background:${priorityColors[task.priority] || '#f59e0b'};"></div>
            <div class="task-body">
                <div class="task-title" style="${isDone ? 'text-decoration:line-through;' : ''}">${task.title}</div>
                <div class="task-meta">
                    ${task.due_date ? `<span class="${isOverdue ? 'overdue-text' : ''}">${isOverdue ? '⚠ Overdue: ' : ''}${task.due_date}</span>` : 'No due date'}
                    ${task.lead_name ? ` · ${task.lead_name}` : ''}
                </div>
            </div>
            <button onclick="deleteTask(${task.id})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;"><i data-feather="trash-2" style="width:14px;height:14px;"></i></button>
        </div>
    `;
}

window.toggleTask = async (taskId, currentStatus) => {
    const newStatus = currentStatus === 'done' ? 'open' : 'done';
    await fetchData(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    loadTasks();
    if (window.currentDrawerLead) loadDrawerTasks(window.currentDrawerLead.id);
};

window.deleteTask = async (taskId) => {
    await fetchData(`/api/tasks/${taskId}`, { method: 'DELETE' });
    loadTasks();
    if (window.currentDrawerLead) loadDrawerTasks(window.currentDrawerLead.id);
};

// --- TASKS MODULE ---
async function loadTasks() {
    const statusFilter = document.getElementById('filterTaskStatus')?.value || '';
    const params = statusFilter ? `?status=${statusFilter}` : '';
    const tasks = await fetchData(`/api/tasks${params}`);
    if (!tasks) return;

    const today = new Date().toISOString().split('T')[0];
    const overdueTasks = tasks.filter(t => t.due_date && t.due_date < today && t.status === 'open');
    const todayTasks = tasks.filter(t => t.due_date === today && t.status === 'open');
    const upcomingTasks = tasks.filter(t => (!t.due_date || t.due_date > today) || t.status === 'done');

    const overdueSection = document.getElementById('tasks-overdue-section');
    const todaySection = document.getElementById('tasks-today-section');
    if (overdueSection) overdueSection.style.display = overdueTasks.length ? 'block' : 'none';
    if (todaySection) todaySection.style.display = todayTasks.length ? 'block' : 'none';

    const renderList = (containerId, list) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = list.length ? list.map(t => renderTaskCard(t)).join('') : '';
    };

    renderList('tasks-overdue-list', overdueTasks);
    renderList('tasks-today-list', todayTasks);
    const upcomingEl = document.getElementById('tasks-upcoming-list');
    if (upcomingEl) {
        if (tasks.length === 0) {
            // Hide the "Upcoming" label
            if (upcomingEl.previousElementSibling) upcomingEl.previousElementSibling.style.display = 'none';
            upcomingEl.innerHTML = `
                <div class="empty-state-card" style="margin: 40px auto;">
                    <div class="empty-state-icon-wrapper">
                        <i data-feather="check-circle"></i>
                    </div>
                    <h3 class="empty-state-title">All tasks completed</h3>
                    <p class="empty-state-desc">You don't have any tasks scheduled. Create a new task to stay on top of your deals.</p>
                    <button class="empty-state-cta-btn" onclick="openAddTaskModal()">
                        <i data-feather="plus"></i> Add New Task
                    </button>
                </div>
            `;
        } else {
            // Show the "Upcoming" label
            if (upcomingEl.previousElementSibling) upcomingEl.previousElementSibling.style.display = 'block';
            upcomingEl.innerHTML = upcomingTasks.length
                ? upcomingTasks.map(t => renderTaskCard(t)).join('')
                : '<div class="empty-state" style="padding:40px; text-align:center;">No upcoming tasks!</div>';
        }
    }

    // Update overdue badge in nav
    const badge = document.getElementById('tasks-overdue-badge');
    if (badge) {
        badge.textContent = overdueTasks.length;
        badge.style.display = overdueTasks.length > 0 ? 'inline-flex' : 'none';
    }

    feather.replace();
}

document.getElementById('filterTaskStatus')?.addEventListener('change', loadTasks);

// --- ADD TASK MODAL ---
window.openAddTaskModal = async () => {
    const modal = document.getElementById('addTaskModal');
    if (!modal) return;
    // Populate assigned select
    const team = await fetchData('/api/team');
    const taskAssigned = document.getElementById('taskAssigned');
    if (taskAssigned && team) {
        taskAssigned.innerHTML = '<option value="">Unassigned</option>' + team.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    }
    // Populate lead link select
    const taskLeadLink = document.getElementById('taskLeadLink');
    if (taskLeadLink) {
        const leads = await fetchData('/api/leads?limit=50');
        if (leads) {
            taskLeadLink.innerHTML = '<option value="">None</option>' + leads.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
        }
    }
    overlay.classList.add('active');
    modal.classList.add('active');
};

window.closeAddTaskModal = () => {
    document.getElementById('addTaskModal')?.classList.remove('active');
    overlay.classList.remove('active');
};

window.submitNewTask = async () => {
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) return alert('Task title is required.');
    const payload = {
        title,
        due_date: document.getElementById('taskDue').value || null,
        priority: document.getElementById('taskPriority').value,
        assigned_to: document.getElementById('taskAssigned').value,
        lead_id: document.getElementById('taskLeadLink').value || null
    };
    const result = await fetchData('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    if (result) {
        closeAddTaskModal();
        document.getElementById('taskTitle').value = '';
        loadTasks();
        showToast('Task created!');
    }
};

// --- CONTACTS MODULE ---
async function loadContacts(q = '') {
    const params = q ? `?q=${encodeURIComponent(q)}` : '';
    const contacts = await fetchData(`/api/contacts${params}`);
    const tbody = document.getElementById('contacts-table-body');
    if (!tbody) return;
    if (!contacts || contacts.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="padding: 0;">
                    <div class="empty-state-card" style="border:none; background:transparent; box-shadow:none; padding:40px 20px; margin:0 auto;">
                        <div class="empty-state-icon-wrapper">
                            <i data-feather="book-open"></i>
                        </div>
                        <h3 class="empty-state-title">No contacts found</h3>
                        <p class="empty-state-desc">Keep track of your customer relationships and contact history. Add a contact to get started.</p>
                        <button class="empty-state-cta-btn" onclick="openAddContactModal()">
                            <i data-feather="plus"></i> Add New Contact
                        </button>
                    </div>
                </td>
            </tr>
        `;
        feather.replace();
        return;
    }
    tbody.innerHTML = contacts.map(c => `
        <tr>
            <td>
                <div class="table-user">
                    <div class="avatar">${(c.name || '?')[0].toUpperCase()}</div>
                    <div>
                        <strong>${c.name}</strong>
                        ${c.company ? `<p>${c.company}${c.title ? ` · ${c.title}` : ''}</p>` : ''}
                    </div>
                </div>
            </td>
            <td>${c.email || '<span class="text-muted">-</span>'}</td>
            <td>${c.phone || '<span class="text-muted">-</span>'}</td>
            <td>${c.assigned_to || '<span class="text-muted">Unassigned</span>'}</td>
            <td>${new Date(c.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="deleteContact(${c.id})" style="color:#ef4444; border-color:#ef4444;">Delete</button>
            </td>
        </tr>
    `).join('');
    feather.replace();
}

window.deleteContact = async (id) => {
    if (!confirm('Delete this contact?')) return;
    await fetchData(`/api/contacts/${id}`, { method: 'DELETE' });
    loadContacts();
};

window.openAddContactModal = async () => {
    const modal = document.getElementById('addContactModal');
    if (!modal) return;
    const team = await fetchData('/api/team');
    const sel = document.getElementById('contactAssigned');
    if (sel && team) {
        sel.innerHTML = '<option value="">Unassigned</option>' + team.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    }
    overlay.classList.add('active');
    modal.classList.add('active');
};

window.closeAddContactModal = () => {
    document.getElementById('addContactModal')?.classList.remove('active');
    overlay.classList.remove('active');
};

window.submitNewContact = async () => {
    const name = document.getElementById('contactName').value.trim();
    if (!name) return alert('Name is required.');
    const payload = {
        name,
        email: document.getElementById('contactEmail').value,
        phone: document.getElementById('contactPhone').value,
        company: document.getElementById('contactCompany').value,
        title: document.getElementById('contactTitle').value,
        assigned_to: document.getElementById('contactAssigned').value
    };
    const result = await fetchData('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
    if (result) {
        closeAddContactModal();
        document.getElementById('contactName').value = '';
        loadContacts();
        showToast('Contact added!');
    }
};

// Contact search
const contactSearchInput = document.getElementById('contactSearchInput');
if (contactSearchInput) {
    let contactSearchTimer;
    contactSearchInput.addEventListener('input', () => {
        clearTimeout(contactSearchTimer);
        contactSearchTimer = setTimeout(() => loadContacts(contactSearchInput.value), 350);
    });
}

// --- TEAM MODULE ---
async function loadTeam() {
    const team = await fetchData('/api/team');
    const grid = document.getElementById('team-members-grid');
    if (!grid) return;
    if (!team || team.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="text-align:center; padding:40px;">No team members yet.</div>';
        return;
    }
    grid.innerHTML = team.map(m => {
        const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const colors = ['linear-gradient(135deg,#6366f1,#8b5cf6)', 'linear-gradient(135deg,#10b981,#34d399)', 'linear-gradient(135deg,#f59e0b,#fbbf24)', 'linear-gradient(135deg,#ef4444,#f87171)'];
        const color = colors[m.id % colors.length];
        return `
            <div class="team-member-card">
                <button class="team-delete-btn" onclick="deleteTeamMember(${m.id})">
                    <i data-feather="trash-2" style="width:14px;height:14px;"></i>
                </button>
                <div class="team-member-avatar" style="background:${color};">${initials}</div>
                <div class="team-member-name">${m.name}</div>
                <div class="team-member-email">${m.email}</div>
                <span class="team-role-badge ${m.role}">${m.role}</span>
            </div>
        `;
    }).join('');
    feather.replace();
}

window.toggleAddTeamForm = () => {
    const modal = document.getElementById('addTeamModal');
    const overlay = document.getElementById('overlay');
    if (modal && overlay) {
        modal.classList.toggle('active');
        overlay.classList.toggle('active');
    }
};

window.submitNewTeamMember = async () => {
    const name = document.getElementById('teamMemberName').value.trim();
    const email = document.getElementById('teamMemberEmail').value.trim();
    const role = document.getElementById('teamMemberRole').value;
    if (!name || !email) return alert('Name and email are required.');
    const result = await fetchData('/api/team', { method: 'POST', body: JSON.stringify({ name, email, role }) });
    if (result) {
        document.getElementById('teamMemberName').value = '';
        document.getElementById('teamMemberEmail').value = '';
        toggleAddTeamForm();
        loadTeam();
        showToast('Team member added!');
    }
};

window.deleteTeamMember = async (id) => {
    if (!confirm('Remove this team member?')) return;
    await fetchData(`/api/team/${id}`, { method: 'DELETE' });
    loadTeam();
};

// --- GLOBAL SEARCH ---
const globalSearchInput = document.getElementById('globalSearchInput');
if (globalSearchInput) {
    let searchTimer;
    globalSearchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = globalSearchInput.value.trim();
        if (!q) {
            loadLeads();
            return;
        }
        searchTimer = setTimeout(async () => {
            const results = await fetchData(`/api/leads/search?q=${encodeURIComponent(q)}`);
            if (results) {
                renderLeads(results);
                // Navigate to leads view if not already there
                const leadsSection = document.getElementById('leads');
                if (leadsSection && !leadsSection.classList.contains('active')) {
                    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
                    leadsSection.classList.add('active');
                    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                    document.querySelector('.nav-item[data-view="leads"]')?.classList.add('active');
                }
            }
        }, 400);
    });
}

// --- CSV EXPORT ---
window.exportLeadsCSV = () => {
    window.open('/api/leads/export', '_blank');
};

// --- LEADS FILTERS ---
async function populateFilterDropdowns() {
    const stages = await fetchData('/api/stages');
    const stageFilter = document.getElementById('filterStage');
    if (stageFilter && stages) {
        stageFilter.innerHTML = '<option value="">All Stages</option>' + stages.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }
    const team = await fetchData('/api/team');
    const assignedFilter = document.getElementById('filterAssigned');
    if (assignedFilter && team) {
        assignedFilter.innerHTML = '<option value="">All Assignees</option>' + team.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    }
}

const filterStage = document.getElementById('filterStage');
const filterAssigned = document.getElementById('filterAssigned');

async function applyLeadFilters() {
    const stage = filterStage?.value || '';
    const assigned = filterAssigned?.value || '';
    const q = globalSearchInput?.value.trim() || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (stage) params.set('stage', stage);
    if (assigned) params.set('assigned_to', assigned);
    const url = params.toString() ? `/api/leads/search?${params}` : `/api/leads?page=${window.currentPage || 1}&limit=20`;
    const results = await fetchData(url);
    if (results) renderLeads(results);
}

filterStage?.addEventListener('change', applyLeadFilters);
filterAssigned?.addEventListener('change', applyLeadFilters);

// --- TOAST NOTIFICATION ---
function showToast(message, type = 'success') {
    let toast = document.getElementById('crm-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'crm-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:white;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,0.2);z-index:9999;transition:opacity 0.3s ease;opacity:0;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = type === 'error' ? '#ef4444' : '#10b981';
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// --- AUTHENTICATION & ACCESS SYSTEM ---

window.submitUserLogin = async () => {
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value.trim();
    if (!email || !password) return alert('Please fill in both email and password.');

    const res = await fetchData('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });

    if (res && res.token) {
        localStorage.setItem('crm_token', res.token);
        localStorage.setItem('crm_member', JSON.stringify(res.member));
        document.getElementById('loginOverlay').style.display = 'none';
        applySidebarPermissions(res.member);
        showToast(`Welcome back, ${res.member.name}!`);

        // Load the view from the URL slug directly
        const currentPath = window.location.pathname.substring(1) || 'dashboard';
        navigateToView(currentPath, false);
    } else {
        alert('Invalid email or password.');
    }
};

window.logoutSession = () => {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_member');
    location.reload();
};

function applySidebarPermissions(member) {
    const isAdmin = member.role === 'admin';
    const permissions = member.permissions || [];

    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        const view = item.getAttribute('data-view');
        // Account view is always accessible
        if (view === 'account') {
            item.style.display = 'flex';
            return;
        }
        const hasAccess = isAdmin || permissions.includes(view);
        item.style.display = hasAccess ? 'flex' : 'none';
    });

    // Update avatar with user initials
    const userInitials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const profileAvatar = document.querySelector('.user-profile .avatar');
    if (profileAvatar) profileAvatar.textContent = userInitials;
}

// Check session on page load
function checkUserSession() {
    const token = localStorage.getItem('crm_token');
    const memberJson = localStorage.getItem('crm_member');
    const loginOverlay = document.getElementById('loginOverlay');

    if (!token || !memberJson) {
        if (loginOverlay) {
            loginOverlay.style.display = 'flex';
            setTimeout(() => { if (typeof feather !== 'undefined') feather.replace(); }, 50);
        }
    } else {
        if (loginOverlay) loginOverlay.style.display = 'none';
        const member = JSON.parse(memberJson);
        applySidebarPermissions(member);
        
        // Load the view from the URL slug directly
        const currentPath = window.location.pathname.substring(1) || 'dashboard';
        navigateToView(currentPath, false);
    }
}

// --- MY ACCOUNT DETAILS ---
async function loadMyAccountDetails() {
    const member = JSON.parse(localStorage.getItem('crm_member') || '{}');
    document.getElementById('myAccountName').textContent = member.name || '-';
    document.getElementById('myAccountEmail').textContent = member.email || '-';

    const roleBadge = document.getElementById('myAccountRole');
    if (roleBadge) {
        roleBadge.textContent = member.role === 'admin' ? 'Admin' : 'Employee';
        roleBadge.className = `team-role-badge ${member.role}`;
    }

    const scopesContainer = document.getElementById('myAccountScopes');
    if (scopesContainer) {
        if (member.role === 'admin') {
            scopesContainer.innerHTML = '<span class="team-role-badge admin">Full Admin Access (All Scopes)</span>';
        } else {
            scopesContainer.innerHTML = (member.permissions || []).map(p =>
                `<span class="team-role-badge employee" style="margin-right:4px;">${p}</span>`
            ).join('');
        }
    }

    // Set Sound Toggle checkbox state
    const soundToggle = document.getElementById('myAccountSoundToggle');
    if (soundToggle) {
        const settings = member.settings || { sound_enabled: true };
        soundToggle.checked = settings.sound_enabled !== false;
    }

    if (typeof feather !== 'undefined') {
        feather.replace();
    }
}

window.submitSoundToggle = async (enabled) => {
    const token = localStorage.getItem('crm_token');
    const member = JSON.parse(localStorage.getItem('crm_member') || '{}');
    const updatedSettings = { ...member.settings, sound_enabled: enabled };

    const res = await fetchData('/api/auth/settings', {
        method: 'POST',
        body: JSON.stringify({ token, settings: updatedSettings })
    });

    if (res && res.success) {
        member.settings = res.settings || updatedSettings;
        localStorage.setItem('crm_member', JSON.stringify(member));
        showToast(enabled ? 'Sound effects enabled!' : 'Sound effects disabled!');
    } else {
        alert('Failed to update sound settings.');
    }
};


window.submitPasswordChange = async () => {
    const pass = document.getElementById('newAccountPassword').value.trim();
    const confirmPass = document.getElementById('confirmAccountPassword').value.trim();
    if (!pass) return alert('Please enter a password.');
    if (pass !== confirmPass) return alert('Passwords do not match.');

    const token = localStorage.getItem('crm_token');
    const res = await fetchData('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: pass })
    });

    if (res && res.success) {
        document.getElementById('newAccountPassword').value = '';
        document.getElementById('confirmAccountPassword').value = '';
        showToast('Password changed successfully!');
    }
};

// --- TEAM PERMISSIONS MANAGEMENT ---

// Toggle Inline Form Form Permissions list
function getCheckedPermissions(selector) {
    const list = [];
    document.querySelectorAll(selector).forEach(box => {
        if (box.checked) list.push(box.value);
    });
    return list;
}

// Modify team submit payload
const originalSubmitNewTeamMember = window.submitNewTeamMember;
window.submitNewTeamMember = async () => {
    const name = document.getElementById('teamMemberName').value.trim();
    const email = document.getElementById('teamMemberEmail').value.trim();
    const role = document.getElementById('teamMemberRole').value;
    const permissions = getCheckedPermissions('.new-member-permission');

    if (!name || !email) return alert('Name and email are required.');

    const result = await fetchData('/api/team', {
        method: 'POST',
        body: JSON.stringify({ name, email, role, permissions })
    });

    if (result) {
        document.getElementById('teamMemberName').value = '';
        document.getElementById('teamMemberEmail').value = '';
        toggleAddTeamForm();
        loadTeam();
        showToast('Team member added & credentials emailed!');
    }
};

// --- BULK PERMISSIONS MANAGEMENT ---
window.openBulkPermissionModal = () => {
    const modal = document.getElementById('bulkPermissionModal');
    if (modal) modal.classList.add('active');
};

window.closeBulkPermissionModal = () => {
    const modal = document.getElementById('bulkPermissionModal');
    if (modal) modal.classList.remove('active');
};

let selectedBulkMemberIds = new Set();

window.toggleSelectBulkMember = (id, el) => {
    const card = el.closest('.team-member-card');
    const checked = el.checked;
    if (checked) {
        selectedBulkMemberIds.add(id);
        if (card) card.style.borderColor = '#6366f1';
    } else {
        selectedBulkMemberIds.delete(id);
        if (card) card.style.borderColor = 'var(--border-color)';
    }
    updateSelectedBulkCount();
};

window.toggleSelectAllEmployees = () => {
    const checkboxes = document.querySelectorAll('.card-select-checkbox');
    if (checkboxes.length === 0) return;

    // Check if all are already selected
    let allSelected = true;
    checkboxes.forEach(cb => {
        if (!cb.checked) allSelected = false;
    });

    checkboxes.forEach(cb => {
        cb.checked = !allSelected;
        // Trigger change event to sync set and UI borders
        cb.dispatchEvent(new Event('change'));
    });
};

function updateSelectedBulkCount() {
    const trigger = document.getElementById('bulkActionTrigger');
    const badge = document.getElementById('floating-bulk-badge');
    const count = selectedBulkMemberIds.size;

    if (trigger) {
        if (count > 0) {
            trigger.classList.add('active');
        } else {
            trigger.classList.remove('active');
        }
    }

    if (badge) {
        badge.textContent = count;
    }
}

window.submitBulkPermissions = async () => {
    if (selectedBulkMemberIds.size === 0) return alert('Please select at least one employee card.');
    const permissions = getCheckedPermissions('.bulk-member-permission');

    const res = await fetchData('/api/team/bulk-permissions', {
        method: 'POST',
        body: JSON.stringify({
            ids: Array.from(selectedBulkMemberIds),
            permissions
        })
    });

    if (res && res.success) {
        selectedBulkMemberIds.clear();
        updateSelectedBulkCount();
        closeBulkPermissionModal();
        loadTeam();
        showToast('Permissions updated in bulk successfully!');
    }
};

// Override render team list to display select control for bulk permission
const originalLoadTeam = window.loadTeam;
window.loadTeam = async () => {
    const team = await fetchData('/api/team');
    const grid = document.getElementById('team-members-grid');
    if (!grid) return;
    if (!team || team.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="text-align:center; padding:40px;">No team members yet.</div>';
        return;
    }
    grid.innerHTML = team.map(m => {
        const initials = m.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const colors = ['linear-gradient(135deg,#6366f1,#8b5cf6)', 'linear-gradient(135deg,#10b981,#34d399)', 'linear-gradient(135deg,#f59e0b,#fbbf24)', 'linear-gradient(135deg,#ef4444,#f87171)'];
        const color = colors[m.id % colors.length];
        const scopes = m.permissions ? m.permissions.join(', ') : 'None';
        const isSelected = selectedBulkMemberIds.has(m.id);
        const borderStyle = isSelected ? 'border-color: #6366f1;' : '';
        const checkedAttr = isSelected ? 'checked' : '';
        return `
            <div class="team-member-card" style="${borderStyle}">
                <div class="card-select-checkbox-wrapper">
                    <input type="checkbox" class="card-select-checkbox" ${checkedAttr} onchange="toggleSelectBulkMember(${m.id}, this)">
                </div>
                <button class="team-delete-btn" onclick="deleteTeamMember(${m.id})">
                    <i data-feather="trash-2" style="width:14px;height:14px;"></i>
                </button>
                <div class="team-member-avatar" style="background:${color};">${initials}</div>
                <div class="team-member-name">${m.name}</div>
                <div class="team-member-email">${m.email}</div>
                <span class="team-role-badge ${m.role}">${m.role === 'admin' ? 'Admin' : 'Employee'}</span>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:8px; text-align:center;">
                    <span style="font-weight:600; display:block;">Access Scopes:</span>
                    <span>${scopes}</span>
                </div>
            </div>
        `;
    }).join('');
    feather.replace();
    updateSelectedBulkCount();
};

// End of team module loading override


