const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const OUTPUT_DIR = path.join(DATA_DIR, 'distribution');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'penguin_active_stages.json');
const SERVERS = ['CN', 'US', 'JP', 'KR'];
const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

function isFiniteTimestamp(value) {
  return Number.isFinite(value) && value > 0;
}

function main() {
  if (!fs.existsSync(LATEST_FILE)) {
    throw new Error(`Latest data file not found: ${LATEST_FILE}`);
  }

  const latest = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
  const generatedAt = new Date();
  const now = generatedAt.getTime();
  const servers = {};
  let totalStageCount = 0;

  for (const server of SERVERS) {
    const sourceStages = latest.serverData?.[server]?.data;
    const activeStages = [];

    if (sourceStages && typeof sourceStages === 'object') {
      for (const [stageId, stageData] of Object.entries(sourceStages)) {
        const start = stageData?.stageInfo?.start;
        const end = stageData?.stageInfo?.end;

        // This file is only a recent/current event-stage hint for input assistance.
        // Exclude permanent or unknown periods, and allow a few days of delay.
        if (!isFiniteTimestamp(start) || !isFiniteTimestamp(end)) {
          continue;
        }

        if (start <= now + GRACE_MS && end >= now - GRACE_MS) {
          activeStages.push({ stageId, start, end });
        }
      }
    }

    activeStages.sort((a, b) => {
      if (a.start !== b.start) return b.start - a.start;
      return a.stageId.localeCompare(b.stageId);
    });

    servers[server] = activeStages;
    totalStageCount += activeStages.length;
  }

  const output = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    graceDays: GRACE_DAYS,
    totalStageCount,
    servers
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));

  console.log(`Generated ${OUTPUT_FILE}`);
  for (const server of SERVERS) {
    console.log(`${server}: ${servers[server].length} active stage candidates`);
  }
}

main();
