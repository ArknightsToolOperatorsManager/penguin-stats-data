// fetch-penguin-stats.js
const fs = require('fs');
const path = require('path');

// Node.js 18でfetchが利用できない場合のpolyfill
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
} else {
  fetch = globalThis.fetch;
}

// APIエンドポイント
const API_BASE = 'https://penguin-stats.io/PenguinStats/api/v2';
const SERVERS = ['CN', 'US', 'JP', 'KR'];

// データディレクトリの作成
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// APIからデータを取得する関数
async function fetchMatrixData(server) {
  const url = `${API_BASE}/result/matrix?server=${server}&show_closed_zones=true`;
  
  try {
    console.log(`Fetching data for server: ${server}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching data for ${server}:`, error);
    return null;
  }
}

// データを処理してドロップ確率を計算
function processMatrixData(matrixData) {
  if (!matrixData || !matrixData.matrix) {
    return null;
  }
  
  return matrixData.matrix.map(item => ({
    ...item,
    dropRate: item.times > 0 ? item.quantity / item.times : 0,
    dropPercentage: item.times > 0 ? (item.quantity / item.times * 100).toFixed(2) : 0,
    fetchedAt: new Date().toISOString()
  }));
}

// メイン処理
async function main() {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const results = {};
  
  for (const server of SERVERS) {
    console.log(`Processing server: ${server}`);
    
    const rawData = await fetchMatrixData(server);
    if (rawData) {
      const processedData = processMatrixData(rawData);
      results[server] = {
        fetchedAt: new Date().toISOString(),
        dataCount: processedData ? processedData.length : 0,
        data: processedData
      };
      
      // サーバー別ファイルとして保存
      const filename = `penguin-stats-${server.toLowerCase()}-${timestamp}.json`;
      const filepath = path.join(dataDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(results[server], null, 2));
      
      console.log(`Saved ${results[server].dataCount} records for ${server} to ${filename}`);
    } else {
      console.error(`Failed to fetch data for ${server}`);
    }
    
    // APIに負荷をかけないよう1秒待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 全サーバーの統合ファイルも作成
  const summaryFile = path.join(dataDir, `penguin-stats-summary-${timestamp}.json`);
  const summary = {
    fetchedAt: new Date().toISOString(),
    servers: Object.keys(results),
    totalRecords: Object.values(results).reduce((sum, server) => sum + (server.dataCount || 0), 0),
    serverData: results
  };
  
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`Created summary file: penguin-stats-summary-${timestamp}.json`);
  
  // 最新データのシンボリックリンク的なファイルも作成
  const latestFile = path.join(dataDir, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(summary, null, 2));
  
  console.log('Data fetch completed successfully!');
}

// エラーハンドリング付きで実行
main().catch(error => {
  console.error('Error in main process:', error);
  process.exit(1);
});