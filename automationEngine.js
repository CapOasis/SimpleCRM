const { Resend } = require('resend');
const db = require('./db');
require('dotenv').config();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

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
        let lead = null;
        if (leadId) {
            const { data } = await db.from('leads').select('*').eq('id', leadId).single();
            lead = data;
        }
        
        // Apply variable substitution
        const renderedSubject = replaceVariables(subject, lead);
        const renderedBody = replaceVariables(body, lead);

        const fromEmail = 'onboarding@resend.dev';
        const fromName = 'SimpleFunnel CRM';

        const response = await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to,
            subject: renderedSubject,
            text: renderedBody,
            html: renderedBody.replace(/\n/g, '<br>')
        });

        if (response.error) {
            throw new Error(response.error.message || JSON.stringify(response.error));
        }

        const logMsg = `[Email Sent via Resend] To: ${to} | Subject: ${renderedSubject} | Message ID: ${response.data.id}`;
        console.log(logMsg);
        
        await db.from('logs').insert([{ lead_id: leadId, automation_id: autoId, message: logMsg }]);
        return true;
    } catch (err) {
        console.error('[Email Error via Resend]', err);
        const errLogMsg = `[Email Failed] To: ${to} | Error: ${err.message}`;
        await db.from('logs').insert([{ lead_id: leadId, automation_id: autoId, message: errLogMsg }]);
        return false;
    }
}

const getTwilioClient = async () => {
    try {
        const { data: configRows } = await db.from('settings').select('key, value');
        const config = {};
        (configRows || []).forEach(s => config[s.key] = s.value);

        if (config.twilio_sid && config.twilio_token) {
            const twilio = require('twilio');
            return { 
                client: twilio(config.twilio_sid, config.twilio_token),
                from: config.twilio_phone || '+14155238886'
            };
        }

        if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
            const twilio = require('twilio');
            return {
                client: twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN),
                from: process.env.TWILIO_PHONE || '+14155238886'
            };
        }
    } catch (e) {
        console.error('[Twilio Config Error]', e);
    }
    return null;
};

async function sendWhatsApp(to, message, leadId, autoId) {
    try {
        let lead = null;
        if (leadId) {
            const { data } = await db.from('leads').select('*').eq('id', leadId).single();
            lead = data;
        }
        const renderedMessage = replaceVariables(message, lead);

        const twilioData = await getTwilioClient();
        if (twilioData) {
            await twilioData.client.messages.create({
                from: `whatsapp:${twilioData.from}`,
                to: `whatsapp:${to}`,
                body: renderedMessage
            });
            const logMsg = `[WhatsApp Sent] To: ${to} | Content: ${renderedMessage.substring(0, 30)}...`;
            await db.from('logs').insert([{ lead_id: leadId, automation_id: autoId, message: logMsg }]);
        } else {
            const logMsg = `[WhatsApp Simulation] To: ${to} | Content: ${renderedMessage} (No Twilio keys found)`;
            console.log(logMsg);
            await db.from('logs').insert([{ lead_id: leadId, automation_id: autoId, message: logMsg }]);
        }
        return true;
    } catch (err) {
        console.error('[WhatsApp Error]', err);
        return false;
    }
}

module.exports = { sendEmail, sendWhatsApp };
