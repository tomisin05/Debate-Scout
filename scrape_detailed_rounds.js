const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeDetailedRounds() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    await page.goto('https://www.tabroom.com/index/results/team_results.mhtml?id1=1711795&id2=1712548');
    await page.waitForTimeout(3000);
    
    let allRoundData = [];
    
    // Find all tournament cells
    const tournaments = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('td'));
        return cells.filter(cell => 
            cell.textContent.includes('Memorial') || 
            cell.textContent.includes('Invitational') ||
            cell.textContent.includes('Championship') ||
            cell.textContent.includes('Tournament') ||
            cell.textContent.includes('FR Shirley') ||
            cell.textContent.includes('West Point')
        ).map(cell => cell.textContent.trim()).slice(0, 5); // Limit to first 5
    });
    
    console.log(`Found ${tournaments.length} tournaments to check`);
    
    for (let i = 0; i < tournaments.length; i++) {
        const tournament = tournaments[i];
        console.log(`\nClicking on tournament ${i + 1}: ${tournament.substring(0, 50)}...`);
        
        // Click on tournament
        await page.evaluate((tournamentText) => {
            const cells = Array.from(document.querySelectorAll('td'));
            const cell = cells.find(c => c.textContent.trim() === tournamentText);
            if (cell) cell.click();
        }, tournament);
        
        await page.waitForTimeout(2000);
        
        // Extract round data from modal/popup
        const roundData = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            const roundTables = Array.from(tables).filter(table => 
                table.innerText.includes('Round') && table.innerText.includes('Judge')
            );
            
            if (roundTables.length === 0) return null;
            
            const data = [];
            roundTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length > 0) {
                        const rowData = Array.from(cells).map(cell => 
                            cell.textContent.trim().replace(/\s+/g, ' ')
                        );
                        if (rowData.some(cell => cell.length > 0)) {
                            data.push(rowData);
                        }
                    }
                });
            });
            
            return data;
        });
        
        if (roundData && roundData.length > 0) {
            console.log(`Found ${roundData.length} rows of round data`);
            allRoundData.push({
                tournament: tournament,
                rounds: roundData
            });
        } else {
            console.log('No round data found');
        }
        
        // Close modal if needed
        await page.evaluate(() => {
            const closeButtons = document.querySelectorAll('[class*="close"], [onclick*="close"]');
            if (closeButtons.length > 0) closeButtons[0].click();
        });
        
        await page.waitForTimeout(1000);
    }
    
    // Save results
    fs.writeFileSync('detailed_rounds.json', JSON.stringify(allRoundData, null, 2));
    
    let csvContent = 'Tournament,Round,Division,Side,Opponent,Judge,Decision,Speaker1,Speaker2\n';
    allRoundData.forEach(tournament => {
        tournament.rounds.forEach(round => {
            const escapedRow = round.map(cell => 
                cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell
            ).join(',');
            csvContent += `"${tournament.tournament}","${escapedRow}"\n`;
        });
    });
    
    fs.writeFileSync('detailed_rounds.csv', csvContent);
    
    console.log(`\nScraped detailed rounds for ${allRoundData.length} tournaments`);
    console.log('Data saved to detailed_rounds.json and detailed_rounds.csv');
    
    await browser.close();
}

scrapeDetailedRounds();