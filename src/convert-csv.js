// Simple script to convert CSV to JSON data
const fs = require('fs');
const path = require('path');

// Read the CSV file
const csvPath = path.join(__dirname, '..', 'all_schools_rounds_02.csv');
const csvContent = fs.readFileSync(csvPath, 'utf8');

// Simple CSV parser (handles quoted fields)
function parseCSV(csvText) {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = parseCSVLine(lines[i]);
            if (values.length >= 7) {
                const row = {
                    school: values[0] ? values[0].trim() : '',
                    team: values[1] ? values[1].trim() : '',
                    tournament: values[2] ? values[2].trim() : '',
                    round: values[3] ? values[3].trim() : '',
                    side: values[4] ? values[4].trim() : '',
                    opponent: values[5] ? values[5].trim() : '',
                    judge: values[6] ? values[6].trim() : '',
                    roundReport: values[8] ? values[8].trim() : '' // Use column 8 for roundReport
                };
                data.push(row);
            }
        }
    }
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// Parse the CSV
const data = parseCSV(csvContent);

// Write to data.json
fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));
console.log(`Converted ${data.length} records to data.json`);