/**
 * CSS 語法健全度檢查與自動防呆修復模組
 * 用途：檢測 style.css 是否有括號未閉合或排版語法異常，避免發生整頁跑版
 */

const fs = require('fs');
const path = require('path');

function checkCssHealth(filePath, shouldFix = false) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: `檔案不存在：${filePath}` };
  }

  const rawBuffer = fs.readFileSync(filePath);
  const hasBom = rawBuffer[0] === 0xEF && rawBuffer[1] === 0xBB && rawBuffer[2] === 0xBF;
  const rawText = hasBom ? rawBuffer.slice(3).toString('utf8') : rawBuffer.toString('utf8');

  // 將註解替換為空格以保持行號正確
  const cleanText = rawText.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  const lines = cleanText.split('\n');

  const openStack = [];
  const extraClosing = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const currentLine = lines[lineIndex];
    for (let charIndex = 0; charIndex < currentLine.length; charIndex++) {
      const char = currentLine[charIndex];
      if (char === '{') {
        openStack.push({ line: lineIndex + 1, col: charIndex + 1 });
      } else if (char === '}') {
        if (openStack.length > 0) {
          openStack.pop();
        } else {
          extraClosing.push({ line: lineIndex + 1, col: charIndex + 1 });
        }
      }
    }
  }

  const isHealthy = openStack.length === 0 && extraClosing.length === 0;

  if (isHealthy) {
    return { ok: true, message: 'CSS 括號語法完整無缺漏，樣式健康度 100%！' };
  }

  // 若需要自動修復
  if (shouldFix && openStack.length > 0) {
    let fixedText = rawText;
    // 為每一個未閉合的括號補上相應的閉合大括號
    for (let i = 0; i < openStack.length; i++) {
      fixedText += '\n}';
    }

    const bomHeader = Buffer.from([0xEF, 0xBB, 0xBF]);
    const fileBuffer = Buffer.concat([bomHeader, Buffer.from(fixedText, 'utf8')]);
    fs.writeFileSync(filePath, fileBuffer);

    return {
      ok: true,
      repaired: true,
      message: `已自動修復！成功補回 ${openStack.length} 個未閉合括號 (曾於第 ${openStack.map(s => s.line).join(', ')} 行開啟)。`
    };
  }

  const errorDetails = [];
  if (openStack.length > 0) {
    errorDetails.push(`未閉合括號 (${openStack.length} 個)，起始於行號：${openStack.map(s => s.line).join(', ')}`);
  }
  if (extraClosing.length > 0) {
    errorDetails.push(`多餘的閉合括號 (${extraClosing.length} 個)，位於行號：${extraClosing.map(s => s.line).join(', ')}`);
  }

  return {
    ok: false,
    message: `CSS 語法異常警告：\n - ${errorDetails.join('\n - ')}`
  };
}

// 若透過 CLI 直接執行
if (require.main === module) {
  const targetCss = path.join(__dirname, '..', 'client', 'style.css');
  const fixMode = process.argv.includes('--fix');
  const result = checkCssHealth(targetCss, fixMode);

  if (result.ok) {
    console.log(`\x1b[32m✔ [CSS 檢查通過]\x1b[0m ${result.message}`);
    process.exit(0);
  } else {
    console.error(`\x1b[31m✖ [CSS 語法異常]\x1b[0m ${result.message}`);
    console.log('提示：可執行 node scripts/checkCss.js --fix 嘗試自動修復。');
    process.exit(1);
  }
}

module.exports = { checkCssHealth };
