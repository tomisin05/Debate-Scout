const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeTabroomTeamResults() {
    try {
        const browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();
        
        console.log('Navigating to team results page...');
        await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1711795&id2=1712548', { 
            waitUntil: 'domcontentloaded' 
        });
        await page.waitForTimeout(3000);
        
        // Extract all table data in order
        const results = await page.evaluate(() => {
            const data = [];
            
            // Find all tables on the page
            const tables = document.querySelectorAll('table');
            
            tables.forEach((table, tableIndex) => {
                const rows = table.querySelectorAll('tr');
                
                rows.forEach((row, rowIndex) => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length > 0) {
                        const rowData = Array.from(cells).map(cell => {
                            // Get text content and clean it up
                            let text = cell.textContent.trim();
                            // Remove extra whitespace and newlines
                            text = text.replace(/\s+/g, ' ');
                            return text;
                        });
                        
                        // Only add non-empty rows
                        if (rowData.some(cell => cell.length > 0)) {
                            data.push({
                                tableIndex,
                                rowIndex,
                                data: rowData
                            });
                        }
                    }
                });
            });
            
            return data;
        });
        
        // Also get page title and any headers
        const pageInfo = await page.evaluate(() => {
            return {
                title: document.title,
                h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()),
                h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()),
                h3: Array.from(document.querySelectorAll('h3')).map(h => h.textContent.trim())
            };
        });
        
        console.log('Page Info:', pageInfo);
        console.log(`Found ${results.length} rows of data`);
        
        // Convert to CSV format
        let csvContent = '';
        
        // Add headers if available
        if (pageInfo.title) {
            csvContent += `# ${pageInfo.title}\n`;
        }
        
        // Add data rows
        results.forEach(result => {
            const csvRow = result.data.map(cell => {
                // Escape quotes and wrap in quotes if contains comma
                if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                    return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
            }).join(',');
            csvContent += csvRow + '\n';
        });
        
        // Save to file
        fs.writeFileSync('team_results_scraped.csv', csvContent);
        console.log('Data saved to team_results_scraped.csv');
        
        // Also save raw JSON for debugging
        fs.writeFileSync('team_results_raw.json', JSON.stringify({
            pageInfo,
            results
        }, null, 2));
        console.log('Raw data saved to team_results_raw.json');
        
        await browser.close();
        return results;
        
    } catch (error) {
        console.log('Error:', error.message);
        return null;
    }
}

scrapeTabroomTeamResults();