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
  
  // シンプルな抽出アプローチ
  const extractors = [
    // アプローチ1: 単語境界での分割と再構成
    (id) => {
      const parts = id.split(/[-_]/);
      
      // 最初の部分をベースとして、意味のある単位まで拡張
      let result = parts[0];
      
      // 英字+数字+英字+数字パターン (act11d0)
      const complexMatch = result.match(/^([a-z]+\d+[a-z]+\d+)/);
      if (complexMatch) {
        return complexMatch[1];
      }
      
      // 英字+数字+英字パターン (act13side)
      const actMatch = result.match(/^([a-z]+\d+[a-z]+)/);
      if (actMatch) {
        return actMatch[1];
      }
      
      // 基本パターン+次の数字部分を結合 (main_07)
      if (parts.length >= 2 && /^[a-z]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
        return `${parts[0]}_${parts[1]}`;
      }
      
      // 基本パターン+次の英字部分を結合 (wk_melee)
      if (parts.length >= 2 && /^[a-z]+$/.test(parts[0]) && /^[a-z]+$/.test(parts[1])) {
        return `${parts[0]}_${parts[1]}`;
      }
      
      // 英字+数字パターン (a001)
      const alphaNumMatch = result.match(/^([a-z]+\d+)/);
      if (alphaNumMatch) {
        return alphaNumMatch[1];
      }
      
      // 単純な英字のみの場合はそのまま
      return result;
    },
    
    // アプローチ2: 末尾から不要部分を除去
    (id) => {
      let result = id;
      // 末尾の_rep, _perm等を除去
      result = result.replace(/[-_](rep|perm)$/, '');
      // 末尾の数字パターンを段階的に除去
      result = result.replace(/[-_]\d+[-_]?\d*$/, '');
      return result;
    },
    
    // アプローチ3: 正規表現による直接抽出
    (id) => {
      const patterns = [
        /^([a-z]+\d+[a-z]+\d+)/,    // 複雑パターン (act11d0)
        /^([a-z]+\d+[a-z]+)/,       // 中間パターン (act13side)  
        /^([a-z]+_\d+)/,            // 基本_数字 (main_07)
        /^([a-z]+_[a-z]+)/,         // 基本_英字 (wk_melee)
        /^([a-z]+\d+)/,             // 英字数字 (a001)
        /^([a-z]+)/                 // 英字のみ
      ];
      
      for (const pattern of patterns) {
        const match = id.match(pattern);
        if (match) {
          return match[1];
        }
      }
      
      return id.split(/[-_]/)[0];
    }
  ];
  
  // 各抽出器を試して結果を収集
  const results = extractors.map(extractor => {
    try {
      return extractor(cleanId);
    } catch (error) {
      return cleanId;
    }
  }).filter(result => result && result.length > 0);
  
  // 有効な結果のフィルタリング
  const validResults = results.filter(result => {
    return result !== cleanId && result.length > 0 && result !== stageId.toLowerCase();
  });
  
  if (validResults.length === 0) {
    // フォールバック: 最初の単語部分を返す
    return cleanId.split(/[-_]/)[0] || 'unknown';
  }
  
  // 最適な結果を選択 (より具体的で意味のあるものを優先)
  return validResults.reduce((best, current) => {
    // より複雑なパターンを優先（情報量が多い）
    const bestComplexity = getPatternComplexity(best);
    const currentComplexity = getPatternComplexity(current);
    
    if (currentComplexity > bestComplexity) return current;
    if (bestComplexity > currentComplexity) return best;
    
    // 同じ複雑度なら長い方を優先（より具体的）
    if (current.length > best.length) return current;
    if (current.length === best.length && current < best) return current;
    return best;
  });
}

// パターンの複雑度を計算
function getPatternComplexity(str) {
  let complexity = 0;
  
  // 英字+数字+英字+数字パターン
  if (/^[a-z]+\d+[a-z]+\d+$/.test(str)) complexity = 4;
  // 英字+数字+英字パターン  
  else if (/^[a-z]+\d+[a-z]+$/.test(str)) complexity = 3;
  // 基本_数字 or 基本_英字パターン
  else if (/^[a-z]+_[a-z0-9]+$/.test(str)) complexity = 2;
  // 英字+数字パターン
  else if (/^[a-z]+\d+$/.test(str)) complexity = 1;
  // 英字のみ
  else complexity = 0;
  
  return complexity;
}

// フォールバックパターン抽出（削除して非常にシンプルに）
function extractFallbackPattern(stageId) {
  // 最終フォールバック: 最初の単語部分を返すのみ
  return stageId.split(/[-_]/)[0] || 'unknown';
}

// 信頼度スコアを計算する関数
function calculateConfidence(stageId, extractedType) {
  let confidence = 0.5; // ベースライン
  
  // パターンの複雑度による信頼度調整
  const complexity = getPatternComplexity(extractedType);
  confidence += complexity * 0.1; // 複雑度 * 0.1
  
  // 長さによる信頼度調整
  if (extractedType.length >= 3 && extractedType.length <= 15) {
    confidence += 0.2;
  }
  
  // アンダースコアを含む場合（構造化された情報）
  if (extractedType.includes('_')) {
    confidence += 0.2;
  }
  
  // 数字と英字の組み合わせ（意味のある情報）
  if (/\d/.test(extractedType) && /[a-z]/.test(extractedType)) {
    confidence += 0.2;
  }
  
  // 元のIDとの差による信頼度調整
  if (extractedType !== stageId.toLowerCase() && extractedType.length < stageId.length) {
    confidence += 0.1;
  }
  
  // 信頼度の正規化
  return Math.min(1.0, Math.max(0.1, confidence));
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
    const excludePatterns = ['randommaterial', 'gacha', 'recruit', 'sub_'];
    
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