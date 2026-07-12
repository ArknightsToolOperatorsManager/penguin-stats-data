const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const OUTPUT_DIR = path.join(DATA_DIR, 'distribution');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'penguin_cn_drop_data.json');

function inferTimes(item) {
  if (Number.isFinite(item.times) && item.times >= 0) {
    return Math.trunc(item.times);
  }

  if (
    Number.isFinite(item.quantity) &&
    Number.isFinite(item.dropRate) &&
    item.dropRate > 0
  ) {
    return Math.round(item.quantity / item.dropRate);
  }

  return 0;
}

function main() {
  if (!fs.existsSync(LATEST_FILE)) {
    throw new Error(`Latest data file not found: ${LATEST_FILE}`);
  }

  const latest = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
  const cn = latest.serverData?.CN;

  if (!cn?.data || typeof cn.data !== 'object') {
    throw new Error('CN data is missing from latest.json');
  }

  const stages = {};
  let recordCount = 0;

  for (const stageId of Object.keys(cn.data).sort()) {
    const sourceItems = cn.data[stageId]?.items;
    if (!sourceItems || typeof sourceItems !== 'object') {
      continue;
    }

    const items = Object.entries(sourceItems)
      .map(([itemId, item]) => ({
        itemId,
        times: inferTimes(item),
        quantity: Number.isFinite(item.quantity) ? item.quantity : 0
      }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    if (items.length === 0) {
      continue;
    }

    stages[stageId] = items;
    recordCount += items.length;
  }

  const output = {
    schemaVersion: 1,
    server: 'CN',
    fetchedAt: cn.fetchedAt ?? latest.fetchedAt ?? new Date().toISOString(),
    stageCount: Object.keys(stages).length,
    recordCount,
    stages
  };

  if (output.stageCount === 0 || output.recordCount === 0) {
    throw new Error('Generated distribution data is empty');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output));

  console.log(`Generated ${OUTPUT_FILE}`);
  console.log(`Stages: ${output.stageCount}, records: ${output.recordCount}`);
}

main();
