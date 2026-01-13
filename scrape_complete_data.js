const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeAllTeamsWithDetails() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Handle alert popups
    page.on('dialog', async dialog => {
        console.log(`Alert: "${dialog.message()}"`);
        await dialog.accept();
    });
    
    // Step 1: Get all events and team links
    await page.goto('https://www.tabroom.com/index/tourn/fields.mhtml?tourn_id=36610');
    await page.waitForTimeout(3000);
    
    const events = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="event_id"]')).map(link => ({
            text: link.textContent.trim(),
            href: link.href
        }));
    });
    
    console.log(`Found ${events.length} events`);
    let allTeamData = [];
    
    // Step 2: Process each event
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
        const event = events[eventIndex];
        console.log(`\nProcessing event ${eventIndex + 1}: ${event.text}`);
        
        await page.goto(event.href);
        await page.waitForTimeout(3000);
        
        const teamLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="team_results"]')).map(link => link.href);
        });
        
        console.log(`Found ${teamLinks.length} teams in ${event.text}`);
        
        // Step 3: Process each team
        for (let i = 0; i < teamLinks.length; i++) {
            console.log(`Team ${i + 1}/${teamLinks.length} from ${event.text}`);
            
            await page.goto(teamLinks[i], { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Get team name
            const teamName = await page.evaluate(() => {
                return document.querySelector('h3')?.textContent.trim() || 'Unknown Team';
            });
            
            // Find tournaments to click
            const tournaments = await page.evaluate(() => {
                const cells = Array.from(document.querySelectorAll('td'));
                return cells.filter(cell => 
                    cell.textContent.includes('Memorial') || 
                    cell.textContent.includes('Invitational') ||
                    cell.textContent.includes('Championship') ||
                    cell.textContent.includes('Tournament')
                ).map(cell => cell.textContent.trim());
            });
            
            let teamTournamentDetails = [];
            
            // Step 4: Click each tournament for details
            for (const tournament of tournaments.slice(0, 5)) { // Limit to 5 tournaments per team
                await page.evaluate((tournamentText) => {
                    const cells = Array.from(document.querySelectorAll('td'));
                    const cell = cells.find(c => c.textContent.trim() === tournamentText);
                    if (cell) cell.click();
                }, tournament);
                
                await page.waitForTimeout(2000);
                
                const roundData = await page.evaluate(() => {
                    const tables = document.querySelectorAll('table');
                    const data = [];
                    
                    tables.forEach(table => {
                        if (table.innerText.includes('Round') && table.innerText.includes('Judge')) {
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
                        }
                    });
                    
                    return data;
                });
                
                if (roundData.length > 0) {
                    teamTournamentDetails.push({
                        tournament: tournament,
                        rounds: roundData
                    });
                }
            }
            
            allTeamData.push({
                event: event.text,
                teamName: teamName,
                url: teamLinks[i],
                tournamentDetails: teamTournamentDetails
            });
        }
    }
    
    // Save comprehensive results
    fs.writeFileSync('complete_team_data.json', JSON.stringify(allTeamData, null, 2));
    
    let csvContent = 'Event,Team,Tournament,Round,Division,Side,Opponent,Judge,Decision,Speaker1,Speaker2\n';
    allTeamData.forEach(team => {
        team.tournamentDetails.forEach(tournament => {
            tournament.rounds.forEach(round => {
                const escapedRow = round.map(cell => 
                    cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell
                ).join(',');
                csvContent += `"${team.event}","${team.teamName}","${tournament.tournament}","${escapedRow}"\n`;
            });
        });
    });
    
    fs.writeFileSync('complete_team_data.csv', csvContent);
    
    console.log(`\nCompleted! Scraped ${allTeamData.length} teams with detailed tournament data`);
    console.log('Data saved to complete_team_data.json and complete_team_data.csv');
    
    await browser.close();
}

scrapeAllTeamsWithDetails();