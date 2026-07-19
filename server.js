console.log('--- SimpleFunnel CRM: Starting Supabase Server ---');
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // Supabase client instance
const automationEngine = require('./automationEngine');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- LEADS API ---

// Get paginated leads
app.get('/api/leads', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
        const { data: settingsData } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = ['SaladO'];
        if (settingsData && settingsData.value) {
            try { pipelines = JSON.parse(settingsData.value); } catch (e) {}
        }
        const firstPipeline = pipelines[0] || 'SaladO';
        const pipeline = req.query.pipeline || firstPipeline;

        // Fetch stages for this pipeline
        const { data: stagesData } = await db.from('stages').select('name');
        const stageNames = (stagesData || []).map(s => s.name).filter(name => {
            if (pipeline === firstPipeline) {
                return !name.includes(':') || name.startsWith(`${firstPipeline}:`);
            } else {
                return name.startsWith(`${pipeline}:`);
            }
        });

        let query = db.from('leads').select('*').order('created_at', { ascending: false });
        if (stageNames.length > 0) {
            query = query.in('status', stageNames);
        } else {
            return res.json([]);
        }

        const { data, error } = await query.range(from, to);
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get total leads count for pagination
app.get('/api/leads/count', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = ['SaladO'];
        if (settingsData && settingsData.value) {
            try { pipelines = JSON.parse(settingsData.value); } catch (e) {}
        }
        const firstPipeline = pipelines[0] || 'SaladO';
        const pipeline = req.query.pipeline || firstPipeline;

        const { data: stagesData } = await db.from('stages').select('name');
        const stageNames = (stagesData || []).map(s => s.name).filter(name => {
            if (pipeline === firstPipeline) {
                return !name.includes(':') || name.startsWith(`${firstPipeline}:`);
            } else {
                return name.startsWith(`${pipeline}:`);
            }
        });

        let query = db.from('leads').select('*', { count: 'exact', head: true });
        if (stageNames.length > 0) {
            query = query.in('status', stageNames);
        } else {
            return res.json({ total: 0 });
        }

        const { count, error } = await query;
        if (error) throw error;
        res.json({ total: count || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET unique keys from last 100 leads for schema discovery
app.get('/api/leads/schema', async (req, res) => {
    try {
        const { data, error } = await db
            .from('leads')
            .select('custom_data')
            .order('id', { ascending: false })
            .limit(100);

        if (error) throw error;

        const keys = new Set();
        (data || []).forEach(l => {
            try {
                if (l.custom_data) {
                    const parsed = typeof l.custom_data === 'string' ? JSON.parse(l.custom_data) : l.custom_data;
                    Object.keys(parsed).forEach(k => keys.add(k));
                }
            } catch (e) {}
        });
        res.json({ keys: Array.from(keys) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET the latest raw lead for preview mapping
app.get('/api/leads/latest', async (req, res) => {
    try {
        const { data, error } = await db
            .from('leads')
            .select('*')
            .not('custom_data', 'is', null)
            .order('id', { ascending: false })
            .limit(1);

        if (error) throw error;

        const lead = data && data[0];
        if (lead) {
            const raw = typeof lead.custom_data === 'string' ? JSON.parse(lead.custom_data) : lead.custom_data;
            res.json({
                ...lead,
                raw
            });
        } else {
            res.status(404).json({ error: 'No data available for preview. Please sync some leads first.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add new lead
app.post('/api/leads', async (req, res) => {
    const { name, email, phone, source, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    try {
        const finalStatus = status || 'new';
        const { data, error } = await db
            .from('leads')
            .insert([{ name, email: email || null, phone: phone || null, source: source || 'Manual', status: finalStatus }])
            .select();

        if (error) throw error;
        const newLead = data && data[0];

        // Trigger Automations (Simulation)
        if (newLead) triggerAutomations('new_lead', newLead);
        
        res.status(201).json(newLead);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update lead (full field update)
app.patch('/api/leads/:id', async (req, res) => {
    const { id } = req.params;
    const { status, name, email, phone, company, assigned_to, value, source } = req.body;

    try {
        // Fetch current lead details
        const { data: leadData, error: fetchErr } = await db
            .from('leads')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !leadData) return res.status(404).json({ error: 'Lead not found' });

        const updatePayload = {
            status: status !== undefined ? status : leadData.status,
            name: name !== undefined ? name : leadData.name,
            email: email !== undefined ? email : leadData.email,
            phone: phone !== undefined ? phone : leadData.phone,
            company: company !== undefined ? company : leadData.company,
            assigned_to: assigned_to !== undefined ? assigned_to : leadData.assigned_to,
            value: value !== undefined ? value : leadData.value,
            source: source !== undefined ? source : leadData.source
        };

        const { data: updatedData, error: updateErr } = await db
            .from('leads')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        if (status !== undefined && status !== leadData.status) {
            triggerAutomations('status_change', updatedData);
            // Log update
            await db.from('logs').insert([{ lead_id: id, message: `Stage changed from "${leadData.status}" to "${status}"`, type: 'status_change' }]);
        }
        res.json(updatedData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete all leads (for testing/reset)
app.delete('/api/leads', async (req, res) => {
    try {
        // Supposing cascade deletion is configured in foreign keys
        const { error: logsError } = await db.from('logs').delete().neq('id', 0);
        if (logsError) throw logsError;

        const { error: leadsError } = await db.from('leads').delete().neq('id', 0);
        if (leadsError) throw leadsError;

        res.json({ success: true, message: 'All leads cleared' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- FLOWS (STAGES) API ---

app.get('/api/stages', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = ['SaladO'];
        if (settingsData && settingsData.value) {
            try { pipelines = JSON.parse(settingsData.value); } catch (e) {}
        }
        const firstPipeline = pipelines[0] || 'SaladO';
        const pipeline = req.query.pipeline || firstPipeline;

        const { data, error } = await db
            .from('stages')
            .select('*')
            .order('order_index', { ascending: true });

        if (error) throw error;

        // Filter stages belonging to the requested pipeline
        const filtered = (data || []).filter(stage => {
            if (pipeline === firstPipeline) {
                const hasPrefixed = (data || []).some(s => s.name.startsWith(`${firstPipeline}:`));
                if (hasPrefixed) {
                    return stage.name.startsWith(`${firstPipeline}:`);
                }
                return !stage.name.includes(':');
            } else {
                return stage.name.startsWith(`${pipeline}:`);
            }
        });

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stages', async (req, res) => {
    const { name, color } = req.body;
    try {
        // Fetch last order_index
        const { data, error: selectErr } = await db
            .from('stages')
            .select('order_index')
            .order('order_index', { ascending: false })
            .limit(1);

        if (selectErr) throw selectErr;

        const lastStage = data && data[0];
        const newOrder = lastStage ? lastStage.order_index : 0;

        // Shift existing stages up
        await db.rpc('increment_order_indexes', { target_index: newOrder });

        const { error: insertErr } = await db
            .from('stages')
            .insert([{ name, color: color || '#3b82f6', order_index: newOrder }]);

        if (insertErr) throw insertErr;

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch reorder stages
app.put('/api/stages/reorder', async (req, res) => {
    const { order } = req.body; // array of { id, order_index }
    try {
        for (const item of order) {
            await db.from('stages').update({ order_index: item.order_index }).eq('id', item.id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/stages/:id', async (req, res) => {
    const { name, color, order_index } = req.body;
    try {
        const { error } = await db
            .from('stages')
            .update({ name, color, order_index })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/stages/:id', async (req, res) => {
    try {
        const { data: stage, error: fetchErr } = await db
            .from('stages')
            .select('name')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !stage) return res.status(404).json({ error: 'Stage not found' });

        if (stage.name === 'new' || stage.name === 'closed') {
            return res.status(400).json({ error: 'Cannot delete system stages (New / Closed).' });
        }

        const { data: firstStage } = await db
            .from('stages')
            .select('name')
            .neq('id', req.params.id)
            .order('order_index', { ascending: true })
            .limit(1);

        if (firstStage && firstStage[0]) {
            await db.from('leads').update({ status: firstStage[0].name }).eq('status', stage.name);
        }

        const { error: deleteErr } = await db.from('stages').delete().eq('id', req.params.id);
        if (deleteErr) throw deleteErr;

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- AUTOMATIONS API ---

app.get('/api/automations', async (req, res) => {
    try {
        const { data, error } = await db.from('automations').select('*');
        if (error) throw error;
        res.json((data || []).map(a => ({ 
            ...a, 
            settings: typeof a.settings === 'string' ? JSON.parse(a.settings) : a.settings 
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/automations', async (req, res) => {
    const { name, trigger, action, settings } = req.body;
    try {
        const { error } = await db
            .from('automations')
            .insert([{ name, trigger, action, settings, active: true }]);

        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/automations/:id', async (req, res) => {
    const { id } = req.params;
    const { active } = req.body;
    try {
        const { error } = await db
            .from('automations')
            .update({ active: !!active })
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/automations/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.from('logs').delete().eq('automation_id', id);
        const { error } = await db.from('automations').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- WORKFLOWS API ---

// Get all workflows
app.get('/api/workflows', async (req, res) => {
    try {
        const { data, error } = await db.from('workflows').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json((data || []).map(w => ({
            ...w,
            steps: typeof w.steps === 'string' ? JSON.parse(w.steps) : (w.steps || [])
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a workflow
app.post('/api/workflows', async (req, res) => {
    const { name, trigger, steps } = req.body;
    try {
        const { data, error } = await db
            .from('workflows')
            .insert([{ name, trigger: trigger || 'any', steps: steps || [], active: true }])
            .select();
        if (error) throw error;
        res.status(201).json({ success: true, workflow: data[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a workflow (toggle active, update steps)
app.patch('/api/workflows/:id', async (req, res) => {
    const { id } = req.params;
    const updates = {};
    if (req.body.active !== undefined) updates.active = !!req.body.active;
    if (req.body.steps !== undefined) updates.steps = req.body.steps;
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.trigger !== undefined) updates.trigger = req.body.trigger;
    try {
        const { error } = await db.from('workflows').update(updates).eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a workflow
app.delete('/api/workflows/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.from('workflow_logs').delete().eq('workflow_id', id);
        const { error } = await db.from('workflows').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get workflow logs
app.get('/api/workflow-logs', async (req, res) => {
    try {
        const { data, error } = await db
            .from('workflow_logs')
            .select(`*, workflows!left(name), leads!left(name)`)
            .order('timestamp', { ascending: false })
            .limit(100);
        if (error) throw error;
        const formatted = (data || []).map(l => ({
            ...l,
            workflow_name: l.workflows ? l.workflows.name : null,
            lead_name: l.leads ? l.leads.name : null
        }));
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LOGS API ---

// Get all logs (Global Activity)
app.get('/api/logs', async (req, res) => {
    try {
        const { data, error } = await db
            .from('logs')
            .select(`
                *,
                leads!left (name),
                automations!left (name)
            `)
            .order('timestamp', { ascending: false })
            .limit(50);

        if (error) throw error;

        // Format to match old SQLite LEFT JOIN naming
        const formatted = (data || []).map(log => ({
            ...log,
            lead_name: log.leads ? log.leads.name : null,
            automation_name: log.automations ? log.automations.name : null
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get logs for a specific lead
app.get('/api/leads/:id/logs', async (req, res) => {
    try {
        const { data, error } = await db
            .from('logs')
            .select('*')
            .eq('lead_id', req.params.id)
            .order('timestamp', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DASHBOARD ANALYTICS ---

app.get('/api/stats/dashboard', async (req, res) => {
    const range = req.query.range || '7d';
    let days = 7;
    if (range === '30d') days = 30;
    if (range === '90d') days = 90;

    const todayStr = new Date().toISOString().split('T')[0];
    const rangeAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const prevRangeAgo = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();

    try {
        const { data: stages, error: stagesErr } = await db
            .from('stages')
            .select('name, color')
            .order('order_index', { ascending: true });

        if (stagesErr) throw stagesErr;

        const lastStage = stages[stages.length - 1]?.name || 'closed';

        // 1. Current Stats
        const { data: currLeads, error: currErr } = await db
            .from('leads')
            .select('*')
            .gte('created_at', rangeAgo);

        if (currErr) throw currErr;

        // 2. Previous Period Stats
        const { data: prevLeads, error: prevErr } = await db
            .from('leads')
            .select('*')
            .gte('created_at', prevRangeAgo)
            .lt('created_at', rangeAgo);

        if (prevErr) throw prevErr;

        const calcGrowth = (curr, prev) => {
            if (!prev || prev === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 100);
        };

        const totalCurr = currLeads.length;
        const activeCurr = currLeads.filter(l => l.status !== lastStage).length;
        const convCurr = currLeads.filter(l => l.status === lastStage).length;
        const valCurr = currLeads.reduce((acc, l) => acc + (parseFloat(l.value) || 0), 0);

        const totalPrev = prevLeads.length;
        const activePrev = prevLeads.filter(l => l.status !== lastStage).length;
        const convPrev = prevLeads.filter(l => l.status === lastStage).length;

        // 3. Pipeline Funnel
        const funnelData = [];
        for (const s of stages) {
            const { count } = await db
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('status', s.name);
            funnelData.push({ stage: s.name, color: s.color, count: count || 0 });
        }

        // 4. Daily trend
        const { data: trendQuery } = await db
            .from('leads')
            .select('created_at')
            .gte('created_at', rangeAgo);

        const trendMap = {};
        (trendQuery || []).forEach(l => {
            const d = l.created_at.split('T')[0];
            trendMap[d] = (trendMap[d] || 0) + 1;
        });
        const trendData = Object.keys(trendMap).map(k => ({ date: k, count: trendMap[k] })).sort((a,b) => a.date.localeCompare(b.date));

        // 5. Tasks summary
        const { count: overdueCount } = await db.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'open').lt('due_date', todayStr);
        const { count: dueTodayCount } = await db.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'open').eq('due_date', todayStr);
        const { count: openCount } = await db.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'open');

        // 6. Source stats
        const sourceMap = {};
        currLeads.forEach(l => {
            const src = l.source || 'Manual';
            sourceMap[src] = (sourceMap[src] || 0) + 1;
        });
        const sourcesData = Object.keys(sourceMap).map(k => ({ name: k, value: sourceMap[k] }));

        res.json({
            summary: {
                total: { value: totalCurr, growth: calcGrowth(totalCurr, totalPrev) },
                active: { value: activeCurr, growth: calcGrowth(activeCurr, activePrev) },
                conversions: { value: convCurr, growth: calcGrowth(convCurr, convPrev) },
                pipeline_value: { value: valCurr }
            },
            funnel: funnelData,
            trend: trendData,
            tasks: { overdue: overdueCount || 0, due_today: dueTodayCount || 0, open: openCount || 0 },
            sources: sourcesData,
            weekly: [] // Simplified/legacy support
        });

    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- SETTINGS API ---

app.get('/api/settings', async (req, res) => {
    const { pipeline } = req.query;
    try {
        const { data, error } = await db.from('settings').select('*');
        if (error) throw error;
        const config = {};
        (data || []).forEach(s => config[s.key] = s.value);

        if (pipeline) {
            const nameKey = `mapping_name_for_${pipeline}`;
            const emailKey = `mapping_email_for_${pipeline}`;
            const phoneKey = `mapping_phone_for_${pipeline}`;

            if (config[nameKey] !== undefined) config.mapping_name = config[nameKey];
            if (config[emailKey] !== undefined) config.mapping_email = config[emailKey];
            if (config[phoneKey] !== undefined) config.mapping_phone = config[phoneKey];
        }
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const settings = req.body;
    const { pipeline } = req.query;
    try {
        for (const [key, value] of Object.entries(settings)) {
            let saveKey = key;
            if (pipeline && ['mapping_name', 'mapping_email', 'mapping_phone'].includes(key)) {
                saveKey = `${key}_for_${pipeline}`;
            }
            const { error } = await db
                .from('settings')
                .upsert({ key: saveKey, value }, { onConflict: 'key' });
            if (error) throw error;
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Trigger retroactive re-mapping for all leads
app.post('/api/leads/remap', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*');
        const config = {};
        (settingsData || []).forEach(s => config[s.key] = s.value);

        let pipelines = ['SaladO'];
        const pipelinesSetting = config['pipelines'];
        if (pipelinesSetting) {
            try { pipelines = JSON.parse(pipelinesSetting); } catch (e) {}
        }
        const firstPipeline = pipelines[0] || 'SaladO';

        const { data: leads } = await db.from('leads').select('id, status, custom_data').not('custom_data', 'is', null);

        let remapCount = 0;
        for (const lead of (leads || [])) {
            try {
                let pipeline = firstPipeline;
                if (lead.status && lead.status.includes(':')) {
                    pipeline = lead.status.split(':')[0];
                }

                const nameKey = `mapping_name_for_${pipeline}`;
                const emailKey = `mapping_email_for_${pipeline}`;
                const phoneKey = `mapping_phone_for_${pipeline}`;

                const mapName = config[nameKey] || config['mapping_name'] || 'full_name';
                const mapEmail = config[emailKey] || config['mapping_email'] || 'email';
                const mapPhone = config[phoneKey] || config['mapping_phone'] || 'phone_number';

                const data = typeof lead.custom_data === 'string' ? JSON.parse(lead.custom_data) : lead.custom_data;
                const lookup = (key) => {
                    if (!key) return null;
                    const lowerKey = key.toLowerCase();
                    const actualKey = Object.keys(data).find(k => k.toLowerCase() === lowerKey);
                    return actualKey ? data[actualKey] : null;
                };

                const newName = lookup(mapName) || lookup('full_name') || lead.name || 'Unknown';
                const newEmail = lookup(mapEmail) || lookup('email');
                const newPhone = lookup(mapPhone) || lookup('phone_number') || lookup('phone');

                await db.from('leads').update({ name: newName, email: newEmail, phone: newPhone }).eq('id', lead.id);
                remapCount++;
            } catch (e) {
                console.error('[Remap Lead Error]', e);
            }
        }

        res.json({ success: true, count: remapCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PIPELINES API ---

app.get('/api/pipelines', async (req, res) => {
    try {
        const { data, error } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = [];
        if (data && data.value) {
            try {
                pipelines = JSON.parse(data.value);
            } catch (e) {}
        }
        res.json(pipelines);
    } catch (err) {
        res.json([]);
    }
});

app.post('/api/pipelines', async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Pipeline name is required' });
    }
    const cleanName = name.trim();
    if (cleanName === 'Default Pipeline') {
        return res.status(400).json({ error: 'Cannot create Default Pipeline' });
    }

    try {
        const { data: settingsData } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = [];
        if (settingsData && settingsData.value) {
            try {
                pipelines = JSON.parse(settingsData.value);
            } catch (e) {}
        }

        if (pipelines.includes(cleanName)) {
            return res.status(400).json({ error: 'Pipeline already exists' });
        }

        pipelines.push(cleanName);
        await db.from('settings').upsert({ key: 'pipelines', value: JSON.stringify(pipelines) }, { onConflict: 'key' });

        // Add default stages for this pipeline
        const defaultStages = [
            { name: `${cleanName}:New Lead`, color: '#6366f1', order_index: 0 },
            { name: `${cleanName}:Contacted`, color: '#3b82f6', order_index: 1 },
            { name: `${cleanName}:Qualified`, color: '#10b981', order_index: 2 },
            { name: `${cleanName}:Proposal`, color: '#f59e0b', order_index: 3 },
            { name: `${cleanName}:Won`, color: '#10b981', order_index: 4 },
            { name: `${cleanName}:Lost`, color: '#ef4444', order_index: 5 }
        ];

        for (const stage of defaultStages) {
            await db.from('stages').upsert(stage, { onConflict: 'name' });
        }

        res.json({ success: true, pipelines });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/pipelines', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Pipeline name is required' });

    try {
        const { data: settingsData } = await db.from('settings').select('*').eq('key', 'pipelines').single();
        let pipelines = [];
        if (settingsData && settingsData.value) {
            try {
                pipelines = JSON.parse(settingsData.value);
            } catch (e) {}
        }

        pipelines = pipelines.filter(p => p !== name);
        await db.from('settings').upsert({ key: 'pipelines', value: JSON.stringify(pipelines) }, { onConflict: 'key' });

        // Delete stages for this pipeline
        await db.from('stages').delete().like('name', `${name}:%`);

        res.json({ success: true, pipelines });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/pipelines/mappings', async (req, res) => {
    try {
        const { data } = await db.from('settings').select('*').eq('key', 'form_pipeline_mappings').single();
        let mappings = {};
        if (data && data.value) {
            try {
                mappings = JSON.parse(data.value);
            } catch (e) {}
        }
        res.json(mappings);
    } catch (err) {
        res.json({});
    }
});

app.post('/api/pipelines/mappings', async (req, res) => {
    const { mappings } = req.body;
    try {
        await db.from('settings').upsert({ key: 'form_pipeline_mappings', value: JSON.stringify(mappings || {}) }, { onConflict: 'key' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function getPipelineForForm(formId) {
    if (!formId) return null;
    try {
        const { data: mappingsData } = await db.from('settings').select('*').eq('key', 'form_pipeline_mappings').single();
        if (mappingsData && mappingsData.value) {
            const mappings = JSON.parse(mappingsData.value);
            const pipeline = mappings[formId];
            return (pipeline && pipeline !== 'Default Pipeline') ? pipeline : null;
        }
    } catch (e) {}
    return null;
}

async function getMappingForPipeline(pipeline) {
    const mapping = { name: 'full_name', email: 'email', phone: 'phone_number' };
    try {
        const { data: settingsData } = await db.from('settings').select('*');
        const config = {};
        (settingsData || []).forEach(s => config[s.key] = s.value);

        if (pipeline) {
            const nameKey = `mapping_name_for_${pipeline}`;
            const emailKey = `mapping_email_for_${pipeline}`;
            const phoneKey = `mapping_phone_for_${pipeline}`;

            if (config[nameKey]) mapping.name = config[nameKey];
            if (config[emailKey]) mapping.email = config[emailKey];
            if (config[phoneKey]) mapping.phone = config[phoneKey];
        } else {
            if (config.mapping_name) mapping.name = config.mapping_name;
            if (config.mapping_email) mapping.email = config.mapping_email;
            if (config.mapping_phone) mapping.phone = config.mapping_phone;
        }
    } catch (e) {}
    return mapping;
}

async function getPipelineStageForForm(formId) {
    if (!formId) return 'new';
    try {
        const pipeline = await getPipelineForForm(formId);
        if (pipeline) {
            const { data: stages } = await db.from('stages').select('name').like('name', `${pipeline}:%`).order('order_index', { ascending: true });
            if (stages && stages.length > 0) {
                return stages[0].name;
            }
        }
    } catch (e) {
        console.error('[Pipeline Helper Error]', e);
    }
    return 'new';
}

// --- META INTEGRATION API ---

const https = require('https');

// Helper to safely execute Facebook Graph API requests and avoid request hangs on parse/network errors
function getFacebookData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let raw = '';
            response.on('data', chunk => raw += chunk);
            response.on('end', () => {
                try {
                    resolve(JSON.parse(raw));
                } catch (e) {
                    reject(new Error(`Failed to parse FB response: ${e.message}. Raw data was: ${raw.substring(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

// Return public Meta App ID to frontend (safe to expose)
app.get('/api/meta/app-config', (req, res) => {
    const appId = process.env.META_APP_ID;
    if (!appId || appId === 'your_meta_app_id_here') {
        return res.status(404).json({ error: 'META_APP_ID not configured in .env' });
    }
    res.json({ appId });
});

// Exchange user token for pages list via Graph API
app.post('/api/meta/pages', async (req, res) => {
    const { userToken } = req.body;
    if (!userToken) return res.status(400).json({ error: 'userToken required' });

    try {
        // 1. Get pages directly owned/managed by the user
        const directPagesData = await getFacebookData(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}&fields=id,name,category,access_token&limit=100`);
        if (directPagesData.error) return res.status(400).json({ error: directPagesData.error.message });
        
        let allPages = directPagesData.data || [];

        // 2. Fetch businesses (if business_management permission is granted)
        try {
            const businessesData = await getFacebookData(`https://graph.facebook.com/v19.0/me/businesses?access_token=${userToken}&limit=100`);
            const businesses = businessesData.data || [];

            for (const biz of businesses) {
                // Fetch owned pages
                const ownedData = await getFacebookData(`https://graph.facebook.com/v19.0/${biz.id}/owned_pages?access_token=${userToken}&fields=id,name,category,access_token&limit=100`);
                if (ownedData && ownedData.data) {
                    allPages = allPages.concat(ownedData.data);
                }

                // Fetch client pages (shared pages)
                const clientData = await getFacebookData(`https://graph.facebook.com/v19.0/${biz.id}/client_pages?access_token=${userToken}&fields=id,name,category,access_token&limit=100`);
                if (clientData && clientData.data) {
                    allPages = allPages.concat(clientData.data);
                }
            }
        } catch (bizErr) {
            console.warn('[Meta Pages] Failed to fetch business pages (might lack business_management permission):', bizErr.message);
        }

        // 3. Remove duplicates based on Page ID
        const uniquePages = [];
        const seenIds = new Set();
        for (const p of allPages) {
            if (p && p.id && !seenIds.has(p.id)) {
                seenIds.add(p.id);
                uniquePages.push(p);
            }
        }

        res.json({ success: true, pages: uniquePages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch ad accounts for the connected user
app.post('/api/meta/adaccounts', async (req, res) => {
    const { userToken } = req.body;
    if (!userToken) return res.status(400).json({ error: 'userToken required' });

    try {
        const url = `https://graph.facebook.com/v19.0/me/adaccounts?access_token=${userToken}&fields=id,name,account_status`;
        const data = await getFacebookData(url);

        if (data.error) return res.status(400).json({ error: data.error.message });
        res.json({ success: true, adaccounts: data.data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save selected page & ad account to settings
app.post('/api/meta/save-page', async (req, res) => {
    let { pageId, pageToken, pageName, adAccountId, adAccountName, userToken } = req.body;
    if (!pageId) return res.status(400).json({ error: 'pageId required' });

    let fetchError = null;
    // Fetch Page access token using User access token if pageToken is missing or is the string "undefined"
    if ((!pageToken || pageToken === 'undefined') && userToken) {
        try {
            console.log(`[Meta Save Page] Fetching token for page ${pageId} using user token`);
            const pageData = await getFacebookData(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${userToken}`);
            if (pageData && pageData.access_token) {
                pageToken = pageData.access_token;
            } else {
                fetchError = pageData.error ? pageData.error.message : JSON.stringify(pageData);
                console.warn('[Meta Save Page] Could not fetch page access token from Facebook:', pageData);
            }
        } catch (e) {
            fetchError = e.message;
            console.error('[Meta Save Page] Failed to fetch page access token:', e);
        }
    }

    if (!pageToken || pageToken === 'undefined') {
        return res.status(400).json({ error: `Valid pageToken is required. Facebook fetch error: ${fetchError || 'No userToken provided or page access denied'}` });
    }

    try {
        const toSave = {
            meta_page_id: pageId,
            meta_page_name: pageName || '',
            meta_page_token: pageToken,
            ...(adAccountId ? { meta_ad_account_id: adAccountId } : {}),
            ...(adAccountName ? { meta_ad_account_name: adAccountName } : {}),
            ...(userToken ? { meta_user_token: userToken } : {}),
            meta_connected: 'true'
        };

        for (const [key, value] of Object.entries(toSave)) {
            await db.from('settings').upsert({ key, value }, { onConflict: 'key' });
        }

        res.json({ success: true, message: `Connected page: ${pageName}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current Meta connection status
app.get('/api/meta/status', async (req, res) => {
    try {
        const { data } = await db.from('settings').select('*').in('key', [
            'meta_page_id', 'meta_page_name', 'meta_ad_account_id', 'meta_ad_account_name', 'meta_connected', 'meta_user_token'
        ]);
        const config = {};
        (data || []).forEach(s => config[s.key] = s.value);
        res.json({
            connected: config.meta_connected === 'true',
            pageId: config.meta_page_id || null,
            pageName: config.meta_page_name || null,
            adAccountId: config.meta_ad_account_id || null,
            adAccountName: config.meta_ad_account_name || null,
            hasUserToken: !!config.meta_user_token
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all active/paused campaigns for the linked Ad Account
app.get('/api/meta/campaigns', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*').in('key', ['meta_ad_account_id', 'meta_user_token']);
        const config = {};
        (settingsData || []).forEach(s => config[s.key] = s.value);

        const adAccountId = config.meta_ad_account_id;
        const userToken = config.meta_user_token;

        if (!adAccountId || !userToken) {
            return res.json([]);
        }

        const url = `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?access_token=${userToken}&fields=id,name,status,objective&limit=50`;
        const data = await getFacebookData(url);

        if (data.error) {
            console.error('[Meta Campaigns Error]', data.error);
            return res.json([]);
        }

        res.json(data.data || []);
    } catch (err) {
        console.error('[Meta Campaigns Catch]', err);
        res.json([]);
    }
});

// Get all leadgen forms for the connected Page
app.get('/api/meta/forms', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*').in('key', ['meta_page_id', 'meta_page_token', 'meta_page_name']);
        const config = {};
        (settingsData || []).forEach(s => config[s.key] = s.value);

        const pageId = config.meta_page_id;
        const pageToken = config.meta_page_token;
        const pageName = config.meta_page_name;

        if (!pageId || !pageToken) {
            return res.json([]);
        }

        const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${pageToken}&fields=id,name,status,leads_count&limit=100`;
        const data = await getFacebookData(url);

        if (data.error) {
            console.error('[Meta Forms Error]', data.error);
            return res.json([]);
        }

        const forms = (data.data || []).map(f => ({
            id: f.id,
            name: f.name,
            pageName: pageName,
            status: f.status || 'ACTIVE',
            leadsCount: f.leads_count || 0
        }));

        res.json(forms);
    } catch (err) {
        console.error('[Meta Forms Catch]', err);
        res.json([]);
    }
});

// Sync existing leads from Facebook page forms
app.post('/api/meta/sync-leads', async (req, res) => {
    try {
        const { data: settingsData } = await db.from('settings').select('*').in('key', ['meta_page_id', 'meta_page_token']);
        const config = {};
        (settingsData || []).forEach(s => config[s.key] = s.value);

        const pageId = config.meta_page_id;
        const pageToken = config.meta_page_token;

        if (!pageId || !pageToken) {
            return res.status(400).json({ error: 'Meta integration is not connected.' });
        }

        // 1. Fetch all Lead Forms for the Page
        console.log(`[Sync] Fetching forms for page: ${pageId}`);
        const formsData = await getFacebookData(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?access_token=${pageToken}&fields=id,name`);
        if (formsData.error) {
            console.error('[Sync] Forms Fetch Error:', formsData.error);
            throw new Error(formsData.error.message);
        }

        const forms = formsData.data || [];
        console.log(`[Sync] Found ${forms.length} forms:`, forms.map(f => f.name));
        let totalSynced = 0;

        // 2. Fetch leads for each form
        for (const form of forms) {
            console.log(`[Sync] Fetching leads for form: ${form.name} (${form.id})`);
            const leadsData = await getFacebookData(`https://graph.facebook.com/v19.0/${form.id}/leads?access_token=${pageToken}&fields=id,field_data,created_time`);
            if (leadsData.error) {
                console.error(`[Sync] Leads Fetch Error for form ${form.name}:`, leadsData.error);
                continue;
            }

            const status = await getPipelineStageForForm(form.id);

            const leads = leadsData.data || [];
            console.log(`[Sync] Form ${form.name} returned ${leads.length} leads raw`);
            for (const lead of leads) {
                // Parse lead fields
                const fields = { facebook_lead_id: lead.id, form_id: form.id };
                if (lead.field_data) {
                    lead.field_data.forEach(item => {
                        if (item.values && item.values[0]) {
                            fields[item.name] = item.values[0];
                        }
                    });
                }

                const pipeline = await getPipelineForForm(form.id);
                const mapping = await getMappingForPipeline(pipeline);

                const getVal = (mapKey, defaultKey) => {
                    const keys = [mapKey, defaultKey];
                    for (const k of keys) {
                        if (!k) continue;
                        const lowerK = k.toLowerCase();
                        const found = Object.keys(fields).find(fk => fk.toLowerCase() === lowerK);
                        if (found && fields[found]) return fields[found];
                    }
                    return null;
                };

                const name = getVal(mapping.name, 'full_name') || 
                             (fields.first_name && fields.last_name ? (fields.first_name + ' ' + fields.last_name) : null) || 
                             'Meta Lead';
                const email = getVal(mapping.email, 'email') || null;
                const phone = getVal(mapping.phone, 'phone_number') || getVal(mapping.phone, 'phone') || null;

                // Check for duplicates in DB based on email (if exists) or custom_data matching the Facebook Lead ID
                let existingLeadId = null;
                if (email) {
                    const { data: dupEmail } = await db.from('leads').select('id').eq('email', email).limit(1);
                    if (dupEmail && dupEmail.length > 0) existingLeadId = dupEmail[0].id;
                }

                if (!existingLeadId) {
                    // Search in JSONB custom_data field for the matching facebook_lead_id
                    const { data: dupFbId } = await db.from('leads')
                        .select('id')
                        .contains('custom_data', { facebook_lead_id: lead.id })
                        .limit(1);
                    if (dupFbId && dupFbId.length > 0) existingLeadId = dupFbId[0].id;
                }

                if (existingLeadId) {
                    // Lead exists. Update its status/stage to the current form's mapped pipeline stage status
                    await db.from('leads').update({ status }).eq('id', existingLeadId);
                    continue;
                }

                // Insert into DB
                const { error: insertError, data: insertedRow } = await db.from('leads').insert([{
                    name,
                    email,
                    phone,
                    source: 'Meta Ads',
                    status,
                    created_at: lead.created_time || new Date().toISOString(),
                    custom_data: fields
                }]).select();

                if (!insertError) {
                    totalSynced++;
                    if (insertedRow && insertedRow[0]) {
                        triggerAutomations('new_lead', insertedRow[0]);
                    }
                }
            }
        }

        res.json({ success: true, count: totalSynced });
    } catch (err) {
        console.error("Sync Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Disconnect Meta integration
app.delete('/api/meta/disconnect', async (req, res) => {
    try {
        const keys = ['meta_page_id', 'meta_page_name', 'meta_page_token', 'meta_ad_account_id', 'meta_ad_account_name', 'meta_connected', 'meta_user_token'];
        for (const key of keys) {
            await db.from('settings').delete().eq('key', key);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- CONTACTS API ---


app.get('/api/contacts', async (req, res) => {
    const { q } = req.query;
    try {
        let query = db.from('contacts').select('*');
        if (q) {
            query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,company.ilike.%${q}%`);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/contacts', async (req, res) => {
    const { name, email, phone, company, title, notes, tags, assigned_to, source } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    try {
        const { data, error } = await db
            .from('contacts')
            .insert([{
                name,
                email: email || null,
                phone: phone || null,
                company: company || null,
                title: title || null,
                notes: notes || null,
                tags: tags || [],
                assigned_to: assigned_to || null,
                source: source || 'Manual'
            }])
            .select();

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contacts/:id', async (req, res) => {
    try {
        const { data, error } = await db.from('contacts').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: 'Contact not found' });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/contacts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, company, title, notes, tags, assigned_to, source } = req.body;
    try {
        const { data: c, error: fetchErr } = await db.from('contacts').select('*').eq('id', id).single();
        if (fetchErr || !c) return res.status(404).json({ error: 'Contact not found' });

        const payload = {
            name: name ?? c.name,
            email: email ?? c.email,
            phone: phone ?? c.phone,
            company: company ?? c.company,
            title: title ?? c.title,
            notes: notes ?? c.notes,
            tags: tags ?? c.tags,
            assigned_to: assigned_to ?? c.assigned_to,
            source: source ?? c.source
        };

        const { data, error: updateErr } = await db.from('contacts').update(payload).eq('id', id).select().single();
        if (updateErr) throw updateErr;

        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete contact
app.delete('/api/contacts/:id', async (req, res) => {
    try {
        const { error } = await db.from('contacts').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TASKS API ---

app.get('/api/tasks', async (req, res) => {
    const { lead_id, contact_id, status, assigned_to } = req.query;
    try {
        let query = db.from('tasks').select(`
            *,
            leads!left (name)
        `);
        if (lead_id) query = query.eq('lead_id', lead_id);
        if (contact_id) query = query.eq('contact_id', contact_id);
        if (status) query = query.eq('status', status);
        if (assigned_to) query = query.eq('assigned_to', assigned_to);

        const { data, error } = await query.order('due_date', { ascending: true });
        if (error) throw error;

        const formatted = (data || []).map(t => ({
            ...t,
            lead_name: t.leads ? t.leads.name : null
        }));

        res.json(formatted);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
    const { title, lead_id, contact_id, due_date, priority, assigned_to } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    try {
        const { data, error } = await db
            .from('tasks')
            .insert([{
                title,
                lead_id: lead_id || null,
                contact_id: contact_id || null,
                due_date: due_date || null,
                priority: priority || 'medium',
                assigned_to: assigned_to || null
            }])
            .select();

        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { title, status, due_date, priority, assigned_to } = req.body;
    try {
        const { data: t, error: fetchErr } = await db.from('tasks').select('*').eq('id', id).single();
        if (fetchErr || !t) return res.status(404).json({ error: 'Task not found' });

        const payload = {
            title: title ?? t.title,
            status: status ?? t.status,
            due_date: due_date ?? t.due_date,
            priority: priority ?? t.priority,
            assigned_to: assigned_to ?? t.assigned_to
        };

        const { data, error: updateErr } = await db.from('tasks').update(payload).eq('id', id).select().single();
        if (updateErr) throw updateErr;

        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { error } = await db.from('tasks').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TEAM & AUTHENTICATION API ---

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    try {
        const { data: member, error } = await db
            .from('team_members')
            .select('*')
            .eq('email', email.trim().toLowerCase())
            .single();

        if (error || !member || member.password !== password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate dynamic token
        const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        const { error: sessionError } = await db
            .from('team_sessions')
            .insert([{ token, member_id: member.id, expires_at: expiresAt }]);

        if (sessionError) throw sessionError;

        res.json({
            success: true,
            token,
            member: {
                id: member.id,
                name: member.name,
                email: member.email,
                role: member.role,
                permissions: member.permissions || [],
                settings: member.settings || { sound_enabled: true }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/settings', async (req, res) => {
    const { token, settings } = req.body;
    if (!token || !settings) return res.status(400).json({ error: 'Missing token or settings payload' });

    try {
        // Get session
        const { data: session, error: sessErr } = await db
            .from('team_sessions')
            .select('member_id')
            .eq('token', token)
            .single();

        if (sessErr || !session) return res.status(401).json({ error: 'Session invalid or expired' });

        const { data: updatedMember, error: updateErr } = await db
            .from('team_members')
            .update({ settings })
            .eq('id', session.member_id)
            .select('settings')
            .single();

        if (updateErr) {
            if (updateErr.code === '42703') { // Column not found
                return res.status(200).json({
                    success: true,
                    settings,
                    warning: 'settings_column_missing'
                });
            }
            throw updateErr;
        }

        res.json({ success: true, settings: updatedMember.settings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/change-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Missing token or new password' });

    try {
        // Get session
        const { data: session, error: sessErr } = await db
            .from('team_sessions')
            .select('member_id')
            .eq('token', token)
            .single();

        if (sessErr || !session) return res.status(401).json({ error: 'Session invalid or expired' });

        const { error: updateErr } = await db
            .from('team_members')
            .update({ password: newPassword })
            .eq('id', session.member_id);

        if (updateErr) throw updateErr;

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/team', async (req, res) => {
    try {
        const { data, error } = await db.from('team_members').select('*').order('created_at', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/team', async (req, res) => {
    const { name, email, role, permissions } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
    
    // Generate temp password format: name@3-digit-random
    const firstName = name.trim().split(' ')[0].replace(/[^a-zA-Z]/g, '');
    const randomNum = Math.floor(100 + Math.random() * 900);
    const tempPassword = `${firstName}@${randomNum}`;
    const targetRole = role || 'employee';
    const targetPermissions = permissions || ['dashboard', 'leads', 'contacts', 'tasks'];

    try {
        const { data, error } = await db
            .from('team_members')
            .insert([{ 
                name, 
                email, 
                role: targetRole, 
                password: tempPassword,
                permissions: targetPermissions
            }])
            .select();

        if (error) throw error;
        const newMember = data[0];

        // Send Email Invite
        const subject = 'Welcome to Simple CRM — Setup Your Account';
        const mailBody = `Hello ${name},\n\nYour Simple CRM account has been created successfully.\n\nUsername: ${email}\nTemporary Password: ${tempPassword}\n\nPlease login at the CRM console and change your password immediately in the "My Account" section.\n\nBest Regards,\nCRM Team`;
        
        await automationEngine.sendEmail(email, subject, mailBody, null, null);

        res.status(201).json(newMember);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/team/bulk-permissions', async (req, res) => {
    const { ids, permissions } = req.body;
    if (!ids || !Array.isArray(ids) || !permissions) {
        return res.status(400).json({ error: 'Ids array and permissions list are required' });
    }

    try {
        for (const id of ids) {
            const { error } = await db
                .from('team_members')
                .update({ permissions })
                .eq('id', id);
            if (error) throw error;
        }
        res.json({ success: true, message: 'Permissions updated in bulk successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/team/:id', async (req, res) => {
    try {
        const { error } = await db.from('team_members').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// --- FIELD MAPPING HELPER ---
async function processMappedPayload(payload) {
    const rawData = { ...payload };
    const lowerKeys = {};
    Object.keys(rawData).forEach(k => {
        lowerKeys[k.toLowerCase()] = k;
    });

    const { data: mappingSettings } = await db.from('settings').select('key, value').in('key', ['mapping_name', 'mapping_email', 'mapping_phone']);
    const mapping = { name: 'name', email: 'email', phone: 'phone' };

    (mappingSettings || []).forEach(s => {
        if (s.key === 'mapping_name' && s.value) mapping.name = s.value.toLowerCase();
        if (s.key === 'mapping_email' && s.value) mapping.email = s.value.toLowerCase();
        if (s.key === 'mapping_phone' && s.value) mapping.phone = s.value.toLowerCase();
    });

    const getVal = (mapKey) => {
        const actualKey = lowerKeys[mapKey];
        return actualKey ? rawData[actualKey] : null;
    };

    const sourceTime = getVal('created_time') || getVal('timestamp') || rawData.created_time || rawData.timestamp || null;

    const lead = {
        name: getVal(mapping.name) || rawData.name || 'Unknown Lead',
        email: getVal(mapping.email) || rawData.email || null,
        phone: getVal(mapping.phone) || rawData.phone || null,
        source: rawData.source || null,
        created_at: sourceTime || new Date().toISOString(),
        custom_data: rawData
    };
    return lead;
}

// --- GENERIC WEBHOOK ---

app.get('/api/webhooks/generic', (req, res) => {
    res.send('Generic Webhook Endpoint is Live. Please use POST to send lead data.');
});

app.post('/api/webhooks/generic', async (req, res) => {
    console.log('Incoming Generic Webhook:', req.body);
    
    try {
        const leadData = await processMappedPayload(req.body);
        leadData.source = leadData.source || 'Generic Webhook';

        const { data, error } = await db
            .from('leads')
            .insert([{
                name: leadData.name,
                email: leadData.email,
                phone: leadData.phone,
                source: leadData.source,
                created_at: leadData.created_at,
                custom_data: leadData.custom_data
            }])
            .select();

        if (error) throw error;
        const newLead = data[0];
        
        triggerAutomations('new_lead', newLead);
        res.json({ success: true, lead_id: newLead.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEAD SEARCH ---

app.get('/api/leads/search', async (req, res) => {
    const { q, stage, source, assigned_to } = req.query;
    try {
        let query = db.from('leads').select('*');
        if (q) {
            query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,company.ilike.%${q}%`);
        }
        if (stage) query = query.eq('status', stage);
        if (source) query = query.eq('source', source);
        if (assigned_to) query = query.eq('assigned_to', assigned_to);

        const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEAD EXPORT (CSV) ---

app.get('/api/leads/export', async (req, res) => {
    try {
        const { data: leads, error } = await db
            .from('leads')
            .select('id,name,email,phone,status,source,company,assigned_to,value,created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const headers = ['ID','Name','Email','Phone','Stage','Source','Company','Assigned To','Value','Created At'];
        const rows = (leads || []).map(l => [
            l.id, `"${(l.name||'').replace(/"/g,'""')}"`,
            `"${(l.email||'').replace(/"/g,'""')}"`,
            `"${(l.phone||'').replace(/"/g,'""')}"`,
            l.status, l.source,
            `"${(l.company||'').replace(/"/g,'""')}"`,
            `"${(l.assigned_to||'').replace(/"/g,'""')}"`,
            l.value || 0, l.created_at
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="leads_export.csv"');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEAD NOTES ---

app.post('/api/leads/:id/notes', async (req, res) => {
    const { message } = req.body;
    const { id } = req.params;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    try {
        const { error } = await db.from('logs').insert([{ lead_id: id, message, type: 'note' }]);
        if (error) throw error;
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LEAD IMPORT (CSV) ---

app.post('/api/leads/import', async (req, res) => {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: 'No lead data provided' });

    let importedCount = 0;
    try {
        for (const rawLead of leads) {
            const leadData = await processMappedPayload(rawLead);
            leadData.source = leadData.source || rawLead.source || 'Bulk Import';
            
            const { data, error } = await db
                .from('leads')
                .insert([{
                    name: leadData.name,
                    email: leadData.email,
                    phone: leadData.phone,
                    source: leadData.source,
                    created_at: leadData.created_at,
                    custom_data: leadData.custom_data
                }])
                .select();

            if (error) throw error;
            if (data && data[0]) {
                triggerAutomations('new_lead', data[0]);
                importedCount++;
            }
        }
        res.json({ success: true, count: importedCount });
    } catch (err) {
        console.error('Import Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- AUTOMATION ENGINE ---

async function triggerAutomations(triggerType, lead) {
    try {
        const { data: autos } = await db
            .from('automations')
            .select('*')
            .eq('trigger', triggerType)
            .eq('active', true);

        for (const auto of (autos || [])) {
            const settings = typeof auto.settings === 'string' ? JSON.parse(auto.settings) : auto.settings;
            const logMsg = `[Automation: ${auto.name}] Initialized for ${lead.name}.`;
            console.log(logMsg);
            
            await db.from('logs').insert([{ lead_id: lead.id, automation_id: auto.id, message: logMsg }]);

            if (auto.action === 'send_email') {
                await automationEngine.sendEmail(lead.email, settings.subject, settings.body, lead.id, auto.id);
            } else if (auto.action === 'send_whatsapp') {
                await automationEngine.sendWhatsApp(lead.phone, settings.body || "Hello!", lead.id, auto.id);
            }
        }
    } catch (err) {
        console.error('Automation trigger error:', err);
    }

    // Also run matching Workflows
    await triggerWorkflows(lead);
}

let workflowRoundRobinCounters = {};

async function triggerWorkflows(lead) {
    try {
        const { data: workflows } = await db
            .from('workflows')
            .select('*')
            .eq('active', true);

        const matching = (workflows || []).filter(w => {
            const src = (w.trigger || 'any').toLowerCase();
            return src === 'any' || src === (lead.source || '').toLowerCase();
        });

        for (const wf of matching) {
            const steps = typeof wf.steps === 'string' ? JSON.parse(wf.steps) : (wf.steps || []);
            console.log(`[Workflow: ${wf.name}] Starting for lead ${lead.name}`);

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const cfg = step.config || {};
                let logMsg = '';

                try {
                    if (step.type === 'assign_staff') {
                        const staffList = cfg.staff || [];
                        if (staffList.length === 0) continue;

                        let assignedName = null;
                        if (!workflowRoundRobinCounters[wf.id]) {
                            workflowRoundRobinCounters[wf.id] = 0;
                        }
                        const currentIdx = workflowRoundRobinCounters[wf.id];

                        if (cfg.mode === 'weighted') {
                            // Build weighted pool
                            const pool = [];
                            staffList.forEach(s => {
                                const w = parseInt(s.weight) || 1;
                                for (let j = 0; j < w; j++) pool.push(s.name);
                            });
                            assignedName = pool[currentIdx % pool.length];
                            workflowRoundRobinCounters[wf.id] = (currentIdx + 1) % pool.length;
                        } else {
                            // Even round-robin
                            assignedName = staffList[currentIdx % staffList.length].name;
                            workflowRoundRobinCounters[wf.id] = (currentIdx + 1) % staffList.length;
                        }

                        if (assignedName) {
                            await db.from('leads').update({ assigned_to: assignedName }).eq('id', lead.id);
                            lead.assigned_to = assignedName;
                            logMsg = `[Workflow: ${wf.name}] Step ${i + 1}: Assigned lead to ${assignedName}`;
                        }

                    } else if (step.type === 'send_email') {
                        const subject = (cfg.subject || 'Hello {{name}}').replace('{{name}}', lead.name).replace('{{email}}', lead.email || '').replace('{{source}}', lead.source || '');
                        const body = (cfg.body || '').replace('{{name}}', lead.name).replace('{{email}}', lead.email || '').replace('{{source}}', lead.source || '');
                        if (lead.email) {
                            await automationEngine.sendEmail(lead.email, subject, body, lead.id, null);
                        }
                        logMsg = `[Workflow: ${wf.name}] Step ${i + 1}: Email sent to ${lead.email || 'no email'} — Subject: ${subject}`;

                    } else if (step.type === 'send_whatsapp') {
                        const msg = (cfg.body || 'Hello {{name}}!').replace('{{name}}', lead.name).replace('{{email}}', lead.email || '').replace('{{source}}', lead.source || '');
                        if (lead.phone) {
                            await automationEngine.sendWhatsApp(lead.phone, msg, lead.id, null);
                        }
                        logMsg = `[Workflow: ${wf.name}] Step ${i + 1}: WhatsApp queued to ${lead.phone || 'no phone'} — "${msg.substring(0, 60)}..."`;

                    } else if (step.type === 'notify_team') {
                        const title = (cfg.title || 'New Lead Alert').replace('{{name}}', lead.name).replace('{{source}}', lead.source || '');
                        const body = (cfg.body || 'A new lead has come in.').replace('{{name}}', lead.name).replace('{{source}}', lead.source || '').replace('{{assigned}}', lead.assigned_to || 'Unassigned');
                        logMsg = `[Workflow: ${wf.name}] Step ${i + 1}: Team Notification — ${title}: ${body}`;
                    }

                    if (logMsg) {
                        await db.from('workflow_logs').insert([{ workflow_id: wf.id, lead_id: lead.id, step_index: i, message: logMsg }]);
                        await db.from('logs').insert([{ lead_id: lead.id, automation_id: null, message: logMsg, type: 'workflow' }]);
                        console.log(logMsg);
                    }
                } catch (stepErr) {
                    console.error(`[Workflow: ${wf.name}] Step ${i + 1} error:`, stepErr.message);
                }
            }
        }
    } catch (err) {
        console.error('Workflow trigger error:', err);
    }
}

// --- META WEBHOOK ---

// Verification Handler
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

// Data Handler
app.post('/api/webhooks/meta', async (req, res) => {
    try {
        const entry = req.body.entry;
        if (!entry || entry.length === 0) return res.sendStatus(200);

        const change = entry[0].changes ? entry[0].changes[0] : null;
        if (!change || change.field !== 'leadgen') return res.sendStatus(200);

        const leadgenId = change.value.leadgen_id;
        const formId = change.value.form_id;
        const leadData = await fetchMetaLeadDetails(leadgenId);
        
        if (leadData) {
            const lowerName = (leadData.name || '').toLowerCase();
            const lowerEmail = (leadData.email || '').toLowerCase();
            if (lowerName.includes('test lead') || lowerName.includes('dummy data') || lowerEmail.includes('test@meta.com')) {
                return res.json({ success: true, message: 'Test lead ignored' });
            }

            const status = await getPipelineStageForForm(formId);
            const pipeline = await getPipelineForForm(formId);
            const mapping = await getMappingForPipeline(pipeline);

            // Parse fields
            const fields = { facebook_lead_id: leadgenId, form_id: formId };
            if (leadData.raw) {
                Object.assign(fields, leadData.raw);
            } else {
                fields.full_name = leadData.name;
                fields.email = leadData.email;
                fields.phone_number = leadData.phone;
            }

            const getVal = (mapKey, defaultKey) => {
                const keys = [mapKey, defaultKey];
                for (const k of keys) {
                    if (!k) continue;
                    const lowerK = k.toLowerCase();
                    const found = Object.keys(fields).find(fk => fk.toLowerCase() === lowerK);
                    if (found && fields[found]) return fields[found];
                }
                return null;
            };

            const name = getVal(mapping.name, 'full_name') || 
                         (fields.first_name && fields.last_name ? (fields.first_name + ' ' + fields.last_name) : null) || 
                         leadData.name ||
                         'Meta Lead';
            const email = getVal(mapping.email, 'email') || leadData.email || null;
            const phone = getVal(mapping.phone, 'phone_number') || getVal(mapping.phone, 'phone') || leadData.phone || null;

            const createdAt = leadData.created_time || new Date().toISOString();
            const { data, error } = await db
                .from('leads')
                .insert([{
                    name,
                    email,
                    phone,
                    source: 'Meta Ads',
                    status,
                    created_at: createdAt,
                    custom_data: fields
                }])
                .select();

            if (error) throw error;
            if (data && data[0]) triggerAutomations('new_lead', data[0]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Meta Ingestion Error:', err);
        res.sendStatus(500);
    }
});

async function fetchMetaLeadDetails(leadId) {
    let accessToken;
    const { data: setting } = await db.from('settings').select('value').eq('key', 'meta_page_token').single();
    if (setting) accessToken = setting.value;
    if (!accessToken) accessToken = process.env.META_PAGE_ACCESS_TOKEN;

    if (!accessToken || accessToken === 'your_page_access_token_here') {
        return { 
            name: `Meta Lead ${leadId}`, 
            email: 'mock@meta.com', 
            phone: '+123456789',
            raw: { full_name: `Meta Lead ${leadId}`, email: 'mock@meta.com', phone_number: '+123456789' }
        };
    }

    const url = `https://graph.facebook.com/v19.0/${leadId}?fields=id,field_data,created_time&access_token=${accessToken}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Meta API error: ${response.statusText}`);
        const data = await response.json();
        
        const fields = {};
        if (data.field_data) {
            data.field_data.forEach(item => {
                if (item.values && item.values[0]) {
                    fields[item.name] = item.values[0];
                }
            });
        }
        return {
            name: fields.full_name || fields.first_name + ' ' + fields.last_name || 'Meta Lead',
            email: fields.email,
            phone: fields.phone_number,
            created_time: data.created_time,
            raw: fields
        };
    } catch (err) {
        return null;
    }
}

// --- GATEWAY TESTING ---
app.post('/api/test-gateways', async (req, res) => {
    const { type, recipient } = req.body;
    try {
        if (type === 'email') {
            const { data: config } = await db.from('settings').select('key, value').like('key', 'smtp_%');
            const settings = {};
            (config || []).forEach(c => settings[c.key] = c.value);

            if (!settings.smtp_user) throw new Error('SMTP not configured.');
            const targetTo = recipient || settings.smtp_user;
            
            const success = await automationEngine.sendEmail(
                targetTo, 
                'Test Connection', 
                'SimpleFunnel CRM Gateway Test: SMTP active.', 
                null, 
                null
            );
            if (!success) throw new Error('SMTP connection test failed.');
            res.json({ success: true, message: 'Test email sent.' });
        } 
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Serve the Privacy Policy Page
app.get(['/privacy', '/privacy.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get(/^(?!\/api).*/, (req, res) => {
    // Exclude API paths and static asset queries (containing dots)
    if (req.path.startsWith('/api') || req.path.includes('.')) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    // Safe self-healing status check
    try {
        const { data: corrupted } = await db.from('leads').select('id, status').like('status', 'board-%');
        for (const lead of (corrupted || [])) {
            const clean = lead.status.replace('board-', '');
            await db.from('leads').update({ status: clean }).eq('id', lead.id);
        }
    } catch (e) {}
});
