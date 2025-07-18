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

// データディレクトリの作成（正しいパス）
const baseDataDir = path.join(__dirname, '..', 'data');
console.log(`Base data directory: ${baseDataDir}`);
if (!fs.existsSync(baseDataDir)) {
  fs.mkdirSync(baseDataDir, { recursive: true });
  console.log('Base data directory created successfully');
}

// 日付フォーマット関数
function formatDate(date) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

// 古いフォルダを削除する関数（2週間より古い）
function cleanupOldFolders() {
  const retentionDays = 14;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  console.log(`Cleaning up folders older than ${formatDate(cutoffDate)}`);
  
  try {
    const folders = fs.readdirSync(baseDataDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)); // YYYY-MM-DD形式のみ
    
    let deletedCount = 0;
    folders.forEach(folderName => {
      const folderDate = new Date(folderName);
      if (folderDate < cutoffDate) {
        const folderPath = path.join(baseDataDir, folderName);
        console.log(`Deleting old folder: ${folderName}`);
        fs.rmSync(folderPath, { recursive: true, force: true });
        deletedCount++;
      }
    });
    
    console.log(`Cleanup completed. Deleted ${deletedCount} old folders.`);
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
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

// データを処理してstageId毎にグループ化
function processMatrixData(matrixData) {
  if (!matrixData || !matrixData.matrix) {
    return null;
  }
  
  const fetchedAt = new Date().toISOString();
  const groupedData = {};
  let totalItemCount = 0;
  
  // 除外するstageIdのパターン
  const excludePatterns = ['randommaterial','gachabox' ,'recruit'];
  
  // stageId毎にデータをグループ化
  matrixData.matrix.forEach(item => {
    const stageId = item.stageId;
    const itemId = item.itemId;
    
    // 除外パターンにマッチするstageIdを無視
    if (stageId && excludePatterns.some(pattern => stageId.toLowerCase().startsWith(pattern.toLowerCase()))) {
      return;
    }
    
    // ステージが存在しない場合は初期化
    if (!groupedData[stageId]) {
      groupedData[stageId] = {
        stageInfo: {
          times: item.times,
          start: item.start,
          end: item.end,
          fetchedAt: fetchedAt
        },
        items: {}
      };
    }
    
    // アイテムデータを追加
    groupedData[stageId].items[itemId] = {
      quantity: item.quantity,
      stdDev: item.stdDev,
      dropRate: item.times > 0 ? item.quantity / item.times : 0,
      dropPercentage: item.times > 0 ? (item.quantity / item.times * 100).toFixed(2) : "0.00"
    };
    
    totalItemCount++;
  });
  
  return {
    data: groupedData,
    stageCount: Object.keys(groupedData).length,
    itemCount: totalItemCount,
    fetchedAt: fetchedAt
  };
}

// メイン処理
async function main() {
  const timestamp = formatDate(new Date()); // YYYY-MM-DD
  const todayDir = path.join(baseDataDir, timestamp);
  
  // 今日のディレクトリを作成
  if (!fs.existsSync(todayDir)) {
    fs.mkdirSync(todayDir, { recursive: true });
    console.log(`Created directory for ${timestamp}`);
  }
  
  // 古いフォルダをクリーンアップ
  cleanupOldFolders();
  
  const results = {};
  
  for (const server of SERVERS) {
    console.log(`Processing server: ${server}`);
    
    const rawData = await fetchMatrixData(server);
    if (rawData) {
      const processedData = processMatrixData(rawData);
      if (processedData) {
        results[server] = {
          fetchedAt: processedData.fetchedAt,
          dataCount: processedData.itemCount,
          stageCount: processedData.stageCount,
          data: processedData.data
        };
        
        // サーバー別ファイルとして今日のフォルダに保存
        const filename = `penguin-stats-${server.toLowerCase()}.json`;
        const filepath = path.join(todayDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(results[server], null, 2));
        
        console.log(`Saved ${results[server].stageCount} stages (${results[server].dataCount} items) for ${server} to ${timestamp}/${filename}`);
      } else {
        console.error(`Failed to process data for ${server}`);
      }
    } else {
      console.error(`Failed to fetch data for ${server}`);
    }
    
    // APIに負荷をかけないよう1秒待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 今日のフォルダに統合ファイルも作成
  const summaryFile = path.join(todayDir, 'summary.json');
  const summary = {
    date: timestamp,
    fetchedAt: new Date().toISOString(),
    servers: Object.keys(results),
    totalStages: Object.values(results).reduce((sum, server) => sum + (server.stageCount || 0), 0),
    totalRecords: Object.values(results).reduce((sum, server) => sum + (server.dataCount || 0), 0),
    serverData: results
  };
  
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`Created summary file: ${timestamp}/summary.json`);
  
  // ルートディレクトリに最新データのシンボリックリンク的なファイルも作成
  const latestFile = path.join(baseDataDir, 'latest.json');
  const latestData = {
    ...summary,
    latestDataPath: timestamp
  };
  fs.writeFileSync(latestFile, JSON.stringify(latestData, null, 2));
  
  console.log('Data fetch completed successfully!');
  console.log(`Total files in today's folder: ${Object.keys(results).length + 1} (${Object.keys(results).length} server files + 1 summary)`);
  console.log(`Total stages across all servers: ${summary.totalStages}`);
  console.log(`Total item records across all servers: ${summary.totalRecords}`);
}

// エラーハンドリング付きで実行
main().catch(error => {
  console.error('Error in main process:', error);
  process.exit(1);
});