/**
 * scrape-recent.mjs
 * Scrapes /ndtceda26/recent (or any year's /recent page) and merges
 * newly updated team rounds into the existing data file.
 *
 * Usage:
 *   node scrape-recent.mjs --year ndtceda26
 *   node scrape-recent.mjs --year ndtceda26 --output data_ndtceda26.json
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        year: 'ndtceda26',
        output: null,
        pageDelay: 2000,
        username: process.env.OPENCASELIST_USERNAME,
        password: process.env.OPENCASELIST_PASSWORD,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--year')   opts.year   = args[++i];
        if (args[i] === '--output') opts.output = args[++i];
        if (args[i] === '--username') opts.username = args[++i];
        if (args[i] === '--password') opts.password = args[++i];
    }
    opts.output = opts.output || `public/data_${opts.year}.json`;
    return opts;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = ms => sleep(ms * (0.6 + Math.random() * 0.8));

function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function login(browser, username, password) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
    await page.$eval('input[name="username"]', el => el.value = '');
    await page.type('input[name="username"]', username, { delay: 30 });
    await page.$eval('input[name="password"]', el => el.value = '');
    await page.type('input[name="password"]', password, { delay: 30 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null),
        page.click('button[type="submit"]'),
    ]);
    await sleep(2000);
    const failed = new URL(page.url()).pathname === '/login' || await page.$('input[name="password"]') !== null;
    if (failed) { await page.close(); throw new Error('Login failed.'); }
    return page;
}

// ─── Discover recently modified teams ────────────────────────────────────────

async function getRecentTeams(page, yearSlug) {
    console.log(`\nFetching https://opencaselist.com/${yearSlug}/recent …`);
    await page.goto(`https://opencaselist.com/${yearSlug}/recent`, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // Reload if page looks thin (SPA hydration delay)
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    if (bodyLen < 300) {
        console.log('  Page thin, reloading…');
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(3000);
    }

    const teams = await page.evaluate((slug) => {
        // Team links look like /ndtceda26/SchoolSlug/TeamSlug
        const seen = new Set();
        return Array.from(document.querySelectorAll('a[href]'))
            .filter(a => {
                const m = a.href.match(new RegExp(`/${slug}/([^/]+)/([^/]+)$`));
                return m && !a.href.includes('/All') && !a.href.includes('/recent');
            })
            .map(a => {
                const m = a.href.match(new RegExp(`/${slug}/([^/]+)/([^/]+)$`));
                return {
                    href: a.href,
                    schoolSlug: m[1],
                    teamSlug: m[2],
                    label: a.textContent.trim(),
                };
            })
            .filter(t => {
                if (seen.has(t.href)) return false;
                seen.add(t.href);
                return t.label && t.label !== 'Aff' && t.label !== 'Neg';
            });
    }, yearSlug);

    console.log(`  Found ${teams.length} recently modified teams`);
    return teams;
}

// ─── Extract rounds from a team page ─────────────────────────────────────────

async function extractRounds(page) {
    return page.evaluate(() => {
        const HEADERS = ['Tournament', 'Round', 'Side'];
        const tables = Array.from(document.querySelectorAll('table'));
        const roundsTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(h => h.innerText.trim());
            return HEADERS.every(h => ths.includes(h));
        });
        if (!roundsTable) return [];
        if (document.body.innerText.includes('No rounds yet, add one!')) return [];

        return Array.from(roundsTable.querySelectorAll('tr')).slice(1).reduce((acc, row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return acc;
            const tournament = cells[0]?.innerText.trim();
            const round      = cells[1]?.innerText.trim();
            if (!tournament || !round) return acc;
            const side        = cells[2]?.innerText.trim() || '';
            const opponent    = cells[3]?.innerText.trim() || '';
            const judge       = cells[4]?.innerText.trim() || '';
            const roundReport = cells[5]?.innerText.trim() || '';
            let previewUrl = null, downloadUrl = null;
            if (cells[6]) {
                const link = cells[6].querySelector('a[href*="/preview"]');
                if (link) {
                    previewUrl = link.href;
                    try {
                        const p = new URLSearchParams(new URL(previewUrl).search).get('path');
                        if (p) downloadUrl = `https://api.opencaselist.com/v1/download?path=${encodeURIComponent(p)}`;
                    } catch {}
                }
            }
            acc.push({ tournament, round, side, opponent, judge, roundReport, previewUrl, downloadUrl });
            return acc;
        }, []);
    });
}

// ─── Resolve school name from slug ───────────────────────────────────────────

async function resolveSchoolName(page, yearSlug, schoolSlug) {
    // Try to get the display name from the school page heading
    try {
        await page.goto(`https://opencaselist.com/${yearSlug}/${schoolSlug}`, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        const name = await page.evaluate(() => {
            const h = document.querySelector('h1, h2, [class*="title"], [class*="heading"]');
            return h ? h.innerText.trim() : null;
        });
        if (name && name.length > 1) return name;
    } catch {}
    // Fallback: convert slug back to spaced name
    return schoolSlug.replace(/([A-Z])/g, ' $1').trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();
    if (!opts.username || !opts.password) {
        throw new Error('Set OPENCASELIST_USERNAME and OPENCASELIST_PASSWORD before running.');
    }

    console.log('═══ scrape-recent ═══');
    console.log(`Year:   ${opts.year}`);
    console.log(`Output: ${opts.output}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        // 1. Login and get recent team list
        let page = await login(browser, opts.username, opts.password);
        const recentTeams = await getRecentTeams(page, opts.year);

        if (recentTeams.length === 0) {
            console.log('No recently modified teams found. Exiting.');
            return;
        }

        // 2. Load existing data
        const data = loadJSON(opts.output, { meta: {}, rounds: [] });
        if (!Array.isArray(data.rounds)) data.rounds = [];

        // Build dedup key set
        const roundKey = r => `${r.year}|${r.school}|${r.team}|${r.tournament}|${r.round}|${r.side}`;
        const existingKeys = new Set(data.rounds.map(roundKey));

        // School slug → display name cache
        const schoolNameCache = {};

        let totalAdded = 0;

        // 3. Scrape each recently modified team
        for (const team of recentTeams) {
            try {
                // Resolve school display name (cached)
                if (!schoolNameCache[team.schoolSlug]) {
                    schoolNameCache[team.schoolSlug] = await resolveSchoolName(page, opts.year, team.schoolSlug);
                }
                const schoolName = schoolNameCache[team.schoolSlug];

                console.log(`\n  ${schoolName} / ${team.label} (${team.teamSlug})`);

                await page.goto(team.href, { waitUntil: 'networkidle2' });
                await jitter(opts.pageDelay);

                // Get team display name from page heading
                const teamName = await page.evaluate((fallback) => {
                    const h = document.querySelector('h1, h2, [class*="title"]');
                    return h ? h.innerText.trim() : fallback;
                }, team.label);

                const rounds = await extractRounds(page);
                console.log(`    ${rounds.length} rounds on page`);

                let added = 0;
                for (const r of rounds) {
                    const record = {
                        year: opts.year,
                        school: schoolName,
                        team: teamName,
                        ...r,
                        scrapedAt: new Date().toISOString(),
                    };
                    const k = roundKey(record);
                    if (!existingKeys.has(k)) {
                        data.rounds.push(record);
                        existingKeys.add(k);
                        added++;
                    }
                }
                totalAdded += added;
                console.log(`    +${added} new rounds (${totalAdded} total added so far)`);

                await jitter(500);
            } catch (err) {
                console.log(`  ✗ Error on ${team.href}: ${err.message}`);
            }
        }

        // 4. Save
        data.meta.lastUpdated = new Date().toISOString();
        data.meta.totalRounds = data.rounds.length;
        saveJSON(opts.output, data);

        console.log(`\n✔ Done. Added ${totalAdded} new rounds. Total: ${data.rounds.length} in ${opts.output}`);

    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
