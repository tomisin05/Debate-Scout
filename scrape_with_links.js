const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeOpenSourceLinks(username, password) {
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
        
        // Click on Cornell
        await page.waitForSelector('a[href*="Cornell"]', { timeout: 10000 });
        await page.click('a[href*="Cornell"]');
        await page.waitForTimeout(3000);
        
        // Get all team links
        const teamLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/Cornell/"]'));
            return links.map(link => ({
                name: link.textContent.trim(),
                href: link.href
            })).filter(link => 
                !link.href.includes('/All') && 
                link.name !== 'Aff' && 
                link.name !== 'Neg'
            );
        });
        
        const allData = [];
        
        // Visit each team page
        for (const team of teamLinks) {
            console.log(`Scraping team: ${team.name}`);
            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Enable console logging from the page
            page.on('console', msg => {
                console.log('PAGE LOG:', msg.text());
            });
            
            // Extract round data with open source links
            const roundData = await page.evaluate(() => {
                // Debug: Get all links on the page
                const allLinks = Array.from(document.querySelectorAll('a'));
                console.log('Total links found:', allLinks.length);
                
                const downloadLinks = allLinks.filter(link => 
                    link.href.includes('download') || 
                    link.href.includes('.docx') || 
                    link.href.includes('.pdf') || 
                    link.href.includes('.doc') ||
                    link.textContent.trim().toLowerCase().includes('download')
                );
                
                console.log('Download links found:', downloadLinks.length);
                downloadLinks.forEach(link => {
                    console.log('Download link:', link.href, '|', link.textContent.trim());
                });
                
                // Debug: Check page structure
                const tables = document.querySelectorAll('table');
                console.log('Tables found:', tables.length);
                
                const tableRows = Array.from(document.querySelectorAll('tr'));
                console.log('Table rows found:', tableRows.length);
                
                // Fall back to text parsing since table structure might not exist
                const content = document.body.innerText;
                const startPattern = /Round ReportExpand All/;
                const startMatch = content.match(startPattern);
                const lastAccountIndex = content.lastIndexOf('Account Untrusted');
                
                if (!startMatch || lastAccountIndex === -1) return [];
                
                const relevantSection = content.substring(startMatch.index, lastAccountIndex);
                const rounds = [];
                const lines = relevantSection.split('\n');
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    
                    if (line.includes('\t') && (line.includes('Aff') || line.includes('Neg'))) {
                        const parts = line.split('\t').filter(p => p.trim());
                        
                        if (parts.length >= 3) {
                            const tournament = parts[0];
                            const round = parts[1];
                            const side = parts[2];
                            const opponent = parts[3] || '';
                            const judge = parts[4] || '';
                            
                            let roundReport = '';
                            let openSourceUrl = '';
                            
                            if (i + 1 < lines.length) {
                                roundReport = lines[i + 1].trim();
                            }
                            
                            // Try to match download links based on tournament/round/side pattern
                            const matchingLink = downloadLinks.find(link => {
                                const url = link.href.toLowerCase();
                                const tournamentMatch = url.includes(tournament.toLowerCase().replace(/[^a-z0-9]/g, ''));
                                const roundMatch = url.includes(round.toLowerCase().replace(/[^a-z0-9]/g, ''));
                                const sideMatch = url.includes(side.toLowerCase());
                                
                                return tournamentMatch && roundMatch && sideMatch && url.includes('preview');
                            });
                            
                            if (matchingLink) {
                                openSourceUrl = matchingLink.href;
                                console.log('Matched link for', tournament, round, side, ':', openSourceUrl);
                            }
                            
                            rounds.push({
                                tournament,
                                round,
                                side,
                                opponent,
                                judge,
                                roundReport,
                                openSourceUrl
                            });
                        }
                    }
                }
                
                return rounds;
            });
            
            if (roundData && roundData.length > 0) {
                roundData.forEach(round => {
                    allData.push({
                        team: team.name,
                        tournament: round.tournament,
                        round: round.round,
                        side: round.side,
                        opponent: round.opponent,
                        judge: round.judge,
                        roundReport: round.roundReport,
                        openSourceUrl: round.openSourceUrl || ''
                    });
                });
            }
        }
        
        await browser.close();
        return allData;
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

scrapeOpenSourceLinks(username, password)
    .then(result => {
        if (typeof result === 'string') {
            console.log('Error:', result);
        } else {
            const csvContent = arrayToCSV(result);
            fs.writeFileSync('cornell_rounds_with_links.csv', csvContent);
            console.log(`\nData saved to cornell_rounds_with_links.csv (${result.length} rounds)`);
            
            // Show rounds with open source links
            const withLinks = result.filter(r => r.openSourceUrl);
            console.log(`Found ${withLinks.length} rounds with open source links`);
        }
    });