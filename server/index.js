const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const frontMatter = require('front-matter');

// Global Exception & Background Stream Safety Protection
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'error.log'), new Date().toISOString() + ' [UncaughtException] ' + (err.stack || err) + '\n');
  } catch (e) {}
});

if (process.stdout) process.stdout.on('error', () => {});
if (process.stderr) process.stderr.on('error', () => {});

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const TODOS_DIR = path.join(DATA_DIR, 'todos');
const NOTEBOOKS_DIR = path.join(DATA_DIR, 'notebooks');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');

// Ensure base directories exist
[TODOS_DIR, NOTEBOOKS_DIR, TEMPLATES_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Helper: Read file with UTF-8 (handling BOM)
function readFileUtf8(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return content;
}

// Helper: Write file with UTF-8 BOM
function writeFileUtf8Bom(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const textBuffer = Buffer.from(content, 'utf8');
  fs.writeFileSync(filePath, Buffer.concat([bom, textBuffer]));
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 確保所有 API 端點完全阻斷瀏覽器快取 (No-Store Cache Control)
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static data directory (covers /data/assets, /data/todos, etc.)
app.use('/data', express.static(DATA_DIR));
// Serve frontend client
app.use(express.static(path.join(__dirname, '..', 'client')));

// Multer in-memory storage for image conversion with Sharp
const upload = multer({ storage: multer.memoryStorage() });

// ========================================================
// 1. Monthly JSON Todos Storage Engine (月份 JSON 待辦存取核心)
// ========================================================

function getMonthTodoFile(yearMonth) {
  return path.join(TODOS_DIR, `${yearMonth}.json`);
}

function readMonthTodos(yearMonth) {
  const filePath = getMonthTodoFile(yearMonth);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = readFileUtf8(filePath);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('讀取月份待辦 JSON 失敗:', filePath, e);
    return [];
  }
}

function writeMonthTodos(yearMonth, tasks) {
  const filePath = getMonthTodoFile(yearMonth);
  writeFileUtf8Bom(filePath, JSON.stringify(tasks, null, 2));
}

function getAdjacentMonths(yearMonth) {
  const parts = yearMonth.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const nextDate = new Date(Date.UTC(y, m, 1));
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [fmt(prevDate), yearMonth, fmt(nextDate)];
}

function findTaskById(id, dateHint) {
  if (dateHint && dateHint.length >= 7) {
    const ym = dateHint.slice(0, 7);
    const tasks = readMonthTodos(ym);
    const task = tasks.find(t => t.id === id);
    if (task) return { task, ym, tasks };
  }
  if (fs.existsSync(TODOS_DIR)) {
    const files = fs.readdirSync(TODOS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const ym = file.replace('.json', '');
      const tasks = readMonthTodos(ym);
      const task = tasks.find(t => t.id === id);
      if (task) return { task, ym, tasks };
    }
  }
  return null;
}

// --- 1. Calendar API (讀取月份 JSON 並組裝日曆區間) ---
app.get('/api/calendar', (req, res) => {
  try {
    const { month } = req.query; // YYYY-MM
    if (!month) return res.status(400).json({ error: '請提供 month 參數' });

    const monthData = {};
    const targetMonths = getAdjacentMonths(month);
    const allCandidateTasks = [];
    const seenIds = new Set();

    targetMonths.forEach(ym => {
      const tasks = readMonthTodos(ym);
      tasks.forEach(t => {
        if (!seenIds.has(t.id)) {
          seenIds.add(t.id);
          allCandidateTasks.push(t);
        }
      });
    });

    const monthStart = `${month}-01`;
    const monthEnd = `${month}-31`;

    allCandidateTasks.forEach(t => {
      let sDate = t.startDate || t.date;
      let eDate = t.endDate || sDate;
      if (sDate > eDate) {
        const tmp = sDate; sDate = eDate; eDate = tmp;
      }
      const isMultiDay = sDate !== eDate;

      // 檢查任務區間是否與本月有交集
      if (sDate <= monthEnd && eDate >= monthStart) {
        const [sy, sm, sd] = sDate.split('-').map(Number);
        const [ey, em, ed] = eDate.split('-').map(Number);
        const cur = new Date(Date.UTC(sy, sm - 1, sd));
        const end = new Date(Date.UTC(ey, em - 1, ed));

        let dayCount = 0;
        while (cur <= end && dayCount < 366) {
          const dayStr = cur.toISOString().split('T')[0];
          if (dayStr.startsWith(month)) {
            if (!monthData[dayStr]) monthData[dayStr] = [];
            const contentStr = t.content || '';
            const totalMatches = (contentStr.match(/^(\s*)-\s*\[([ xX])\]/gm) || []);
            const doneMatches = (contentStr.match(/^(\s*)-\s*\[[xX]\]/gm) || []);
            const stepsList = Array.isArray(t.steps) ? t.steps : [];
            const stepsCount = totalMatches.length > 0 ? totalMatches.length : stepsList.length;
            const stepsCompletedCount = totalMatches.length > 0 ? doneMatches.length : stepsList.filter(s => s && s.done).length;

            monthData[dayStr].push({
              id: t.id,
              title: t.title || '無標題任務',
              date: t.date || sDate,
              startDate: sDate,
              endDate: eDate,
              isMultiDay,
              completed: !!t.completed,
              client: t.client || '',
              status: t.status || '進行中',
              priority: t.priority || 'normal',
              tags: t.tags || [],
              stepsCount,
              stepsCompletedCount,
              steps: stepsList,
              content: contentStr
            });
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
          dayCount++;
        }
      }
    });

    res.json({ success: true, month, days: monthData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 2. Todos API (查詢、新增、切換、刪除) ---
app.get('/api/todos', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: '請提供 date 參數' });

    const ym = date.slice(0, 7);
    const months = getAdjacentMonths(ym);
    const matchedTasks = [];
    const seenIds = new Set();

    months.forEach(targetYm => {
      const tasks = readMonthTodos(targetYm);
      tasks.forEach(t => {
        if (!seenIds.has(t.id)) {
          seenIds.add(t.id);
          let sDate = t.startDate || t.date;
          let eDate = t.endDate || sDate;
          if (sDate > eDate) {
            const tmp = sDate; sDate = eDate; eDate = tmp;
          }
          if (date >= sDate && date <= eDate) {
            matchedTasks.push(t);
          }
        }
      });
    });

    res.json({ success: true, date, tasks: matchedTasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/todos', (req, res) => {
  try {
    const { id, title, date, startDate, endDate, completed, client, status, priority, tags, steps, content } = req.body;
    const taskStartDate = startDate || date;
    if (!taskStartDate || !title) return res.status(400).json({ error: 'startDate/date 與 title 為必填' });
    const taskEndDate = endDate || taskStartDate;
    const ym = taskStartDate.slice(0, 7);
    const taskId = id || `task_${Date.now()}`;

    const tagsArray = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(s => s.trim()).filter(Boolean) : []);
    const stepsArray = Array.isArray(steps) ? steps : [];

    const taskObj = {
      id: taskId,
      title: title.trim(),
      date: taskStartDate,
      startDate: taskStartDate,
      endDate: taskEndDate,
      isMultiDay: taskStartDate !== taskEndDate,
      completed: !!completed,
      client: client || '',
      status: status || (completed ? '已完成' : '進行中'),
      priority: priority || 'normal',
      tags: tagsArray,
      steps: stepsArray,
      content: content || '',
      updatedAt: new Date().toISOString()
    };

    // 若原本存於其他月份，從舊月份中移除
    if (id) {
      const existing = findTaskById(id, date);
      if (existing && existing.ym !== ym) {
        const cleanedOld = existing.tasks.filter(t => t.id !== id);
        writeMonthTodos(existing.ym, cleanedOld);
      }
    }

    const currentMonthTasks = readMonthTodos(ym);
    const existingIndex = currentMonthTasks.findIndex(t => t.id === taskId);
    if (existingIndex >= 0) {
      currentMonthTasks[existingIndex] = taskObj;
    } else {
      currentMonthTasks.push(taskObj);
    }

    writeMonthTodos(ym, currentMonthTasks);

    res.json({ success: true, task: taskObj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/todos/:date/:id/toggle', (req, res) => {
  try {
    const { date, id } = req.params;
    const found = findTaskById(id, date);
    if (!found) return res.status(404).json({ error: '找不到該任務' });

    const newCompleted = !found.task.completed;
    found.task.completed = newCompleted;
    found.task.status = newCompleted ? '已完成' : '進行中';
    if (Array.isArray(found.task.steps) && newCompleted) {
      found.task.steps.forEach(st => { if (st) st.done = true; });
    }
    found.task.updatedAt = new Date().toISOString();

    writeMonthTodos(found.ym, found.tasks);
    res.json({ success: true, completed: newCompleted, task: found.task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/todos/:date/:id', (req, res) => {
  try {
    const { date, id } = req.params;
    const found = findTaskById(id, date);
    if (found) {
      const filtered = found.tasks.filter(t => t.id !== id);
      writeMonthTodos(found.ym, filtered);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 待辦沉澱至筆記庫 (扁平 Markdown 儲存)
app.post('/api/todos/promote-to-notebook', (req, res) => {
  try {
    const { date, id, category, noteTitle } = req.body;
    const found = findTaskById(id, date);
    if (!found) return res.status(404).json({ error: '找不到待辦任務' });

    const task = found.task;
    const targetCategory = category || task.client || '一般專案';
    const cleanTitle = (noteTitle || task.title || '工作紀錄').replace(/[/\\?%*:|"<>]/g, '_');

    const catDir = path.join(NOTEBOOKS_DIR, targetCategory);
    if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

    const noteFile = path.join(catDir, `${cleanTitle}.md`);

    let bodyWithSteps = '';
    if (Array.isArray(task.steps) && task.steps.length > 0) {
      bodyWithSteps += '### 執行步驟清單\n';
      task.steps.forEach(st => {
        const indent = st.level === 1 ? '  ' : '';
        bodyWithSteps += `${indent}- [${st.done ? 'x' : ' '}] ${st.text}\n`;
      });
      bodyWithSteps += '\n---\n\n';
    }
    bodyWithSteps += task.content || '';

    const frontmatterText = [
      '---',
      `title: "${cleanTitle.replace(/"/g, '\\"')}"`,
      `category: "${targetCategory.replace(/"/g, '\\"')}"`,
      `date: "${date || task.date || ''}"`,
      `sourceTaskId: "${id}"`,
      `tags: [${(task.tags || []).map(t => `"${String(t).replace(/"/g, '\\"')}"`).join(', ')}]`,
      '---',
      '',
      bodyWithSteps
    ].join('\n');

    writeFileUtf8Bom(noteFile, frontmatterText);

    res.json({
      success: true,
      message: '成功沉澱至知識庫！',
      notebookPath: `${targetCategory}/${cleanTitle}.md`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================
// 2. Notebooks API (扁平 Markdown 儲存 + 多層樹狀結構相容)
// ========================================================

function scanNotebookTree(dirPath, relPath) {
  relPath = relPath || '';
  const result = {
    subCategories: [],
    notes: []
  };

  if (!fs.existsSync(dirPath)) return result;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // 1. 優先處理目錄下的直接 Markdown 筆記檔 (扁平架構)
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const fullPath = path.join(dirPath, entry.name);
      const noteName = entry.name.replace(/\.md$/, '');
      const noteRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      try {
        const raw = readFileUtf8(fullPath);
        const parsed = frontMatter(raw);
        result.notes.push({
          name: noteName,
          title: (parsed.attributes && parsed.attributes.title) ? parsed.attributes.title : noteName,
          category: relPath,
          date: (parsed.attributes && parsed.attributes.date) ? parsed.attributes.date : '',
          tags: (parsed.attributes && parsed.attributes.tags) ? parsed.attributes.tags : [],
          path: noteRel,
          isFlat: true
        });
      } catch (err) {
        console.warn('讀取扁平筆記失敗:', noteRel, err);
      }
    }
  }

  // 2. 處理子目錄 (包含分類或相容舊版 index.md 筆記)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'images' || entry.name === 'assets') continue;

    const fullPath = path.join(dirPath, entry.name);
    const currentRel = relPath ? (relPath + '/' + entry.name) : entry.name;
    const indexPath = path.join(fullPath, 'index.md');

    if (fs.existsSync(indexPath)) {
      // 舊版目錄筆記 (相容讀取)
      try {
        const raw = readFileUtf8(indexPath);
        const parsed = frontMatter(raw);
        result.notes.push({
          name: entry.name,
          title: (parsed.attributes && parsed.attributes.title) ? parsed.attributes.title : entry.name,
          category: relPath,
          date: (parsed.attributes && parsed.attributes.date) ? parsed.attributes.date : '',
          tags: (parsed.attributes && parsed.attributes.tags) ? parsed.attributes.tags : [],
          path: currentRel,
          isFlat: false
        });
      } catch (err) {
        console.warn('讀取舊版筆記失敗:', currentRel, err);
      }
    } else {
      // 分類/專案節點 (遞迴深入)
      const subTree = scanNotebookTree(fullPath, currentRel);
      let totalCount = subTree.notes.length;
      subTree.subCategories.forEach(sc => { totalCount += sc.count; });

      result.subCategories.push({
        category: entry.name,
        relPath: currentRel,
        count: totalCount,
        notes: subTree.notes,
        subCategories: subTree.subCategories
      });
    }
  }

  return result;
}

function resolveNoteFullPath(noteRelPath) {
  let target = path.join(NOTEBOOKS_DIR, noteRelPath);
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  if (!target.endsWith('.md')) {
    if (fs.existsSync(target + '.md')) return target + '.md';
  }
  const indexPath = path.join(target, 'index.md');
  if (fs.existsSync(indexPath)) return indexPath;
  return null;
}

app.get('/api/notebooks', (req, res) => {
  try {
    const rootTree = scanNotebookTree(NOTEBOOKS_DIR);
    res.json({ success: true, tree: rootTree.subCategories, rootNotes: rootTree.notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增分類 (支援任意層級 parentPath)
app.post('/api/notebooks/category/create', (req, res) => {
  try {
    const { name, parentPath } = req.body;
    if (!name) return res.status(400).json({ error: '請提供分類名稱' });
    const cleanName = name.trim().replace(/[/\\?%*:|"<>]/g, '_');
    const targetDir = parentPath ? path.join(NOTEBOOKS_DIR, parentPath, cleanName) : path.join(NOTEBOOKS_DIR, cleanName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const finalRel = parentPath ? (parentPath + '/' + cleanName) : cleanName;
    res.json({ success: true, name: cleanName, relPath: finalRel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 穩健分類改名
app.patch('/api/notebooks/category/rename', (req, res) => {
  try {
    const { oldName, newName, oldRelPath } = req.body;
    const targetOld = oldRelPath || oldName;
    if (!targetOld || !newName) return res.status(400).json({ error: '請提供舊路徑與新名稱' });

    const cleanNew = newName.trim().replace(/[/\\?%*:|"<>]/g, '_');
    const oldPath = path.join(NOTEBOOKS_DIR, targetOld);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: '找不到目錄 [' + targetOld + ']' });
    }

    const parentDir = path.dirname(oldPath);
    const newPath = path.join(parentDir, cleanNew);

    if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
      return res.status(400).json({ error: '新名稱 [' + cleanNew + '] 已存在，請使用不同名稱' });
    }

    try {
      fs.renameSync(oldPath, newPath);
    } catch (renameErr) {
      fs.cpSync(oldPath, newPath, { recursive: true });
      fs.rmSync(oldPath, { recursive: true, force: true });
    }

    const newRel = path.relative(NOTEBOOKS_DIR, newPath).replace(/\\/g, '/');
    res.json({ success: true, oldRelPath: targetOld, newRelPath: newRel, newName: cleanNew });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 筆記拖曳歸類
app.post('/api/notebooks/move', (req, res) => {
  try {
    const { noteRelPath, targetCategoryPath } = req.body;
    if (!noteRelPath || targetCategoryPath === undefined) {
      return res.status(400).json({ error: '請提供 noteRelPath 與 targetCategoryPath' });
    }

    const noteFullPath = resolveNoteFullPath(noteRelPath);
    if (!noteFullPath || !fs.existsSync(noteFullPath)) {
      return res.status(404).json({ error: '找不到來源筆記' });
    }

    const fileName = path.basename(noteFullPath);
    const targetDir = targetCategoryPath
      ? path.join(NOTEBOOKS_DIR, targetCategoryPath)
      : NOTEBOOKS_DIR;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFile = path.join(targetDir, fileName);
    if (noteFullPath.toLowerCase() === targetFile.toLowerCase()) {
      return res.json({ success: true, message: '路徑未改變', newPath: noteRelPath });
    }

    if (fs.existsSync(targetFile)) {
      return res.status(400).json({ error: `目標目錄已存在同名筆記 [${fileName}]` });
    }

    fs.renameSync(noteFullPath, targetFile);

    // 更新搬移後的 frontmatter category
    try {
      const raw = readFileUtf8(targetFile);
      const parsed = frontMatter(raw);
      parsed.attributes.category = targetCategoryPath;
      const frontmatterLines = ['---'];
      for (const [k, v] of Object.entries(parsed.attributes)) {
        if (Array.isArray(v)) {
          frontmatterLines.push(`${k}: [${v.map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(', ')}]`);
        } else if (typeof v === 'boolean') {
          frontmatterLines.push(`${k}: ${v}`);
        } else {
          frontmatterLines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`);
        }
      }
      frontmatterLines.push('---', '', parsed.body || '');
      writeFileUtf8Bom(targetFile, frontmatterLines.join('\n'));
    } catch (fmErr) {
      console.warn('更新搬遷筆記 frontmatter 失敗:', fmErr);
    }

    const newRelPath = path.relative(NOTEBOOKS_DIR, targetFile).replace(/\\/g, '/');
    res.json({ success: true, oldPath: noteRelPath, newPath: newRelPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notebooks/note', (req, res) => {
  try {
    const { path: noteRelPath } = req.query;
    if (!noteRelPath) return res.status(400).json({ error: '請提供 path 參數' });

    const noteFullPath = resolveNoteFullPath(noteRelPath);
    if (!noteFullPath || !fs.existsSync(noteFullPath)) {
      return res.status(404).json({ error: '找不到該筆記' });
    }

    const raw = readFileUtf8(noteFullPath);
    const parsed = frontMatter(raw);

    let images = [];
    // 檢查集中 assets 目錄與傳統 images 目錄
    const parentDir = path.dirname(noteFullPath);
    const legacyImagesDir = path.join(parentDir, 'images');
    if (fs.existsSync(legacyImagesDir)) {
      images = fs.readdirSync(legacyImagesDir).map(img => `/data/notebooks/${path.relative(NOTEBOOKS_DIR, legacyImagesDir).replace(/\\/g, '/')}/${img}`);
    }

    const cleanBaseName = path.basename(noteFullPath).replace(/\.md$/, '').replace(/^index$/, path.basename(parentDir));
    const finalRel = path.relative(NOTEBOOKS_DIR, noteFullPath).replace(/\\/g, '/');

    res.json({
      success: true,
      title: (parsed.attributes && parsed.attributes.title) ? parsed.attributes.title : cleanBaseName,
      category: (parsed.attributes && parsed.attributes.category) ? parsed.attributes.category : path.dirname(finalRel).replace(/^\.$/, ''),
      date: (parsed.attributes && parsed.attributes.date) ? parsed.attributes.date : '',
      tags: (parsed.attributes && parsed.attributes.tags) ? parsed.attributes.tags : [],
      content: parsed.body,
      images,
      relPath: finalRel
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notebooks', (req, res) => {
  try {
    const { category, title, content, tags, oldRelPath } = req.body;
    if (!category || !title) return res.status(400).json({ error: 'category 與 title 為必填' });

    const cleanTitle = title.trim().replace(/[/\\?%*:|"<>]/g, '_');
    const targetDir = path.join(NOTEBOOKS_DIR, category);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const newFilePath = path.join(targetDir, `${cleanTitle}.md`);
    const newRelPath = `${category}/${cleanTitle}.md`;

    // 若為重命名或移位，處理舊檔案移除
    if (oldRelPath) {
      const oldFullPath = resolveNoteFullPath(oldRelPath);
      if (oldFullPath && fs.existsSync(oldFullPath) && oldFullPath.toLowerCase() !== newFilePath.toLowerCase()) {
        if (fs.statSync(oldFullPath).isFile()) {
          fs.unlinkSync(oldFullPath);
        } else if (fs.statSync(oldFullPath).isDirectory()) {
          fs.rmSync(oldFullPath, { recursive: true, force: true });
        }
      }
    }

    const tagsArray = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(s => s.trim()).filter(Boolean) : []);
    const frontmatterText = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `category: "${category.replace(/"/g, '\\"')}"`,
      `date: "${new Date().toISOString().split('T')[0]}"`,
      `tags: [${tagsArray.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`,
      '---',
      '',
      content || ''
    ].join('\n');

    writeFileUtf8Bom(newFilePath, frontmatterText);

    res.json({
      success: true,
      relPath: newRelPath
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notebooks', (req, res) => {
  try {
    const { path: noteRelPath } = req.query;
    if (!noteRelPath) return res.status(400).json({ error: '請提供 path' });
    const noteFullPath = resolveNoteFullPath(noteRelPath);
    if (noteFullPath && fs.existsSync(noteFullPath)) {
      if (fs.statSync(noteFullPath).isFile()) {
        fs.unlinkSync(noteFullPath);
      } else {
        fs.rmSync(noteFullPath, { recursive: true, force: true });
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. Templates API ---
app.get('/api/templates', (req, res) => {
  try {
    const templates = [];
    if (fs.existsSync(TEMPLATES_DIR)) {
      const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
      files.forEach(f => {
        const raw = readFileUtf8(path.join(TEMPLATES_DIR, f));
        templates.push({
          filename: f,
          name: f.replace(/^\d+_?/, '').replace(/\.md$/, ''),
          content: raw
        });
      });
    }
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 4. Image Upload & WebP Central Assets Storage ---
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上傳任何圖片' });

    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

    const timestamp = Date.now();
    const filename = `img_${timestamp}.webp`;
    const outputPath = path.join(ASSETS_DIR, filename);

    await sharp(req.file.buffer)
      .webp({ quality: 85 })
      .toFile(outputPath);

    const publicUrl = `/data/assets/${filename}`;
    res.json({
      success: true,
      filename,
      url: publicUrl,
      markdown: `![螢幕截圖](${publicUrl})`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 5. Global Full-text Search API ---
app.get('/api/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ success: true, results: [] });

    const query = q.trim().toLowerCase();
    const results = [];

    // Search in Todos (monthly JSONs)
    if (fs.existsSync(TODOS_DIR)) {
      const jsonFiles = fs.readdirSync(TODOS_DIR).filter(f => f.endsWith('.json'));
      jsonFiles.forEach(jf => {
        const tasks = readMonthTodos(jf.replace('.json', ''));
        tasks.forEach(t => {
          const matchTarget = `${t.title || ''} ${t.client || ''} ${t.content || ''} ${(t.steps || []).map(s => (s && s.text) || '').join(' ')}`.toLowerCase();
          if (matchTarget.includes(query)) {
            results.push({
              type: 'todo',
              title: t.title || '未命名任務',
              date: t.date || t.startDate || '',
              id: t.id,
              client: t.client || '',
              snippet: getSnippet(t.content || t.title, query)
            });
          }
        });
      });
    }

    // Search in Notebooks
    function searchNotebookFolder(dirPath, relPath) {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(dirPath, entry.name);
          const raw = readFileUtf8(filePath);
          if (raw.toLowerCase().includes(query)) {
            const parsed = frontMatter(raw);
            const noteRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            results.push({
              type: 'notebook',
              title: (parsed.attributes && parsed.attributes.title) ? parsed.attributes.title : entry.name.replace(/\.md$/, ''),
              category: relPath,
              path: noteRel,
              snippet: getSnippet(raw, query)
            });
          }
        } else if (entry.isDirectory() && entry.name !== 'images' && entry.name !== 'assets') {
          searchNotebookFolder(path.join(dirPath, entry.name), relPath ? `${relPath}/${entry.name}` : entry.name);
        }
      }
    }
    searchNotebookFolder(NOTEBOOKS_DIR, '');

    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getSnippet(text, query) {
  if (!text) return '';
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return text.slice(0, 100);
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + query.length + 60);
  return '...' + text.slice(start, end).replace(/\n/g, ' ') + '...';
}

// --- 6. 智慧心跳與自動停止服務 (Heartbeat Auto-Shutdown Lifecycle) ---
let lastHeartbeatTime = Date.now();
let hasReceivedFirstHeartbeat = false;
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘 (600,000 ms)
const INITIAL_GRACE_PERIOD_MS = 10 * 60 * 1000; // 啟動初期寬限 10 分鐘
const serverStartTime = Date.now();

app.get('/api/heartbeat', (req, res) => {
  lastHeartbeatTime = Date.now();
  hasReceivedFirstHeartbeat = true;
  res.json({ ok: true, timestamp: lastHeartbeatTime });
});

app.post('/api/heartbeat/stop', (req, res) => {
  res.json({ ok: true, message: 'Stopping server...' });
  setTimeout(() => {
    console.log('🛑 [Shutdown] 收到停止請求，正在安全退出...');
    process.exit(0);
  }, 200);
});

// 每 5 秒檢查一次是否心跳中斷（支援 NO_AUTO_SHUTDOWN 常駐模式）
let heartbeatTimer = null;
if (process.env.NO_AUTO_SHUTDOWN === 'true' || process.argv.includes('--no-auto-shutdown')) {
  console.log('🛡️ [Server] 已啟用常駐模式 (--no-auto-shutdown)，關閉自動退出計時器。');
} else {
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    if (!hasReceivedFirstHeartbeat) {
      if (now - serverStartTime > INITIAL_GRACE_PERIOD_MS) {
        console.log('💓 [AutoShutdown] 啟動後超過 10 分鐘未檢測到任何網頁分頁連線，自動退出背景守護程序。');
        clearInterval(heartbeatTimer);
        process.exit(0);
      }
      return;
    }

    if (now - lastHeartbeatTime > HEARTBEAT_TIMEOUT_MS) {
      console.log('💓 [AutoShutdown] 偵測到所有網頁分頁已關閉（超過 10 分鐘無心跳），自動安全退出背景服務。');
      clearInterval(heartbeatTimer);
      process.exit(0);
    }
  }, 5000);
}

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 個人工作資產與日曆式知識庫系統已啟動！`);
  console.log(`🌐 網址：http://localhost:${PORT}`);
  console.log(`📂 資料庫路徑：${DATA_DIR}`);

  // 自動執行 CSS 樣式健全防呆檢查，預防跑版
  try {
    const { checkCssHealth } = require('../scripts/checkCss');
    const cssHealth = checkCssHealth(path.join(__dirname, '..', 'client', 'style.css'));
    if (!cssHealth.ok) {
      console.warn(`\x1b[33m⚠️ [樣式警示] 偵測到 style.css 括號異常，可能有跑版風險！\x1b[0m`);
      console.warn(`👉 請執行: npm run fix:css 進行自動修復。`);
    } else {
      console.log(`🎨 [樣式健全] CSS 樣式表解析正常，無跑版風險。`);
    }
  } catch (err) {}
  console.log(`=======================================================`);
});

