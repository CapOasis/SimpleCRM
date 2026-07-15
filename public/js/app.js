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
    
    // --- UI Selectors ---
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const viewSections = document.querySelectorAll('.view-section');
    const createAutomationBtn = document.getElementById('createAutomationBtn');
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
    const waTemplateSelect = document.getElementById('waTemplate');
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
        const latest = await fetchData('/api/leads/latest');
        
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
        const tbody = document.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = leads.map(lead => `
                <tr>
                    <td>
                        <div class="table-user">
                            <div class="avatar">${lead.name[0]}</div>
                            <div>
                                ${lead.name}
                                <p>${lead.phone || 'No phone'}</p>
                            </div>
                        </div>
                    </td>
                    <td><span class="badge ${lead.source === 'Meta Ads' ? 'badge-meta' : 'badge-manual'}">${lead.source}</span></td>
                    <td>
                        <select class="status-select" onchange="updateLeadStatus(${lead.id}, this.value)">
                            ${currentStages.map(s => `
                                <option value="${s.name}" ${lead.status === s.name ? 'selected' : ''}>
                                    ${s.name.charAt(0).toUpperCase() + s.name.slice(1)}
                                </option>
                            `).join('')}
                        </select>
                    </td>
                    <td>Unassigned</td>
                    <td>${new Date(lead.created_at).toLocaleDateString()}</td>
                    <td><button class="btn btn-secondary btn-sm" onclick="openDrawer({name: '${lead.name}', email: '${lead.email}', phone: '${lead.phone}'})">View</button></td>
                </tr>
            `).join('');
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

    function renderAutomations(automations) {
        const grid = document.getElementById('automation-list-view');
        if (!grid) return;
        
        grid.innerHTML = '';
        
        if (!automations || automations.length === 0) {
            grid.innerHTML = '<div class="empty-state">No automations created yet. Click "Create Automation" to start.</div>';
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
                automationListView.style.display = 'grid';
                loadInitialData();
            }
        });
    }

    // Load everything on start
    loadInitialData();

    // --- Modal / Drawer Interactivity ---
    const overlay = document.getElementById('overlay');
    const leadDrawer = document.getElementById('leadDrawer');
    const addLeadModal = document.getElementById('addLeadModal');

    window.openDrawer = async (lead) => {
        document.getElementById('drawerLeadName').textContent = lead.name;
        document.getElementById('drawerEmail').textContent = lead.email || 'N/A';
        document.getElementById('drawerPhone').textContent = lead.phone || 'N/A';
        
        const sourceEl = document.getElementById('drawerSource');
        if (sourceEl) sourceEl.innerHTML = `<i data-feather="link"></i> ${lead.source || 'Unknown'}`;

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
                } else {
                    customDataSection.style.display = 'none';
                }
            } catch (e) {
                customDataSection.style.display = 'none';
            }
        } else {
            customDataSection.style.display = 'none';
        }
        
        // Fetch and Render Lead Timeline
        const logs = await fetchData(`/api/leads/${lead.id}/logs`);
        renderTimeline('leadTimeline', logs);

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
    }

    function updateStatCards(summary) {
        const updateCard = (id, data) => {
            const valEl = document.getElementById(`stat-${id}`);
            const trendEl = document.getElementById(`trend-${id}`);
            if (valEl) valEl.textContent = data.value.toLocaleString();
            
            if (trendEl) {
                const growth = data.growth;
                const isPositive = growth >= 0;
                trendEl.textContent = `${isPositive ? '+' : ''}${growth}%`;
                trendEl.className = `stat-trend ${isPositive ? 'plus' : 'minus'}`;
            }
        };

        updateCard('total-leads', summary.total);
        updateCard('active-deals', summary.active);
        updateCard('conversions', summary.conversions);
    }

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
                            backgroundColor: ['#3b4250', '#7a8292', '#b3bac6', '#d9dde5', '#eef2ff'],
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

        // Weekly Conversion Chart
        const ctxConv = document.getElementById('conversionChart');
        if (ctxConv) {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const labels = stats.weekly.map(w => days[w.day]);
            const data = stats.weekly.map(w => w.count);

            if (conversionChart) {
                conversionChart.data.labels = labels;
                conversionChart.data.datasets[0].data = data;
                conversionChart.update();
            } else {
                conversionChart = new Chart(ctxConv, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'New Leads',
                            data: data,
                            backgroundColor: '#3b4250',
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, grid: { display: false } },
                            x: { grid: { display: false } }
                        },
                        plugins: {
                            legend: { display: false }
                        }
                    }
                });
            }
        }
    }

    // --- Navigation & View Switching ---
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = item.getAttribute('data-view');
            
            // Update Navigation UI
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Hide all sections and show target
            viewSections.forEach(section => {
                section.classList.remove('active');
            });

            // Force close any active modals/drawers and hide overlay
            const overlay = document.getElementById('overlay');
            const leadDrawer = document.getElementById('leadDrawer');
            const addLeadModal = document.getElementById('addLeadModal');
            
            if (overlay) overlay.classList.remove('active');
            if (leadDrawer) leadDrawer.classList.remove('active');
            if (addLeadModal) addLeadModal.classList.remove('active');

            const activeSection = document.getElementById(targetView);
            if (activeSection) {
                activeSection.classList.add('active');
                
                // Reset Automations view to List mode
                if (targetView === 'automations') {
                    const listGrid = document.getElementById('automation-list-view');
                    const builderView = document.getElementById('automation-builder-view');
                    if (listGrid) listGrid.style.display = 'grid';
                    if (builderView) builderView.style.display = 'none';
                    const header = activeSection.querySelector('.section-header');
                    if (header) header.style.display = 'flex';
                }

                if (targetView === 'dashboard') {
                    setTimeout(() => {
                        if (typeof Chart !== 'undefined') initCharts();
                    }, 100);
                }

                if (targetView === 'dashboard') {
                    loadDashboardData();
                }

                if (targetView === 'flows') {
                    loadStages();
                }

                if (targetView === 'activity') {
                    loadActivityData();
                }
            }
        });
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
            automationListView.style.display = 'none';
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
            automationListView.style.display = 'grid';
            // Show parent section header again
            const sectionHeader = automationBuilderView.closest('.view-section').querySelector('.section-header');
            if (sectionHeader) sectionHeader.style.display = 'flex';
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
        updateProgress(3);
    }

    function updateWhatsAppPreview() {
        const templateKey = waTemplateSelect.value;
        previewBubble.textContent = templates[templateKey] || "Select a template...";
        // Mock WhatsApp styling
        document.querySelector('.mobile-screen').style.background = '#0b141a';
        previewBubble.className = 'chat-bubble left';
    }

    function updateEmailPreview() {
        const subject = emailSubjectInput.value || "No Subject";
        const body = emailBodyInput.value || "Email body content...";
        previewBubble.innerHTML = `<strong>Subject:</strong> ${subject}<br><br>${body}`;
        // Mock Email styling
        document.querySelector('.mobile-screen').style.background = '#fff';
        previewBubble.className = 'chat-bubble left email-style';
    }

    // Input Listeners for Preview
    if (waTemplateSelect) waTemplateSelect.addEventListener('change', updateWhatsAppPreview);
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
        step2.classList.add('disabled');
        step3.classList.add('disabled');
        stepSettings.style.display = 'none';
        previewArea.style.display = 'none';
        selectionCards.forEach(c => c.classList.remove('selected'));
        document.getElementById('automationName').value = '';
        updateProgress(1);
    }

    // Dashboard View Toggles (Sidebar)
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetView = item.getAttribute('data-view');
            if (targetView === 'dashboard') {
                setTimeout(() => {
                    if (typeof Chart !== 'undefined') initCharts();
                }, 100);
            }
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

        FB.getLoginStatus(function(response) {
            // Force a fresh login to ensure we get a fresh token with correct scopes
            FB.login(function(loginResponse) {
                if (loginResponse.authResponse) {
                    processMetaAuth(loginResponse.authResponse.accessToken, appId);
                } else {
                    console.log('User cancelled login or did not fully authorize.');
                }
            }, { 
                scope: 'pages_show_list,pages_read_engagement,pages_manage_ads,leads_retrieval',
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

    window.selectMetaPage = async (pageData) => {
        const result = await fetchData('/api/meta/save-page', {
            method: 'POST',
            body: JSON.stringify(pageData)
        });

        if (result && result.success) {
            alert(result.message);
            changeMetaStep(1); // Move to Step 4 (Webhooks)
        } else {
            alert("Failed to save selection: " + (result ? result.error : "Unknown error"));
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
    } catch (e) {}
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
