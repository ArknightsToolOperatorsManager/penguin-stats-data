// extract-stage-types.js
const fs = require('fs');
const path = require('path');

// Node.js 18でfetchが利用できない場合のpolyfill
let fetch;
if (typeof globalThis.fetch === 'undefined') {
  fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
} else {
  fetch = globalThis.fetch;
}

// Google Spreadsheet設定
const SPREADSHEET_ID = '1ZJ85ZwS1fJFwZ9KZp0YCNzsRRMXx1vMiEaOfr-lYTw8';
const SHEET_NAME = 'stageInfo';
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

// Google Spreadsheetsから既存データを取得
async function getExistingStageTypes() {
  try {
    console.log('📊 Fetching existing stage types from Google Spreadsheet...');
    const response = await fetch(SPREADSHEET_URL);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const csvText = await response.text();
    const lines = csvText.split('\n');
    
    // ヘッダーをスキップして、A列（Stage Type）の値を取得
    const existingTypes = new Set();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // CSVの最初の列を取得（クォートを除去）
        const firstColumn = line.split(',')[0];
        if (firstColumn) {
          const stageType = firstColumn.replace(/"/g, '').trim();
          if (stageType) {
            existingTypes.add(stageType);
          }
        }
      }
    }
    
    console.log(`✅ Found ${existingTypes.size} existing stage types in spreadsheet`);
    return existingTypes;
    
  } catch (error) {
    console.error('❌ Error fetching existing stage types:', error);
    console.log('📝 Continuing with empty existing types list...');
    return new Set();
  }
}

// GASにデータを送信してスプレッドシートに追加
async function sendToGoogleSpreadsheet(newTypes) {
  // GAS WebアプリのURL（環境変数または設定から取得）
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  
  console.log('🔍 Environment check:');
  console.log(`   GAS_WEBHOOK_URL exists: ${!!GAS_WEBHOOK_URL}`);
  console.log(`   GAS_WEBHOOK_URL length: ${GAS_WEBHOOK_URL ? GAS_WEBHOOK_URL.length : 0}`);
  if (GAS_WEBHOOK_URL) {
    console.log(`   GAS_WEBHOOK_URL starts with: ${GAS_WEBHOOK_URL.substring(0, 50)}...`);
  }
  
  if (!GAS_WEBHOOK_URL) {
    throw new Error('GAS_WEBHOOK_URL environment variable not set');
  }
  
  console.log('🔗 Calling Google Apps Script webhook...');
  console.log(`📤 Sending ${newTypes.length} new stage types to GAS`);
  
  // GASに送信するデータを整形
  const payload = {
    timestamp: new Date().toISOString(),
    newTypes: newTypes.map(type => ({
      stageType: type.stageType,
      count: type.count,
      confidence: type.avgConfidence,
      examples: type.examples,
      japaneseName: '', // 空欄
      notes: ''        // 空欄
    }))
  };
  
  console.log('📋 Payload preview:', JSON.stringify(payload, null, 2).substring(0, 500) + '...');
  
  try {
    const response = await fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.log(`📡 HTTP Response Status: ${response.status} ${response.statusText}`);
    console.log(`📡 Response Headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ GAS webhook failed with status ${response.status}`);
      console.error(`❌ Error response body:`, errorText);
      throw new Error(`GAS webhook failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.text();
    console.log(`✅ GAS response: ${result}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Network error calling GAS webhook:', error.message);
    console.error('❌ Error details:', error);
    throw error;
  }
}

// 動的にステージタイプを抽出する関数
function extractStageType(stageId) {
  if (!stageId || typeof stageId !== 'string') {
    return 'unknown';
  }
  
  // 基本的な前処理
  const cleanId = stageId.trim().toLowerCase();
  
  // 複数のアプローチを組み合わせて動的判断
  const extractors = [
    // アプローチ1: 最後の数字・ハイフン・数字パターンを除去
    (id) => {
      const match = id.match(/^(.+?)(?:[-_]\d+(?:[-_]\d+)*(?:[-_][a-z]+\d*)?)?$/);
      return match ? match[1] : id;
    },
    
    // アプローチ2: 連続する数字の塊を除去
    (id) => {
      return id.replace(/[-_]\d+/g, '').replace(/\d+$/, '');
    },
    
    // アプローチ3: 末尾の数字とハイフンパターンを除去
    (id) => {
      return id.replace(/[-_]?\d+[-_]?\d*[-_]?[a-z]*\d*$/, '');
    },
    
    // アプローチ4: アンダースコア区切りで最後の数字含む部分を除去
    (id) => {
      const parts = id.split('_');
      // 最後の部分が数字で始まる場合は除去
      while (parts.length > 1 && /^\d/.test(parts[parts.length - 1])) {
        parts.pop();
      }
      return parts.join('_');
    }
  ];
  
  // 各抽出器を試して、最も適切な結果を選択
  const results = extractors.map(extractor => {
    try {
      return extractor(cleanId);
    } catch (error) {
      return cleanId;
    }
  }).filter(result => result && result.length > 0);
  
  // 結果の検証と選択
  const validResults = results.filter(result => {
    // 空文字や元のIDと同じでないかチェック
    return result !== cleanId && result.length > 0 && result !== stageId.toLowerCase();
  });
  
  if (validResults.length === 0) {
    // フォールバック: 手動パターン
    return extractFallbackPattern(cleanId);
  }
  
  // 最も短くて意味のありそうな結果を選択（通常は最も抽象的なタイプ）
  return validResults.reduce((best, current) => {
    if (current.length < best.length) return current;
    if (current.length === best.length && current < best) return current;
    return best;
  });
}

// フォールバックパターン抽出
function extractFallbackPattern(stageId) {
  // 特殊ケース用のパターン
  const specialPatterns = [
    // イベント系
    { pattern: /^act\d+/, type: 'activity' },
    { pattern: /^event/, type: 'event' },
    { pattern: /side/, type: 'side_story' },
    
    // 定期系
    { pattern: /^wk_/, type: 'weekly' },
    { pattern: /^daily/, type: 'daily' },
    
    // メイン系
    { pattern: /^main/, type: 'main' },
    { pattern: /^tough/, type: 'tough' },
    { pattern: /^sub/, type: 'sub' },
    
    // その他
    { pattern: /^tutorial/, type: 'tutorial' },
    { pattern: /^train/, type: 'training' },
  ];
  
  for (const { pattern, type } of specialPatterns) {
    if (pattern.test(stageId)) {
      return type;
    }
  }
  
  // 最終フォールバック
  return stageId.split(/[-_]/)[0] || 'unknown';
}

// 信頼度スコアを計算する関数
function calculateConfidence(stageId, extractedType) {
  let confidence = 0.5; // ベースライン
  
  // 長さによる信頼度調整
  if (extractedType.length >= 3 && extractedType.length <= 15) {
    confidence += 0.2;
  }
  
  // 既知のパターンによる信頼度調整
  const knownPatterns = ['main', 'tough', 'sub', 'act', 'wk', 'event', 'side'];
  if (knownPatterns.some(pattern => extractedType.includes(pattern))) {
    confidence += 0.3;
  }
  
  // 元のIDとの差による信頼度調整
  if (extractedType !== stageId && extractedType.length < stageId.length) {
    confidence += 0.1;
  }
  
  return Math.min(1.0, confidence);
}

// メイン処理: 最新データからステージタイプを抽出
async function extractStageTypesFromLatest() {
  const baseDataDir = path.join(__dirname, '..', 'data');
  const latestFile = path.join(baseDataDir, 'latest.json');
  
  if (!fs.existsSync(latestFile)) {
    console.error('Latest data file not found. Please run fetch-penguin-stats.js first.');
    return;
  }
  
  try {
    // 既存のステージタイプを取得
    const existingTypes = await getExistingStageTypes();
    
    const latestData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
    const dataPath = latestData.latestDataPath;
    
    if (!dataPath) {
      console.error('Invalid latest data format.');
      return;
    }
    
    console.log(`Processing data from: ${dataPath}`);
    
    const stageTypeMap = new Map();
    const stageExamples = new Map();
    const stageConfidence = new Map();
    
    // 除外するstageIdのパターン
    const excludePatterns = ['randommaterial' ,'gachabox' ,'recruit'];
    
    // 全サーバーのデータを処理
    Object.entries(latestData.serverData).forEach(([server, serverData]) => {
      if (!serverData.data) return;
      
      // 新しいデータ構造: serverData.data はstageId別のオブジェクト
      Object.entries(serverData.data).forEach(([stageId, stageData]) => {
        if (!stageId) return;
        
        // 除外パターンにマッチするstageIdを無視
        if (excludePatterns.some(pattern => stageId.toLowerCase().startsWith(pattern.toLowerCase()))) {
          return;
        }
        
        const extractedType = extractStageType(stageId);
        const confidence = calculateConfidence(stageId, extractedType);
        
        // マップに追加
        if (!stageTypeMap.has(extractedType)) {
          stageTypeMap.set(extractedType, new Set());
          stageExamples.set(extractedType, []);
          stageConfidence.set(extractedType, []);
        }
        
        stageTypeMap.get(extractedType).add(stageId);
        stageConfidence.get(extractedType).push(confidence);
        
        // 例を追加（最大5つ）
        const examples = stageExamples.get(extractedType);
        if (examples.length < 5 && !examples.includes(stageId)) {
          examples.push(stageId);
        }
      });
    });
    
    // 結果を生成（新しいタイプのみ）
    const allResults = [];
    const newResults = [];
    
    stageTypeMap.forEach((stageIds, stageType) => {
      const examples = stageExamples.get(stageType) || [];
      const confidences = stageConfidence.get(stageType) || [];
      const avgConfidence = confidences.length > 0 
        ? (confidences.reduce((sum, c) => sum + c, 0) / confidences.length).toFixed(3)
        : '0.000';
      
      const result = {
        stageType,
        count: stageIds.size,
        examples: examples.join(', '),
        avgConfidence,
        allStageIds: Array.from(stageIds).sort(),
        isNew: !existingTypes.has(stageType)
      };
      
      allResults.push(result);
      if (result.isNew) {
        newResults.push(result);
      }
    });
    
    // 信頼度順でソート
    allResults.sort((a, b) => {
      const confDiff = parseFloat(b.avgConfidence) - parseFloat(a.avgConfidence);
      if (Math.abs(confDiff) < 0.01) {
        return b.count - a.count;
      }
      return confDiff;
    });
    
    newResults.sort((a, b) => {
      const confDiff = parseFloat(b.avgConfidence) - parseFloat(a.avgConfidence);
      if (Math.abs(confDiff) < 0.01) {
        return b.count - a.count;
      }
      return confDiff;
    });
    
    // ファイル保存（詳細情報）
    const timestamp = new Date().toISOString().split('T')[0];
    const outputDir = path.join(baseDataDir, dataPath);
    const detailFile = path.join(outputDir, 'stage-types-detail.json');
    const newTypesFile = path.join(outputDir, 'new-stage-types.json');
    
    fs.writeFileSync(detailFile, JSON.stringify(allResults, null, 2));
    fs.writeFileSync(newTypesFile, JSON.stringify(newResults, null, 2));
    
    // 最新版をルートにも保存
    const latestDetailFile = path.join(baseDataDir, 'latest-stage-types-detail.json');
    const latestNewTypesFile = path.join(baseDataDir, 'latest-new-stage-types.json');
    
    fs.writeFileSync(latestDetailFile, JSON.stringify(allResults, null, 2));
    fs.writeFileSync(latestNewTypesFile, JSON.stringify(newResults, null, 2));
    
    // 新しいタイプがある場合はCSVも生成（確認用）
    if (newResults.length > 0) {
      const csvData = [
        ['Stage Type', 'Count', 'Confidence', 'Japanese Name', 'Examples', 'Notes'].join(',')
      ];
      
      newResults.forEach(result => {
        csvData.push([
          `"${result.stageType}"`,
          result.count,
          result.avgConfidence,
          '""', // 空欄（手動入力用）
          `"${result.examples}"`,
          '""'  // 空欄（メモ用）
        ].join(','));
      });
      
      const csvFile = path.join(outputDir, 'new-stage-types.csv');
      const latestCsvFile = path.join(baseDataDir, 'latest-new-stage-types.csv');
      
      fs.writeFileSync(csvFile, csvData.join('\n'));
      fs.writeFileSync(latestCsvFile, csvData.join('\n'));
      
      console.log(`📄 New stage types CSV created: ${csvFile}`);
    }
    
    console.log(`✅ Stage types analysis completed!`);
    console.log(`📊 Total stage types: ${allResults.length}`);
    console.log(`🆕 New stage types: ${newResults.length}`);
    console.log(`📁 Files saved:`);
    console.log(`   - ${detailFile}`);
    console.log(`   - ${newTypesFile}`);
    console.log(`   - ${latestDetailFile}`);
    console.log(`   - ${latestNewTypesFile}`);
    
    if (newResults.length > 0) {
      console.log(`\n🆕 New stage types found:`);
      newResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.stageType} (${result.count} stages, confidence: ${result.avgConfidence})`);
        console.log(`   Examples: ${result.examples}`);
      });
      
      console.log(`\n📝 Sending new stage types to Google Spreadsheet...`);
      try {
        await sendToGoogleSpreadsheet(newResults);
        console.log(`✅ Successfully sent ${newResults.length} new stage types to spreadsheet`);
      } catch (error) {
        console.error(`❌ Failed to send to spreadsheet:`, error.message);
        console.log(`📋 Please manually add these types to the spreadsheet:`);
        console.log(`   https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=0`);
      }
    } else {
      console.log(`\n✅ No new stage types found. All types are already in the spreadsheet.`);
    }
    
    // 全体統計を表示
    console.log(`\n📈 Stage type statistics:`);
    console.log(`   - Existing types: ${allResults.length - newResults.length}`);
    console.log(`   - New types: ${newResults.length}`);
    console.log(`   - Total unique stage IDs: ${Array.from(new Set(allResults.flatMap(r => r.allStageIds))).length}`);
    
    return { allResults, newResults };
    
  } catch (error) {
    console.error('Error processing stage types:', error);
  }
}

// コマンドライン実行時
if (require.main === module) {
  extractStageTypesFromLatest().catch(console.error);
}

module.exports = {
  extractStageType,
  extractStageTypesFromLatest,
  calculateConfidence,
  sendToGoogleSpreadsheet
};