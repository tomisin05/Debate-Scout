const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeAllGeorge_MasonTeams(username, password) {
    try {
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        page.setDefaultTimeout(60000);
        
        // Login
        await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        
        // Navigate to tournament page
        await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        
        // Click on George Mason
        await page.waitForSelector('a[href*="GeorgeMason"]', { timeout: 10000 });
        await page.click('a[href*="GeorgeMason"]');
        await page.waitForTimeout(3000);
        
        // Get all team links - filter out Aff/Neg only links
        const teamLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/GeorgeMason/"]'));
            return links.map(link => ({
                name: link.textContent.trim(),
                href: link.href
            })).filter(link => 
                !link.href.includes('/All') && 
                link.name !== 'Aff' && 
                link.name !== 'Neg'
            );
        });
        
        const allRounds = [];
        
        // Visit each team page
        for (const team of teamLinks) {
            console.log(`Scraping team: ${team.name}`);
            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Extract round report table data
            const roundData = await page.evaluate(() => {
                const content = document.body.innerText;

                // Find rounds between "Round ReportExpand All" and "Account Untrusted"
                const startPattern = /Round ReportExpand All/;
                
                const startMatch = content.match(startPattern);

                // Find the LAST occurrence of "Account Untrusted"
                const lastAccountIndex = content.lastIndexOf('Account Untrusted');
                
                if (!startMatch || lastAccountIndex === -1) return null;
                
                const relevantSection = content.substring(startMatch.index, lastAccountIndex);
                
                // Extract tournament rounds - look for pattern: tournament name followed by Round X
                const rounds = [];
                const lines = relevantSection.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    
                    // Look for lines with tab-separated tournament data
                    if (line.includes('\t') && (line.includes('Aff') || line.includes('Neg'))) {
                        const parts = line.split('\t').filter(p => p.trim());
                        
                        if (parts.length >= 3) {
                            const tournament = parts[0];
                            const round = parts[1];
                            const side = parts[2];
                            const opponent = parts[3] || '';
                            const judge = parts[4] || '';
                            
                            // Get round report from next line
                            let roundReport = '';
                            if (i + 1 < lines.length) {
                                roundReport = lines[i + 1].trim();
                            }
                            
                            rounds.push({
                                tournament,
                                round,
                                side,
                                opponent,
                                judge,
                                roundReport
                            });
                        }
                    }
                }
                
                return rounds;
            });
            
            if (roundData && roundData.length > 0) {
                roundData.forEach(round => {
                    allRounds.push({
                        team: team.name,
                        tournament: round.tournament,
                        round: round.round,
                        side: round.side,
                        opponent: round.opponent,
                        judge: round.judge,
                        roundReport: round.roundReport
                    });
                });
            }
        }
        
        await browser.close();
        return allRounds;
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

function arrayToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header] || '';
                // Escape quotes and wrap in quotes if contains comma or quote
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');
    
    return csvContent;
}

const username = 'tyur55357@gmail.com';
const password = 'Debate-Scrapper';

scrapeAllGeorge_MasonTeams(username, password)
    .then(result => {
        if (typeof result === 'string') {
            console.log('Error:', result);
        } else {
            const csvContent = arrayToCSV(result);
            fs.writeFileSync('george_Mason_rounds.csv', csvContent);
            console.log(`\nData saved to george_Mason_rounds.csv (${result.length} rounds)`);
        }
    });