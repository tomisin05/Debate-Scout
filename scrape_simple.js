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
            
            // Extract text starting from Wyoming onwards
            const teamContent = await page.evaluate(() => {
                const content = document.body.innerText;
                
                // Find "Wyoming" and extract everything after it
                const wyomingIndex = content.indexOf('Wyoming');
                if (wyomingIndex === -1) return 'Wyoming not found';
                
                // Find "Account Untrusted" to know where to stop
                const endPattern = /Account Untrusted/;
                const endMatch = content.match(endPattern);
                
                if (!endMatch) return 'Account Untrusted not found';
                
                // Extract from Wyoming to Account Untrusted
                const startIndex = wyomingIndex;
                const endIndex = endMatch.index;
                
                return content.substring(startIndex, endIndex).trim();
            });
            
            output += `\n${'='.repeat(60)}\n`;
            output += `TEAM: ${team.name}\n`;
            output += `${'='.repeat(60)}\n`;
            output += teamContent;
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
        fs.writeFileSync('cornell_raw_content.txt', result);
        console.log('\nData saved to cornell_raw_content.txt');
    });