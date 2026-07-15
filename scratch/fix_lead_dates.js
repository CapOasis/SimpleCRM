const db = require('../db');

async function fixDates() {
    console.log('--- Starting Lead Date Correction ---');
    
    // 1. Get all leads with custom data
    const leads = db.prepare('SELECT id, custom_data, created_at FROM leads WHERE custom_data IS NOT NULL').all();
    console.log(`Found ${leads.length} leads to check.`);

    let updatedCount = 0;
    const updateStmt = db.prepare('UPDATE leads SET created_at = ? WHERE id = ?');

    const transaction = db.transaction((list) => {
        for (const lead of list) {
            try {
                const data = JSON.parse(lead.custom_data);
                
                // Common Meta/Google Sheets date keys
                const sourceDate = data.created_time || data.created_at || data.Timestamp || data.date || data.Date;
                
                if (sourceDate) {
                    // Convert to ISO or SQL friendly format if possible
                    // SQLite handles ISO-8601 well
                    let finalDate = sourceDate;
                    
                    // If it's a Meta style date (2026-03-14T23:23:09+05:30), 
                    // we can use it directly or clean it slightly.
                    // SQLite works best with YYYY-MM-DD HH:MM:SS or ISO
                    
                    // Simple check to see if it's already a date-like string
                    if (new Date(sourceDate).getTime()) {
                        updateStmt.run(sourceDate, lead.id);
                        updatedCount++;
                    }
                }
            } catch (e) {
                // Skip if JSON is malformed
            }
        }
    });

    transaction(leads);
    
    console.log(`--- Finished! Updated ${updatedCount} leads with their original source timestamps. ---`);
}

fixDates().catch(console.error);
