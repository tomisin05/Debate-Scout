const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeAllCornellTeams(username, password) {
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
            })).filter(link => !link.href.includes('/All'));
        });
        
        let output = '';
        
        // Visit each team page
        for (const team of teamLinks) {
            console.log(`Scraping team: ${team.name}`);
            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Extract content starting from the team path
            const teamContent = await page.evaluate(() => {
                const content = document.body.innerText;
                
                // Look for the pattern "/ ndtceda25 / Cornell /"
                const pathPattern = /\/\s*ndtceda25\s*\/\s*Cornell\s*\//;
                const pathMatch = content.match(pathPattern);
                
                if (!pathMatch) return 'Team path not found';
                
                // Find the LAST occurrence of "Account Untrusted"
                const lastAccountIndex = content.lastIndexOf('Account Untrusted');
                
                if (lastAccountIndex === -1) return 'Account Untrusted not found';
                
                // Extract from path to the last Account Untrusted
                const startIndex = pathMatch.index;
                const endIndex = lastAccountIndex;
                
                return {
                    content: content.substring(startIndex, endIndex).trim(),
                    startIndex: startIndex,
                    endIndex: endIndex,
                    pathMatch: pathMatch[0],
                    contentLength: content.length
                };
            });
            
            console.log(`Start Index: ${teamContent.startIndex}`);
            console.log(`End Index: ${teamContent.endIndex}`);
            console.log(`Path Match: "${teamContent.pathMatch}"`);
            console.log(`Content Length: ${teamContent.contentLength}`);
            
            output += `\n${'='.repeat(60)}\n`;
            output += `TEAM: ${team.name}\n`;
            output += `Start: ${teamContent.startIndex}, End: ${teamContent.endIndex}\n`;
            output += `${'='.repeat(60)}\n`;
            output += teamContent.content;
            output += '\n\n';
        }
        
        await browser.close();
        return output;
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

const username = 'tyur55357@gmail.com';
const password = 'Debate-Scrapper';

scrapeAllCornellTeams(username, password)
    .then(result => {
        console.log(result);
        fs.writeFileSync('cornell_team_content.txt', result);
        console.log('\nData saved to cornell_team_content.txt');
    });