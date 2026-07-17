-- PostgreSQL Schema for Supabase CRM

-- 1. Stages Table
CREATE TABLE IF NOT EXISTS stages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Team Members Table (Modified for Credentials & Permissions)
CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'employee', -- 'admin' or 'employee'
    password TEXT, -- temporary plain text or simple hash
    permissions JSONB DEFAULT '["dashboard", "leads", "contacts", "tasks"]'::jsonb,
    settings JSONB DEFAULT '{"sound_enabled": true}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Sessions Table for Login Authentication
CREATE TABLE IF NOT EXISTS team_sessions (
    token TEXT PRIMARY KEY,
    member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 4. Leads Table
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    status TEXT DEFAULT 'new' REFERENCES stages(name) ON UPDATE CASCADE ON DELETE SET DEFAULT,
    source TEXT DEFAULT 'Manual',
    company TEXT,
    assigned_to TEXT,
    value NUMERIC DEFAULT 0,
    custom_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Automations Table
CREATE TABLE IF NOT EXISTS automations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    action TEXT NOT NULL,
    settings JSONB,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Logs Table
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    automation_id INTEGER REFERENCES automations(id) ON DELETE SET NULL,
    message TEXT,
    type TEXT DEFAULT 'automation',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT
);

-- 8. Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    title TEXT,
    notes TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    assigned_to TEXT,
    source TEXT DEFAULT 'Manual',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    due_date DATE,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Default Stages
INSERT INTO stages (name, color, order_index) VALUES
('new', '#6366f1', 0),
('contacted', '#3b82f6', 1),
('qualified', '#10b981', 2),
('proposal', '#f59e0b', 3),
('won', '#10b981', 4),
('lost', '#ef4444', 5)
ON CONFLICT (name) DO NOTHING;

-- Seed Default Team Members
INSERT INTO team_members (name, email, role, password, permissions) VALUES
('Pranav Patil', 'pranav@capoasis.com', 'admin', 'Pranav@123', '["dashboard", "leads", "contacts", "tasks", "automations", "activity", "flows", "integrations", "team"]')
ON CONFLICT (email) DO NOTHING;

-- 10. Workflows Table
CREATE TABLE IF NOT EXISTS workflows (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_source TEXT DEFAULT 'any',
    steps JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN DEFAULT TRUE,
    rr_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Workflow Logs Table
CREATE TABLE IF NOT EXISTS workflow_logs (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    step_index INTEGER DEFAULT 0,
    message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
