import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateForest, readCalendar, renderForest } from './contribution-forest.mjs';

function fixture(active = true, length = 365) {
  const weeks = [];
  const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
  let totalContributions = 0;
  for (let i = 0; i < length; i++) {
    const date = new Date(Date.UTC(2025, 9, 22 + i));
    if (!weeks.length || date.getUTCDay() === 0) weeks.push({ contributionDays: [] });
    const count = active ? i % 5 : 0;
    totalContributions += count;
    weeks.at(-1).contributionDays.push({ date: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), contributionCount: count, contributionLevel: levels[count] });
  }
  return { data: { user: { contributionsCollection: { contributionCalendar: { totalContributions, weeks } } } } };
}

test('maps a partial first week by weekday and renders all real days deterministically', () => {
  const calendar = readCalendar(fixture());
  const svg = renderForest(calendar, 'izzoel');
  assert.equal(calendar.days[0].weekday, 3);
  assert.equal(calendar.days.length, 365);
  assert.equal((svg.match(/xlink:href="#tree-/g) || []).length, calendar.days.filter((d) => d.level).length);
  assert.equal((svg.match(/<title>202[56]-/g) || []).length, 365 + 292);
  assert.match(svg, /730 contributions/);
  assert.match(svg, /2025-10-22 — 2026-10-21/);
  assert.equal(svg, renderForest(calendar, 'izzoel'));
  assert.ok(!svg.includes('<script'));
  assert.match(renderForest(calendar, '<bad&>'), /&lt;bad&amp;&gt;/);
});

test('zero-activity calendar remains valid and has no trees', () => {
  const svg = renderForest(readCalendar(fixture(false)), 'izzoel');
  assert.ok(!svg.includes('xlink:href="#tree-'));
  assert.match(svg, /0 contributions/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('lush crowns stay below the header even with maximum activity at the start of the year', () => {
  const payload = fixture();
  const calendar = payload.data.user.contributionsCollection.contributionCalendar;
  for (const day of calendar.weeks.flatMap((week) => week.contributionDays)) {
    day.contributionCount = 100;
    day.contributionLevel = 'FOURTH_QUARTILE';
  }
  calendar.totalContributions = 36500;
  const svg = renderForest(readCalendar(payload), 'izzoel');
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const trees = [...svg.matchAll(/href="#tree-4-\d" transform="translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)"/g)];
  assert.equal(trees.length, 365);
  for (const [, x, y, scale] of trees) {
    assert.ok(Number(y) - 169 * Number(scale) >= 145, 'crown must not overlap the title');
    assert.ok(Number(x) - 70 * Number(scale) > 0 && Number(x) + 70 * Number(scale) < 1600, 'crown must fit inside the banner');
  }
  assert.match(svg, /id="river" d="M[^\"]*C/);
});

test('accepts GitHub calendars padded to the beginning of the first week and leap years', () => {
  for (const length of [366, 368, 372]) assert.equal(readCalendar(fixture(true, length)).days.length, length);
});

test('rejects API errors, missing users, incomplete data and inconsistent totals', () => {
  for (const payload of [{ errors: [{ message: 'rate limit' }] }, { data: { user: null } }, {}]) assert.throws(() => readCalendar(payload));
  const payload = fixture();
  payload.data.user.contributionsCollection.contributionCalendar.totalContributions++;
  assert.throws(() => readCalendar(payload), /inconsistent/);
  const short = fixture();
  short.data.user.contributionsCollection.contributionCalendar.weeks.pop();
  assert.throws(() => readCalendar(short));
});

test('rejects invalid dates, counts, levels, duplicates and weekday mismatches', () => {
  for (const patch of [{ date: '2025-02-30' }, { contributionCount: -1 }, { contributionCount: 0.5 }, { contributionLevel: 'BAD' }, { weekday: 6 }, { contributionCount: 2 }]) {
    const payload = fixture();
    Object.assign(payload.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays[0], patch);
    assert.throws(() => readCalendar(payload));
  }
  const payload = fixture();
  const days = payload.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays;
  days[1] = { ...days[0] };
  assert.throws(() => readCalendar(payload));
});

test('API failures preserve the previous SVG; valid responses replace it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'contribution-forest-'));
  const cwd = process.cwd();
  const previousToken = process.env.GH_TOKEN;
  const previousUsername = process.env.GITHUB_USERNAME;
  t.after(async () => {
    process.chdir(cwd);
    if (previousToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousToken;
    if (previousUsername === undefined) delete process.env.GITHUB_USERNAME;
    else process.env.GITHUB_USERNAME = previousUsername;
    await rm(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  process.env.GH_TOKEN = 'test-only';
  process.env.GITHUB_USERNAME = 'izzoel';
  await writeFile('contribution-forest.svg', 'previous-good-svg');
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  await assert.rejects(generateForest(), /HTTP 403/);
  assert.equal(await readFile('contribution-forest.svg', 'utf8'), 'previous-good-svg');
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ errors: [{ message: 'rate limit' }] }) }));
  await assert.rejects(generateForest(), /GraphQL/);
  assert.equal(await readFile('contribution-forest.svg', 'utf8'), 'previous-good-svg');
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => fixture() }));
  await generateForest();
  assert.equal(await readFile('contribution-forest.svg', 'utf8'), renderForest(readCalendar(fixture()), 'izzoel'));
});
