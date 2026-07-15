const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('crm.db');

// Initialize Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        status TEXT DEFAULT 'new',
        source TEXT DEFAULT 'Manual',
        custom_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS automations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        action TEXT NOT NULL,
        settings TEXT, -- JSON string
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER,
        automation_id INTEGER,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(lead_id) REFERENCES leads(id),
        FOREIGN KEY(automation_id) REFERENCES automations(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT
    );

    CREATE TABLE IF NOT EXISTS stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Seed Initial Data if empty
const stageCount = db.prepare('SELECT COUNT(*) as count FROM stages').get();
if (stageCount.count === 0) {
    const insertStage = db.prepare('INSERT INTO stages (name, order_index, color) VALUES (?, ?, ?)');
    insertStage.run('new', 0, '#3b82f6');
    insertStage.run('contacted', 1, '#f59e0b');
    insertStage.run('qualified', 2, '#10b981');
    insertStage.run('closed', 3, '#6b7280');
}

const leadCount = db.prepare('SELECT COUNT(*) as count FROM leads').get();
if (leadCount.count === 0) {
    const insertLead = db.prepare('INSERT INTO leads (name, email, phone, status, source) VALUES (?, ?, ?, ?, ?)');
    insertLead.run('Pranav Patil', 'pranav@example.com', '9876543210', 'new', 'Manual');
    insertLead.run('John Doe', 'john@example.com', '9988776655', 'contacted', 'Meta Ads');
    insertLead.run('Jane Smith', 'jane@example.com', '8877665544', 'qualified', 'Website');
}

const autoCount = db.prepare('SELECT COUNT(*) as count FROM automations').get();
if (autoCount.count === 0) {
    const insertAuto = db.prepare('INSERT INTO automations (name, trigger, action, settings) VALUES (?, ?, ?, ?)');
    insertAuto.run('Welcome WhatsApp', 'new_lead', 'send_whatsapp', JSON.stringify({ template: 'welcome_msg' }));
    insertAuto.run('Follow-up Email Sequence', 'new_lead', 'send_email', JSON.stringify({ subject: 'Following up', body: 'Hi, just checking in...' }));
    insertAuto.run('Round Robin Assignment', 'new_lead', 'assignment', JSON.stringify({ strategy: 'equal_distribution' }));
}

module.exports = db;
