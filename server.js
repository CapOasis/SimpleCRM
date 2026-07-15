console.log('--- SimpleFunnel CRM: Starting Server ---');
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const automationEngine = require('./automationEngine');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- LEADS API ---

// Get paginated leads
app.get('/api/leads', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
        res.json(leads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get total leads count for pagination
app.get('/api/leads/count', (req, res) => {
    try {
        const result = db.prepare('SELECT COUNT(*) as total FROM leads').get();
        res.json({ total: result.total });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET unique keys from last 100 leads for schema discovery
app.get('/api/leads/schema', (req, res) => {
    try {
        const leads = db.prepare('SELECT custom_data FROM leads WHERE custom_data IS NOT NULL ORDER BY id DESC LIMIT 100').all();
        const keys = new Set();
        leads.forEach(l => {
            try {
                if (l.custom_data) {
                    const data = JSON.parse(l.custom_data);
                    Object.keys(data).forEach(k => keys.add(k));
                }
            } catch (e) {}
        });
        res.json({ keys: Array.from(keys) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET the latest raw lead for preview mapping
app.get('/api/leads/latest', (req, res) => {
    try {
        const lead = db.prepare(`
            SELECT * FROM leads 
            WHERE custom_data IS NOT NULL 
            AND LOWER(name) NOT LIKE '%test%' 
            AND LOWER(email) NOT LIKE '%meta.com%'
            ORDER BY id DESC LIMIT 1
        `).get();
        if (lead && lead.custom_data) {
            res.json({
                ...lead,
                raw: JSON.parse(lead.custom_data)
            });
        } else {
            res.status(404).json({ error: 'No data available for preview. Please sync some leads first.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add new lead
app.post('/api/leads', (req, res) => {
    const { name, email, phone, source } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    try {
        const stmt = db.prepare('INSERT INTO leads (name, email, phone, source) VALUES (?, ?, ?, ?)');
        const result = stmt.run(name, email || null, phone || null, source || 'Manual');
        
        // Return the newly created lead
        const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
        
        // Trigger Automations (Simulation)
        triggerAutomations('new_lead', newLead);
        
        res.status(201).json(newLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update lead status (Kanban move)
app.patch('/api/leads/:id', (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    try {
        const stmt = db.prepare('UPDATE leads SET status = ? WHERE id = ?');
        const result = stmt.run(status, id);
        
        if (result.changes === 0) return res.status(404).json({ error: 'Lead not found' });
        
        const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        
        // Trigger Automations (Simulation)
        triggerAutomations('status_change', updatedLead);
        
        res.json(updatedLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete all leads (for testing/reset)
app.delete('/api/leads', (req, res) => {
    try {
        db.prepare('DELETE FROM logs').run(); // Clear logs first (child)
        db.prepare('DELETE FROM leads').run(); // Clear leads second (parent)
        res.json({ success: true, message: 'All leads cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- FLOWS (STAGES) API ---

app.get('/api/stages', (req, res) => {
    try {
        const stages = db.prepare('SELECT * FROM stages ORDER BY order_index ASC').all();
        res.json(stages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stages', (req, res) => {
    const { name, color } = req.body;
    try {
        // Insert before the last stage (closed)
        const lastStage = db.prepare('SELECT order_index FROM stages ORDER BY order_index DESC LIMIT 1').get();
        const newOrder = lastStage ? lastStage.order_index : 0;
        // Bump 'closed' up by 1
        db.prepare('UPDATE stages SET order_index = order_index + 1 WHERE order_index >= ?').run(newOrder);
        const stmt = db.prepare('INSERT INTO stages (name, color, order_index) VALUES (?, ?, ?)');
        stmt.run(name, color || '#3b82f6', newOrder);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch reorder stages
app.put('/api/stages/reorder', (req, res) => {
    const { order } = req.body; // array of { id, order_index }
    try {
        const stmt = db.prepare('UPDATE stages SET order_index = ? WHERE id = ?');
        const tx = db.transaction((items) => {
            items.forEach(item => stmt.run(item.order_index, item.id));
        });
        tx(order);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/stages/:id', (req, res) => {
    const { name, color, order_index } = req.body;
    try {
        db.prepare('UPDATE stages SET name = ?, color = ?, order_index = ? WHERE id = ?')
          .run(name, color, order_index, req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/stages/:id', (req, res) => {
    try {
        const stage = db.prepare('SELECT name FROM stages WHERE id = ?').get(req.params.id);
        if (!stage) return res.status(404).json({ error: 'Stage not found' });
        
        // Protect system stages
        if (stage.name === 'new' || stage.name === 'closed') {
            return res.status(400).json({ error: 'Cannot delete system stages (New / Closed).' });
        }
        
        // Find first stage to reassign leads
        const firstStage = db.prepare('SELECT name FROM stages WHERE id != ? ORDER BY order_index ASC LIMIT 1').get(req.params.id);
        if (firstStage) {
            db.prepare('UPDATE leads SET status = ? WHERE status = ?').run(firstStage.name, stage.name);
        }
        db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- AUTOMATIONS API ---

app.get('/api/automations', (req, res) => {
    try {
        const automations = db.prepare('SELECT * FROM automations').all();
        res.json(automations.map(a => ({ ...a, settings: JSON.parse(a.settings) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/automations', (req, res) => {
    const { name, trigger, action, settings } = req.body;
    try {
        const stmt = db.prepare('INSERT INTO automations (name, trigger, action, settings, active) VALUES (?, ?, ?, ?, 1)');
        stmt.run(name, trigger, action, JSON.stringify(settings));
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/automations/:id', (req, res) => {
    const { id } = req.params;
    const { active } = req.body;
    try {
        db.prepare('UPDATE automations SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/automations/:id', (req, res) => {
    const { id } = req.params;
    try {
        // First delete logs associated with this automation to avoid FK constraint issues
        db.prepare('DELETE FROM logs WHERE automation_id = ?').run(id);
        // Then delete the automation itself
        db.prepare('DELETE FROM automations WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WEBHOOKS (META SIMULATION) ---

app.post('/api/webhooks/meta', (req, res) => {
    const { name, email, phone } = req.body; // Mock payload from Meta
    console.log('Incoming Meta Lead:', { name, email, phone });
    
    try {
        const stmt = db.prepare('INSERT INTO leads (name, email, phone, source) VALUES (?, ?, ?, ?)');
        const result = stmt.run(name, email, phone, 'Meta Ads');
        const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
        
        triggerAutomations('new_lead', newLead);
        
        res.json({ success: true, lead_id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LOGS API ---

// Get all logs (Global Activity)
app.get('/api/logs', (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT l.*, le.name as lead_name, a.name as automation_name 
            FROM logs l 
            LEFT JOIN leads le ON l.lead_id = le.id 
            LEFT JOIN automations a ON l.automation_id = a.id 
            ORDER BY l.timestamp DESC 
            LIMIT 50
        `).all();
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get logs for a specific lead
app.get('/api/leads/:id/logs', (req, res) => {
    try {
        const logs = db.prepare('SELECT * FROM logs WHERE lead_id = ? ORDER BY timestamp DESC').all(req.params.id);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DASHBOARD ANALYTICS ---

app.get('/api/stats/dashboard', (req, res) => {
    const range = req.query.range || '7d';
    
    let days = 7;
    if (range === '30d') days = 30;
    if (range === '90d') days = 90;

    const currentPeriodStart = `date('now', '-${days} days')`;
    const prevPeriodStart = `date('now', '-${days * 2} days')`;
    const prevPeriodEnd = `date('now', '-${days} days')`;

    try {
        const stages = db.prepare('SELECT name FROM stages ORDER BY order_index DESC').all();
        const lastStage = stages[0]?.name || 'closed';

        // 1. Current Stats
        const summary = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status != ? THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as conversions
            FROM leads 
            WHERE created_at >= ${currentPeriodStart}
        `).get(lastStage, lastStage);

        // 2. Previous Stats (for Growth calculation)
        const prevSummary = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status != ? THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as conversions
            FROM leads 
            WHERE created_at >= ${prevPeriodStart} AND created_at < ${prevPeriodEnd}
        `).get(lastStage, lastStage);

        // Calculate Growth %
        const calcGrowth = (curr, prev) => {
            if (!prev || prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        const stats = {
            summary: {
                total: { value: summary.total || 0, growth: calcGrowth(summary.total, prevSummary.total) },
                active: { value: summary.active || 0, growth: calcGrowth(summary.active, prevSummary.active) },
                conversions: { value: summary.conversions || 0, growth: calcGrowth(summary.conversions, prevSummary.conversions) }
            },
            sources: db.prepare(`
                SELECT source as name, COUNT(*) as value 
                FROM leads 
                WHERE created_at >= ${currentPeriodStart}
                GROUP BY source
            `).all(),
            weekly: db.prepare(`
                SELECT strftime('%w', created_at) as day, COUNT(*) as count
                FROM leads 
                WHERE created_at >= ${currentPeriodStart}
                GROUP BY day
                ORDER BY day ASC
            `).all()
        };

        res.json(stats);
    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS API ---

app.get('/api/settings', (req, res) => {
    try {
        const settings = db.prepare('SELECT * FROM settings').all();
        const config = {};
        settings.forEach(s => config[s.key] = s.value);
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', (req, res) => {
    const settings = req.body; // Expecting { key1: val1, key2: val2 }
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        const transaction = db.transaction((data) => {
            for (const [key, value] of Object.entries(data)) {
                stmt.run(key, value);
            }
        });
        transaction(settings);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trigger retroactive re-mapping for all leads
app.post('/api/leads/remap', (req, res) => {
    try {
        // 1. Get current mappings
        const settings = db.prepare('SELECT * FROM settings').all();
        const config = {};
        settings.forEach(s => config[s.key] = s.value);

        const mapName = config['mapping_name'] || 'name';
        const mapEmail = config['mapping_email'] || 'email';
        const mapPhone = config['mapping_phone'] || 'phone';

        // 2. Fetch all leads with custom_data
        const leads = db.prepare('SELECT id, custom_data FROM leads WHERE custom_data IS NOT NULL').all();

        // 3. Update each lead based on original raw data
        const updateStmt = db.prepare('UPDATE leads SET name = ?, email = ?, phone = ? WHERE id = ?');
        const transaction = db.transaction((leadsList) => {
            for (const lead of leadsList) {
                try {
                    const data = JSON.parse(lead.custom_data);
                    
                    // Case-insensitive lookup helper
                    const lookup = (key) => {
                        if (!key) return null;
                        const lowerKey = key.toLowerCase();
                        const actualKey = Object.keys(data).find(k => k.toLowerCase() === lowerKey);
                        return actualKey ? data[actualKey] : null;
                    };

                    const newName = lookup(mapName) || 'Unknown';
                    const newEmail = lookup(mapEmail);
                    const newPhone = lookup(mapPhone);

                    updateStmt.run(newName, newEmail, newPhone, lead.id);
                } catch (e) {}
            }
        });
        transaction(leads);

        res.json({ success: true, count: leads.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- META AUTHENTICATION ---

// --- META AUTHENTICATION ---

app.post('/api/meta/pages', async (req, res) => {
    const { userToken, appId } = req.body;
    
    try {
        // 1. Get the list of pages managed by the user
        const url = `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`;
        console.log(`Fetching Page accounts for token...`);
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            console.error('Meta API Error Details:', data);
            throw new Error(data.error?.message || 'Failed to fetch Facebook accounts');
        }

        if (!data.data || data.data.length === 0) {
            console.error('No Pages found.');
            return res.status(400).json({ error: 'No Facebook Pages found. Make sure you select at least one Page in the login window.' });
        }

        // Return the list of pages to the frontend for selection
        res.json({ 
            success: true, 
            pages: data.data.map(p => ({
                id: p.id,
                name: p.name,
                access_token: p.access_token,
                category: p.category
            }))
        });
    } catch (err) {
        console.error('Meta Fetch Pages Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/meta/save-page', (req, res) => {
    const { appId, pageId, pageToken, pageName } = req.body;
    
    try {
        if (!appId || !pageId || !pageToken || !pageName) {
            return res.status(400).json({ error: 'Missing required page selection data.' });
        }

        // Store the AppID, PageID and Page Token in the settings table
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('meta_app_id', appId);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('meta_page_id', pageId);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('meta_page_token', pageToken);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('meta_page_name', pageName);

        res.json({ 
            success: true, 
            message: `Connected to ${pageName} successfully!`
        });
    } catch (err) {
        console.error('Meta Save Page Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- GATEWAY TESTING ---
app.post('/api/test-gateways', async (req, res) => {
    const { type, recipient } = req.body;
    
    try {
        if (type === 'email') {
            const config = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").all();
            const settings = {};
            config.forEach(c => settings[c.key] = c.value);

            if (!settings.smtp_user) throw new Error('SMTP not configured in database.');
            
            const targetTo = recipient || settings.smtp_user; // Fallback to config email if no recipient provided
            
            const success = await automationEngine.sendEmail(
                targetTo, 
                'Test Connection', 
                'SimpleFunnel CRM Gateway Test: Your SMTP connection is working perfectly!', 
                null, 
                null
            );
            if (!success) throw new Error('SMTP Test failed. Check credentials/port.');
            res.json({ success: true, message: 'Test email sent to ' + targetTo });
        } 
        else if (type === 'whatsapp') {
            const config = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'twilio_%'").all();
            const settings = {};
            config.forEach(c => settings[c.key] = c.value);

            if (!settings.twilio_phone) throw new Error('Twilio phone not configured.');
            
            // Allow phone with or without whatsapp: prefix for tests
            const targetTo = recipient || settings.twilio_phone.replace('whatsapp:', '');

            const success = await automationEngine.sendWhatsApp(
                targetTo, 
                'SimpleFunnel CRM: Your WhatsApp Gateway is now live! 🔥', 
                null, 
                null
            );
            if (!success) throw new Error('WhatsApp Test failed. Check Twilio logs.');
            res.json({ success: true, message: 'Test WhatsApp sent to ' + targetTo });
        }
    } catch (err) {
        console.error('Test Gateway Error:', err.message);
        res.status(400).json({ success: false, message: err.message });
    }
});

// --- FIELD MAPPING HELPER ---
function processMappedPayload(payload) {
    const rawData = { ...payload };
    
    // Create a lower-case lookup map of all incoming keys
    const lowerKeys = {};
    Object.keys(rawData).forEach(k => {
        lowerKeys[k.toLowerCase()] = k;
    });

    // Fetch user mappings
    const mappingSettings = db.prepare("SELECT key, value FROM settings WHERE key IN ('mapping_name', 'mapping_email', 'mapping_phone')").all();
    const mapping = { name: 'name', email: 'email', phone: 'phone' };
    
    mappingSettings.forEach(s => {
        if (s.key === 'mapping_name' && s.value) mapping.name = s.value.toLowerCase();
        if (s.key === 'mapping_email' && s.value) mapping.email = s.value.toLowerCase();
        if (s.key === 'mapping_phone' && s.value) mapping.phone = s.value.toLowerCase();
    });

    // Helper to find key in payload regardless of case
    const getVal = (mapKey) => {
        const actualKey = lowerKeys[mapKey];
        return actualKey ? rawData[actualKey] : null;
    };

    // Try to find a source timestamp
    const sourceTime = getVal('created_time') || getVal('timestamp') || rawData.created_time || rawData.timestamp || null;

    const lead = {
        name: getVal(mapping.name) || rawData.name || 'Unknown Lead',
        email: getVal(mapping.email) || rawData.email || null,
        phone: getVal(mapping.phone) || rawData.phone || null,
        source: rawData.source || null,
        created_at: sourceTime,
        custom_data: JSON.stringify(rawData)
    };
    return lead;
}

// --- GENERIC WEBHOOK ---

app.get('/api/webhooks/generic', (req, res) => {
    res.send('Generic Webhook Endpoint is Live. Please use POST to send lead data.');
});

app.post('/api/webhooks/generic', (req, res) => {
    console.log('Incoming Generic Webhook:', req.body);
    
    const leadData = processMappedPayload(req.body);
    leadData.source = leadData.source || 'Generic Webhook';

    try {
        const stmt = db.prepare('INSERT INTO leads (name, email, phone, source, created_at, custom_data) VALUES (?, ?, ?, ?, ?, ?)');
        const result = stmt.run(leadData.name, leadData.email, leadData.phone, leadData.source, leadData.created_at || new Date().toISOString(), leadData.custom_data);
        const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
        
        triggerAutomations('new_lead', newLead);
        
        res.json({ success: true, lead_id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEAD IMPORT (CSV) ---

app.post('/api/leads/import', (req, res) => {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: 'No lead data provided' });

    let importedCount = 0;

    try {
        const insertStmt = db.prepare('INSERT INTO leads (name, email, phone, source, custom_data) VALUES (?, ?, ?, ?, ?)');
        const selectStmt = db.prepare('SELECT * FROM leads WHERE id = ?');

        // Use a transaction for performance and data integrity
        const transaction = db.transaction((leadList) => {
            leadList.forEach(rawLead => {
                const leadData = processMappedPayload(rawLead);
                leadData.source = leadData.source || rawLead.source || 'Bulk Import';
                
                const result = insertStmt.run(leadData.name, leadData.email, leadData.phone, leadData.source, leadData.custom_data);
                const newLead = selectStmt.get(result.lastInsertRowid);
                triggerAutomations('new_lead', newLead);
                importedCount++;
            });
        });

        transaction(leads);
        res.json({ success: true, count: importedCount });
    } catch (err) {
        console.error('Import Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- AUTOMATION ENGINE ---

function triggerAutomations(triggerType, lead) {
    // Force active to be treated as integer 1
    const autos = db.prepare('SELECT * FROM automations WHERE trigger = ? AND CAST(active AS INTEGER) = 1').all(triggerType);
    
    autos.forEach(async (auto) => {
        const settings = JSON.parse(auto.settings);
        const logMsg = `[Automation: ${auto.name}] Initialized for ${lead.name}.`;
        console.log(logMsg);
        
        // Log initialization to DB
        db.prepare('INSERT INTO logs (lead_id, automation_id, message) VALUES (?, ?, ?)').run(lead.id, auto.id, logMsg);

        // Execute Real Communication
        if (auto.action === 'send_email') {
            await automationEngine.sendEmail(lead.email, settings.subject, settings.body, lead.id, auto.id);
        } else if (auto.action === 'send_whatsapp') {
            await automationEngine.sendWhatsApp(lead.phone, settings.body || "Hello!", lead.id, auto.id);
        }
    });
}

// --- META WEBHOOK ---

// Verification Handler (Handshake)
app.get('/api/webhooks/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const MY_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'simple_funnel_token';

    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
        console.log('Meta Webhook Verified!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Data Handler (Lead Ingestion)
app.post('/api/webhooks/meta', async (req, res) => {
    console.log('Incoming Meta Webhook Payload:', JSON.stringify(req.body, null, 2));

    try {
        const entry = req.body.entry;
        if (!entry || entry.length === 0) return res.sendStatus(200);

        const change = entry[0].changes ? entry[0].changes[0] : null;
        if (!change || change.field !== 'leadgen') return res.sendStatus(200);

        const leadgenId = change.value.leadgen_id;
        console.log(`New Meta Lead Detected: ${leadgenId}`);

        // Fetch actual lead details from Meta Graph API
        const leadData = await fetchMetaLeadDetails(leadgenId);
        
        if (leadData) {
            // Bulletproof Filter: Ignore Meta Test Leads & Dummy Data
            const lowerName = (leadData.name || '').toLowerCase();
            const lowerEmail = (leadData.email || '').toLowerCase();
            if (lowerName.includes('test lead') || lowerName.includes('dummy data') || lowerEmail.includes('test@meta.com')) {
                console.log(`Skipping Meta Test Lead: ${leadData.name}`);
                return res.json({ success: true, message: 'Test lead ignored' });
            }

            const stmt = db.prepare('INSERT INTO leads (name, email, phone, source, created_at, custom_data) VALUES (?, ?, ?, ?, ?, ?)');
            const createdAt = leadData.created_time || new Date().toISOString();
            const result = stmt.run(leadData.name, leadData.email || null, leadData.phone || null, 'Meta Ads', createdAt, JSON.stringify(leadData));
            const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
            
            triggerAutomations('new_lead', newLead);
            console.log(`Successfully ingested Meta Lead: ${leadData.name}`);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Meta Ingestion Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Helper to fetch lead details from Meta Graph API
 */
async function fetchMetaLeadDetails(leadId) {
    // Check Database for token first
    let accessToken = db.prepare('SELECT value FROM settings WHERE key = ?').get('meta_page_token')?.value;

    // Fallback to .env
    if (!accessToken) {
        accessToken = process.env.META_PAGE_ACCESS_TOKEN;
    }

    if (!accessToken || accessToken === 'your_page_access_token_here') {
        console.warn('Meta Access Token not configured (DB or .env). Mocking lead data.');
        return { name: `Meta Lead ${leadId}`, email: 'mock@meta.com', phone: '+123456789' };
    }

    const url = `https://graph.facebook.com/v19.0/${leadId}?fields=id,name,email,phone,created_time,form_id,ad_id&access_token=${accessToken}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Meta API error: ${response.statusText}`);
        const data = await response.json();
        
        // Meta returns fields in an array called 'field_data'
        const fields = {};
        if (data.field_data) {
            data.field_data.forEach(item => {
                fields[item.name] = item.values[0];
            });
        }

        return {
            name: fields.full_name || fields.first_name + ' ' + fields.last_name || 'Meta Lead',
            email: fields.email,
            phone: fields.phone_number
        };
    } catch (err) {
        console.error('Graph API Fetch Failed:', err);
        return null;
    }
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    
    // --- SELF-HEALING: Clean up any board-prefixed statuses ---
    try {
        const result = db.prepare("UPDATE leads SET status = REPLACE(status, 'board-', '') WHERE status LIKE 'board-%'").run();
        if (result.changes > 0) {
            console.log(`Self-healing: Cleaned up ${result.changes} corrupted lead statuses.`);
        }
    } catch (err) {
        console.error('Self-healing failed:', err);
    }
});
