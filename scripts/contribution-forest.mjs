import { writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const point = (week, day) => [230 + week * 23 - day * 18, 245 + week * 6.3 + day * 12];
const polygon = (points, fill, extra = '') => `<polygon points="${points.map((p) => p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
const tile = (w, d, fill) => polygon([point(w, d), point(w + 0.93, d), point(w + 0.93, d + 0.9), point(w, d + 0.9)], fill);
const treeHeights = [0, 43, 64, 86, 112];
const treeRadii = [0, 23, 29, 35, 41];
const noise = (seed) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };

export function readCalendar(payload) {
  if (payload.errors?.length) throw new Error('GitHub GraphQL returned errors; keeping previous forest.');
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar || !Array.isArray(calendar.weeks) || calendar.weeks.length < 52 || calendar.weeks.length > 54) {
    throw new Error('Expected a full year of contribution weeks.');
  }
  const seen = new Set();
  let previous = null;
  const days = calendar.weeks.flatMap((week, column) => {
    if (!Array.isArray(week.contributionDays) || week.contributionDays.length < 1 || week.contributionDays.length > 7) throw new Error('Invalid week.');
    return week.contributionDays.map((day) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.date ||
          seen.has(day.date) || !Number.isInteger(day.contributionCount) || day.contributionCount < 0 ||
          !levels.includes(day.contributionLevel) || !Number.isInteger(day.weekday) || day.weekday !== date.getUTCDay() ||
          (day.contributionCount === 0) !== (day.contributionLevel === 'NONE') ||
          (previous !== null && date.getTime() - previous !== 86400000)) throw new Error('Invalid contribution day.');
      seen.add(day.date);
      previous = date.getTime();
      return { ...day, column, level: levels.indexOf(day.contributionLevel) };
    });
  });
  const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
  // GitHub includes the leading partial week around its one-year window.
  if (days.length < 365 || days.length > 372 || !Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions !== total) {
    throw new Error('Incomplete or inconsistent contribution calendar.');
  }
  return { days, total, columns: calendar.weeks.length };
}

function tree(level, variant) {
  const height = treeHeights[level];
  const radius = treeRadii[level];
  const colors = [[], ['#174b37', '#246a43', '#43874c', '#6fa357', '#8db965'], ['#19583c', '#337b46', '#53994e', '#7aaf59', '#a0c66c'], ['#19563c', '#347847', '#51964d', '#7ab35b', '#a4ce76'], ['#205b3d', '#3c7d45', '#5b9c4d', '#85b85e', '#b1d17a']][level];
  // Each profile describes irregular branch crowns: x, y, width and depth in canopy radii.
  const profiles = [
    [[-0.12, 0, 1.18, 0.62]],
    [[-0.36, 0.62, 0.76, 0.58], [0.3, 0, 0.76, 0.82]],
    [[-0.58, 0.22, 0.77, 0.57], [0.55, 0, 0.86, 0.61]],
    [[0.67, 0.78, 0.58, 0.47], [-0.32, 0, 1.08, 0.7]],
    [[-0.48, 0.87, 0.65, 0.44], [0.5, 0.47, 0.65, 0.5], [0, -0.03, 0.73, 0.7]],
    [[-0.62, 0.53, 0.65, 0.63], [0.42, 0, 0.96, 0.77]],
  ];
  const crowns = profiles[variant];
  let svg = `<linearGradient id="foliage-${level}-${variant}" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="${colors[2]}"/><stop offset="1" stop-color="${colors[0]}"/></linearGradient><g id="tree-${level}-${variant}"><ellipse cy="2" rx="${radius + 4}" ry="7" fill="#071510" opacity=".5"/>`;
  const lean = (variant - 2.5) * radius * 0.035;
  svg += `<path d="M-3,0 Q${lean - 2},-${height * 0.55} ${lean},-${height * 0.91} L${lean + 2},-${height * 0.91} Q${lean + 1},-${height * 0.55} 3,0Z" fill="#7f603d"/><path d="M0,-3 Q${lean + 1},-${height * 0.5} ${lean + 1},-${height * 0.84}" stroke="#b08a55" stroke-width="1.2" fill="none"/>`;
  for (const [dx, dy] of crowns) {
    const x = dx * radius, y = -height * 0.85 + dy * radius;
    svg += `<path d="M0,-${height * 0.34} Q${x * 0.2},${y + radius * 0.9} ${x},${y + radius * 0.1} M${x * 0.6},${y + radius * 0.5} l${radius * 0.32},-${radius * 0.35}" stroke="#937246" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
  }
  svg += '<path d="M-1,-15 L-8,2 L-2,-2 L0,2 L2,-3 L8,2 L2,-15" fill="#85623d"/><path d="M0,-12 L0,0 L5,1" stroke="#b08a55" fill="none"/>';
  for (let crown = 0; crown < crowns.length; crown++) {
    const [dx, dy, width, profileDepth] = crowns[crown];
    const depth = profileDepth * 1.6;
    const cx = dx * radius, cy = -height * 0.85 + dy * radius;
    const seed = variant * 997 + crown * 113 + level * 17;
    const edge = (angle) => 0.87 + 0.09 * Math.sin(angle * 7 + seed) + 0.07 * Math.cos(angle * 11 + seed * 0.7);
    const ring = Array.from({ length: 40 }, (_, i) => {
      const angle = i * Math.PI / 20;
      return [cx + Math.cos(angle) * radius * width * edge(angle), cy + Math.sin(angle) * radius * depth * edge(angle)];
    });
    let contour = `M${(ring.at(-1)[0] + ring[0][0]) / 2},${(ring.at(-1)[1] + ring[0][1]) / 2}`;
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length];
      contour += ` Q${ring[i].join(',')} ${(ring[i][0] + next[0]) / 2},${(ring[i][1] + next[1]) / 2}`;
    }
    svg += `<path class="canopy" d="${contour} Z" fill="url(#foliage-${level}-${variant})"/>`;
    const leaves = ['', '', '', '', ''];
    let veins = '';
    const count = Math.round((280 + level * 55) / crowns.length);
    for (let leaf = 0; leaf < count; leaf++) {
      const n = seed + leaf * 7;
      const angle = noise(n) * Math.PI * 2;
      const distance = leaf % 5 === 0 ? 0.91 + noise(n + 1) * 0.15 : Math.sqrt(noise(n + 1)) * 0.96;
      const x = cx + Math.cos(angle) * radius * width * edge(angle) * distance;
      const y = cy + Math.sin(angle) * radius * depth * edge(angle) * distance;
      const length = radius * (0.08 + noise(n + 2) * 0.1);
      const direction = noise(n + 3) * Math.PI * 2;
      const ex = Math.cos(direction) * length, ey = Math.sin(direction) * length;
      const bx = -ey * 0.35, by = ex * 0.35;
      const shade = Math.max(0, Math.min(4, Math.floor(2.3 - (y - cy) / (radius * depth) + noise(n + 4) * 1.9 - 0.95)));
      leaves[shade] += `M${x},${y} q${ex * 0.5 + bx},${ey * 0.5 + by} ${ex},${ey} q${-ex * 0.5 - bx},${-ey * 0.5 - by} ${-ex},${-ey}Z`;
      if (leaf % 7 === 0) veins += `M${x},${y} l${ex * 0.8},${ey * 0.8}`;
    }
    leaves.forEach((path, shade) => { svg += `<path d="${path}" fill="${colors[shade]}"/>`; });
    svg += `<path d="${veins}" stroke="${colors[4]}" stroke-width=".25" opacity=".4" fill="none"/>`;
  }
  return `${svg}</g>`;
}

function curve(points, start = 'M') {
  let path = `${start}${points[0].join(',')}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i], c = points[i + 1], d = points[Math.min(points.length - 1, i + 2)];
    path += ` C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (d[0] - b[0]) / 6},${c[1] - (d[1] - b[1]) / 6} ${c.join(',')}`;
  }
  return path;
}

const riverDay = (w, bank) => bank === 'near'
  ? 8.4 + Math.sin(w * 0.43) * 0.85 + Math.sin(w * 0.91) * 0.22
  : 11.55 + Math.sin(w * 0.38 + 0.8) * 0.9 + Math.sin(w * 0.83) * 0.32;

function fernSymbol() {
  let svg = '<g id="fern"><ellipse cy="2" rx="10" ry="3" fill="#102b22" opacity=".7"/>';
  for (let leaf = 0; leaf < 7; leaf++) {
    const dx = (leaf - 3) * 4;
    const dy = -13 + Math.abs(leaf - 3) * 2;
    svg += `<path d="M0,2 Q${dx * 0.25},${dy - 7} ${dx},${dy} Q${dx * 0.9},${dy + 6} 0,2" fill="${leaf % 2 ? '#628e49' : '#3a7344'}"/><path d="M0,2 Q${dx * 0.4},${dy - 1} ${dx},${dy}" stroke="#8aa85d" stroke-width=".55" fill="none"/>`;
  }
  return `${svg}</g>`;
}

const fern = (x, y, scale) => `<use xlink:href="#fern" transform="translate(${x},${y}) scale(${scale})"/>`;

export function renderForest(calendar, username) {
  const { days, total, columns } = calendar;
  const active = days.filter((day) => day.level > 0).length;
  const max = Math.max(...days.map((day) => day.contributionCount));
  const title = `${username}'s Kalimantan contribution forest`;
  const range = `${days[0].date} — ${days.at(-1).date}`;
  const riverEdge = Array.from({ length: columns + 1 }, (_, w) => point(w, riverDay(w, 'near')));
  const riverBank = Array.from({ length: columns + 1 }, (_, w) => point(w, riverDay(w, 'far'))).reverse();
  const waterPath = `${curve(riverEdge)} ${curve(riverBank, 'L')} Z`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="850" viewBox="0 0 1600 850" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title><desc id="desc">${escape(range)}. ${total} contributions across ${active} active days. One tile per day; larger tropical trees represent higher GitHub contribution levels. A river and a wooden stilt house evoke Kalimantan.</desc>
  <defs><linearGradient id="bg" x2="0.8" y2="1"><stop stop-color="#101c23"/><stop offset="1" stop-color="#0d1117"/></linearGradient><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2d7d7b"/><stop offset=".5" stop-color="#2d9390"/><stop offset="1" stop-color="#185859"/></linearGradient><clipPath id="river-clip"><path d="${waterPath}"/></clipPath>`;
  for (let level = 1; level <= 4; level++) for (let variant = 0; variant < 6; variant++) svg += tree(level, variant);
  svg += fernSymbol();
  svg += '</defs><rect width="1600" height="850" rx="18" fill="url(#bg)"/>';
  svg += `<g font-family="system-ui,Segoe UI,sans-serif"><text x="54" y="51" fill="#aec3c8" font-size="15" letter-spacing="5">${escape(username.toUpperCase())} / CONTRIBUTION FOREST</text><text x="51" y="111" fill="#b1e8c6" font-size="49" font-weight="650">A Year of Growing</text><text x="1545" y="51" fill="#9fb5bb" font-size="16" text-anchor="end">${range}</text><text x="1545" y="88" fill="#b1e8c6" font-size="25" text-anchor="end">${total.toLocaleString('en-US')} contributions</text><text x="1545" y="117" fill="#9fb5bb" font-size="15" text-anchor="end">${active} active days · ${max} on the busiest day</text></g>`;
  svg += `<path d="M${point(0, 0)} L${point(columns, 0)} ${curve([...riverEdge].reverse(), 'L')} Z" fill="#203c2c"/>`;
  svg += `<path id="river" d="${waterPath}" fill="url(#water)" stroke="#537f6b" stroke-width="3" stroke-linejoin="round"/>`;
  svg += `<path d="${curve(riverEdge)}" fill="none" stroke="#89ab91" stroke-width="1.2" opacity=".35"/>`;
  svg += '<g clip-path="url(#river-clip)">';
  const shallows = Array.from({ length: columns + 1 }, (_, w) => point(w, riverDay(w, 'near') + 0.45 + noise(w) * 0.45)).reverse();
  svg += `<path d="${curve(riverEdge)} ${curve(shallows, 'L')} Z" fill="#8ac2a5" opacity=".24"/>`;
  for (let w = 0; w < columns; w += 0.65) {
    for (let lane = 0; lane < 3; lane++) {
      if (noise(w * 13 + lane) < 0.35) continue;
      const near = riverDay(w, 'near'), far = riverDay(w, 'far');
      const d = near + (far - near) * (lane + noise(w * 7 + lane)) / 3;
      const [x, y] = point(w + noise(w + lane) * 0.5, d);
      const length = 5 + noise(w * 5 + lane) * 25;
      svg += `<path d="M${x},${y} q${length * 0.5},${-2 + Math.sin(w * 2)} ${length},${length * 0.27}" fill="none" stroke="${lane === 0 ? '#b1daca' : '#70c8bd'}" opacity="${0.12 + noise(w + lane) * 0.2}" stroke-width="${0.6 + noise(w * 3 + lane)}" stroke-linecap="round"/>`;
    }
  }
  svg += '</g>';
  const ground = ['#1b292a', '#203a32', '#224333', '#2b4a35', '#354f36'];
  for (const day of days) svg += `<g><title>${day.date}: ${day.contributionCount} contributions</title>${tile(day.column, day.weekday, ground[day.level])}</g>`;
  for (let w = 0.4; w < columns - 0.5; w += 0.49) {
    for (const bank of ['near', 'far']) {
      const seed = w * 17 + (bank === 'near' ? 13 : 71);
      const d = riverDay(w, bank) + (bank === 'near' ? -1 : 1) * noise(seed) * 0.23;
      const [x, y] = point(w + noise(seed + 1) * 0.3, d);
      const size = 2 + noise(seed + 2) * 6;
      if (noise(seed + 3) > 0.35) {
        svg += `<g transform="translate(${x},${y})"><ellipse cy="2" rx="${size + 2}" ry="${size * 0.5}" fill="#183d35" opacity=".65"/>${polygon([[-size, 0], [-size * 0.6, -size * 0.6], [size * 0.4, -size * 0.7], [size, -1], [size * 0.5, size * 0.4], [-size * 0.5, size * 0.4]], '#7c9184')}${polygon([[-size, 0], [-size * 0.6, -size * 0.6], [size * 0.4, -size * 0.7], [size * 0.3, 0]], '#a1ae95')}</g>`;
      }
      if (noise(seed + 4) > 0.3) svg += fern(x + size + 4, y - 1, 0.4 + noise(seed + 5));
    }
  }
  for (const day of [...days].sort((a, b) => point(a.column, a.weekday)[1] - point(b.column, b.weekday)[1])) {
    const [x, y] = point(day.column + 0.45, day.weekday + 0.45);
    const variant = Math.floor(noise(Number(day.date.replaceAll('-', ''))) * 6);
    if (day.level) {
      // Keep even a maximum-activity tree below the header as the yearly window moves.
      const scale = Math.min(0.76 + Math.sqrt(day.contributionCount / max) * 0.7, (y - 151) / (treeHeights[day.level] + treeRadii[day.level] * 1.4));
      svg += `<g><title>${day.date}: ${day.contributionCount} contributions</title>${fern(x - 5, y + 1, 0.5)}<use xlink:href="#tree-${day.level}-${variant}" transform="translate(${x},${y}) scale(${scale})"/></g>`;
    }
    else if (variant === 0) svg += `<path d="M${x},${y} l-2,-3 m2,3 l3,-2" stroke="#3a5645" fill="none"/>`;
  }
  const [hx, hy] = point(columns * 0.7, riverDay(columns * 0.7, 'near') + 0.8);
  svg += `<g transform="translate(${hx},${hy})"><path d="M-21,-12 V13 M-5,-7 V19 M24,-15 V7 M9,-1 V19" stroke="#977a57" stroke-width="2"/><path d="M-26,-14 L3,-24 L32,-9 L3,2Z" fill="#947750"/><path d="M-19,-17 V-40 L7,-30 V-6Z" fill="#ad8a5a"/><path d="M7,-30 L24,-40 V-17 L7,-6Z" fill="#6c654e"/><path d="M-26,-40 L-7,-60 L8,-52 L31,-36 L7,-29Z" fill="#b3a17c"/><path d="M-26,-40 L-7,-60 L8,-52 L7,-29Z" fill="#d0b78a"/><path d="M-9,-31 L-3,-29 V-18 L-9,-20Z" fill="#233c3a"/><path d="M13,-29 L19,-33 V-24 L13,-20Z" fill="#213636"/><path d="M-26,-14 L3,2 L32,-9" stroke="#c1a373" fill="none"/></g>`;
  svg += `<g font-family="system-ui,Segoe UI,sans-serif" fill="#9fb5bb"><text x="54" y="785" font-size="15" letter-spacing="4">KALIMANTAN · ${days.length} DAYS OF GROWTH</text><text x="54" y="816" font-size="14">Each tile is a day. Each tree grows with your contributions.</text><text x="1240" y="795" font-size="14">Less</text>`;
  ['#1b292a', '#30865a', '#298d63', '#65a953', '#a1cf70'].forEach((color, i) => {
    const x = 1295 + i * 38;
    svg += polygon([[x, 782], [x + 13, 789], [x, 796], [x - 13, 789]], color);
  });
  svg += '<text x="1480" y="795" font-size="14">More</text></g></svg>\n';
  // Hundredths of a pixel are enough for geometry; preserve user text verbatim.
  return svg.replace(/\b(points|d|transform|opacity|stroke-width|rx|ry|cx|cy|x|y)="([^"]*)"/g,
    (_, name, value) => `${name}="${value.replace(/(-?\d+\.\d{2})\d+/g, '$1')}"`);
}

export async function generateForest() {
  const username = process.env.GITHUB_USERNAME || 'izzoel';
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) throw new Error('Invalid GitHub username.');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN to read the GitHub contribution calendar.');
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'kalimantan-contribution-forest' },
    body: JSON.stringify({ query: 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date weekday contributionCount contributionLevel}}}}}}', variables: { login: username } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}; keeping previous forest.`);
  const calendar = readCalendar(await response.json());
  const svg = renderForest(calendar, username);
  await writeFile('contribution-forest.svg.tmp', svg);
  await rename('contribution-forest.svg.tmp', 'contribution-forest.svg');
  console.log(`Generated ${calendar.days.length} days / ${calendar.total} contributions for ${username}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateForest().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
