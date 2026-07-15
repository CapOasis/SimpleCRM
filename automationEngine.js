const nodemailer = require('nodemailer');
const twilio = require('twilio');
const db = require('./db');
require('dotenv').config();

// --- Configuration Refresh Helper ---
async function getGatewaySettings() {
    try {
        const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key LIKE 'twilio_%'").all();
        const config = {};
        settings.forEach(s => config[s.key] = s.value);
        return config;
    } catch (e) { 
        console.error('[Engine Config Error]', e);
        return {}; 
    }
}

// --- Email Configuration ---
const createTransporter = async () => {
    const config = await getGatewaySettings();

    // Priority: DB Settings -> Env Variables -> Ethereal (Mock)
    if (config.smtp_host && config.smtp_user) {
        return nodemailer.createTransport({
            host: config.smtp_host,
            port: parseInt(config.smtp_port) || 587,
            secure: config.smtp_port == 465,
            auth: {
                user: config.smtp_user,
                pass: config.smtp_pass
            }
        });
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_PORT == 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    // Default to Ethereal (Mock)
    let testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass }
    });
};

// --- WhatsApp Configuration ---
const getTwilioClient = async () => {
    const config = await getGatewaySettings();

    if (config.twilio_sid && config.twilio_token) {
        return { 
            client: twilio(config.twilio_sid, config.twilio_token),
            from: config.twilio_phone || '+14155238886'
        };
    }

    if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
        return {
            client: twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN),
            from: process.env.TWILIO_PHONE || '+14155238886'
        };
    }
    return null;
};

// --- Variable Substitution Helper ---
function replaceVariables(text, lead) {
    if (!text || !lead) return text;
    return text
        .replace(/{{name}}/g, lead.name || '')
        .replace(/{{email}}/g, lead.email || '')
        .replace(/{{phone}}/g, lead.phone || '')
        .replace(/{{source}}/g, lead.source || '');
}

// --- Core Execution Logic ---

async function sendEmail(to, subject, body, leadId, autoId) {
    try {
        const lead = leadId ? db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) : null;
        
        // Apply variable substitution
        const renderedSubject = replaceVariables(subject, lead);
        const renderedBody = replaceVariables(body, lead);

        const config = await getGatewaySettings();
        const transporter = await createTransporter();
        
        // Priority: DB FROM -> Env FROM -> Default
        const fromEmail = config.smtp_from || process.env.SMTP_FROM || config.smtp_user || 'no-reply@simplefunnel.com';
        const fromName = config.smtp_from_name || "SimpleFunnel CRM";

        const info = await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject: renderedSubject,
            text: renderedBody,
            html: renderedBody.replace(/\n/g, '<br>')
        });

        const logMsg = `[Email Sent] To: ${to} | Subject: ${renderedSubject}. URL: ${info.envelope && info.envelope.from.includes('ethereal') ? nodemailer.getTestMessageUrl(info) : 'Live'}`;
        
        if (info.envelope && info.envelope.from.includes('ethereal')) {
            console.log('--- WARNING: Sending in MOCK MODE (Ethereal) ---');
        }

        console.log(logMsg);
        db.prepare('INSERT INTO logs (lead_id, automation_id, message) VALUES (?, ?, ?)').run(leadId, autoId, logMsg);
        if (info.envelope && info.envelope.from.includes('ethereal')) return false; 
        return true;
    } catch (err) {
        console.error('[Email Error]', err);
        return false;
    }
}

async function sendWhatsApp(to, message, leadId, autoId) {
    try {
        const lead = leadId ? db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) : null;
        const renderedMessage = replaceVariables(message, lead);

        const twilioData = await getTwilioClient();
        if (twilioData) {
            await twilioData.client.messages.create({
                from: `whatsapp:${twilioData.from}`,
                to: `whatsapp:${to}`,
                body: renderedMessage
            });
            const logMsg = `[WhatsApp Sent] To: ${to} | Content: ${renderedMessage.substring(0, 30)}...`;
            db.prepare('INSERT INTO logs (lead_id, automation_id, message) VALUES (?, ?, ?)').run(leadId, autoId, logMsg);
        } else {
            const logMsg = `[WhatsApp Simulation] To: ${to} | Content: ${renderedMessage} (No Twilio keys found)`;
            console.log(logMsg);
            db.prepare('INSERT INTO logs (lead_id, automation_id, message) VALUES (?, ?, ?)').run(leadId, autoId, logMsg);
        }
        return true;
    } catch (err) {
        console.error('[WhatsApp Error]', err);
        return false;
    }
}

module.exports = { sendEmail, sendWhatsApp };
