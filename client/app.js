/**
 * Personal WorkHub - Client Application
 * Features:
 * 1. Direct WYSIWYG Editing (直接閱讀排版編輯，背後自動存 MD 檔)
 * 2. Notion-style Hierarchical Sub-steps Checklist
 * 3. 100% Inline Category Renaming (原地更名，免 prompt)
 * 4. One-click Todo Deletion (待辦快速刪除)
 * 5. Instant Full-text Search (Ctrl+K)
 */

// Enable breaks in marked
if (typeof marked !== 'undefined') {
  marked.use({ breaks: true, gfm: true });
}

// Initialize Turndown (HTML to Markdown Converter)
let turndownService = null;
if (typeof TurndownService !== 'undefined') {
  turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    hr: '---',
    bulletListMarker: '-'
  });

  // Keep table, thead, tbody, tr, th, td, details, summary, span, font, mark in markdown with exact structure!
  turndownService.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'span', 'font', 'mark']);

  // Ignore Callout icon span during HTML-to-Markdown conversion so icon emoji is not duplicated
  turndownService.addRule('calloutIcon', {
    filter: function (node) {
      return node.classList && node.classList.contains('callout-icon');
    },
    replacement: function () {
      return '';
    }
  });

  // Convert Callout blocks to GitHub Alert Markdown (> [!NOTE]) preserving inner lists and formatting
  turndownService.addRule('calloutBlock', {
    filter: function (node) {
      return node.classList && node.classList.contains('callout-block');
    },
    replacement: function (content, node) {
      let type = 'NOTE';
      if (node.classList.contains('callout-warning')) type = 'WARNING';
      else if (node.classList.contains('callout-tip')) type = 'TIP';
      else if (node.classList.contains('callout-danger')) type = 'IMPORTANT';
      const lines = content.trim().split('\n').map(l => l.trim() ? `> ${l}` : '>').join('\n');
      return `\n\n> [!${type}]\n${lines}\n\n`;
    }
  });

  // Convert Notion-style .todo-item-line to markdown checklist
  turndownService.addRule('todoItemLine', {
    filter: function (node) {
      return node.classList && node.classList.contains('todo-item-line');
    },
    replacement: function (content, node) {
      const cb = node.querySelector('.interactive-todo-cb');
      const span = node.querySelector('.todo-text-span');
      const isChecked = cb && (cb.checked || cb.hasAttribute('checked') || cb.getAttribute('checked') === 'checked');
      const text = span ? (span.innerText || span.textContent).trim() : node.textContent.trim();
      const level = parseInt(node.dataset.level || '0', 10);
      const indent = '  '.repeat(level);
      return `\n${indent}- [${isChecked ? 'x' : ' '}] ${text}`;
    }
  });
}

// Convert HTML to Markdown safely (無縫互轉，無多餘空行或程式碼區塊誤觸)
function htmlToMarkdown(html) {
  if (!html) return '';
  if (turndownService) {
    try {
      return turndownService.turndown(html);
    } catch (e) {
      console.warn('Turndown conversion warning:', e);
    }
  }
  return html;
}

// Render Markdown to HTML and enhance GitHub Alert Callouts
function renderMarkdownToHtml(md) {
  if (!md) return '';
  // 0. 修剪縮排 callout 前多餘空格，防止 marked 誤將帶有縮排的 > [!NOTE] 識別為 <pre><code> 代碼區塊
  let processedMd = md.replace(/^([ \t]+)(>.*)$/gm, '$2');
  // Convert Markdown checklist syntax with multi-level indentation to interactive checkboxes
  processedMd = processedMd
    .replace(/^([ \t]*)-\s*\[([ xX])\]\s*(.*)$/gm, (match, spaces, checkChar, text) => {
      const spaceCount = (spaces || '').replace(/\t/g, '  ').length;
      const level = Math.floor(spaceCount / 2);
      const isChecked = checkChar.toLowerCase() === 'x';
      const indentPx = level * 24;
      return `<div class="todo-item-line${isChecked ? ' is-done' : ''}" data-level="${level}" style="margin-left: ${indentPx}px;"><input type="checkbox" class="interactive-todo-cb"${isChecked ? ' checked' : ''}><span class="todo-text-span" contenteditable="true">${text}</span></div>`;
    });
  let html = marked.parse(processedMd);
  // 1. 清理 todo-item-line 標籤之間的游離換行與空白，確保行距緊湊
  html = html.replace(/<\/div>\s*<div class="todo-item-line/g, '</div><div class="todo-item-line');
  // 2. 清理標題 (h1-h6) 與待辦清單之間的過大空隙與游離空段落
  html = html.replace(/<\/h([1-6])>\s*(<p>\s*<\/p>\s*)*\s*<div class="todo-item-line/gi, '</h$1><div class="todo-item-line');
  // 3. 清理多餘的完全空白段落
  html = html.replace(/<p>\s*<\/p>/gi, '');
  // Transform GitHub alert blockquotes into rich callout blocks
  html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([\s\S]*?)<\/blockquote>/gi, (match, type, content) => {
    type = type.toUpperCase();
    let cls = 'callout-note', icon = '💡';
    if (type === 'WARNING' || type === 'CAUTION') { cls = 'callout-warning'; icon = '⚠️'; }
    else if (type === 'TIP') { cls = 'callout-tip'; icon = '✨'; }
    else if (type === 'IMPORTANT') { cls = 'callout-danger'; icon = '🔥'; }

    let body = content.trim();
    if (body.startsWith('</p>')) {
      body = body.slice(4).trim();
    } else {
      body = body.replace(/^(<br\s*\/?>)+/i, '').trim();
      body = '<p>' + body;
    }
    if (!body) body = '<p><br></p>';
    return `<div class="callout-block ${cls}"><span class="callout-icon">${icon}</span><div class="callout-content">${body}</div></div>`;
  });
  return html;
}

// 本地狀態持久化鍵名 (LocalStorage Keys)
const STORAGE_KEYS = {
  ACTIVE_VIEW: 'workhub_active_view',
  ACTIVE_NOTE_PATH: 'workhub_active_note_path',
  SELECTED_DATE: 'workhub_selected_date',
  OPEN_TASK_ID: 'workhub_open_task_id',
  OPEN_TASK_DATE: 'workhub_open_task_date'
};

// Application State
const state = {
  currentDate: new Date(),
  selectedDate: getFormattedDate(new Date()),
  monthData: {},
  selectedDayTasks: [],
  currentEditingTask: null,

  // Notebooks State
  templates: [],
  notebookTree: [],
  currentNotebookNote: null,

  // App UI State
  activeView: 'calendar',
  calendarViewMode: 'month',
  collapsedCategories: new Set(),
  saveDebounceTimer: null,
  notebookEditMode: 'wysiwyg',
  modalTaskEditMode: 'wysiwyg'
};

// DOM Elements
const elements = {
  // Navigation Tabs
  tabCalendarBtn: document.getElementById('tabCalendarBtn'),
  tabNotebookBtn: document.getElementById('tabNotebookBtn'),
  calendarView: document.getElementById('calendarView'),
  notebookView: document.getElementById('notebookView'),
  
  // 1. Calendar
  calViewMonthBtn: document.getElementById('calViewMonthBtn'),
  calViewWeekBtn: document.getElementById('calViewWeekBtn'),
  calViewDayBtn: document.getElementById('calViewDayBtn'),
  calendarWeekGrid: document.getElementById('calendarWeekGrid'),
  calendarDayView: document.getElementById('calendarDayView'),
  drawerCollapseBtn: document.getElementById('drawerCollapseBtn'),
  calendarToggleDrawerBtn: document.getElementById('calendarToggleDrawerBtn'),
  calendarToggleDrawerIcon: document.getElementById('calendarToggleDrawerIcon'),
  calendarSideDrawer: document.getElementById('calendarSideDrawer'),
  sidebarCollapseBtn: document.getElementById('sidebarCollapseBtn'),
  notebookToggleSidebarBtn: document.getElementById('notebookToggleSidebarBtn'),
  notebookToggleSidebarIcon: document.getElementById('notebookToggleSidebarIcon'),
  notebookZenModeBtn: document.getElementById('notebookZenModeBtn'),
  notebookZenModeIcon: document.getElementById('notebookZenModeIcon'),
  notebookCanvas: document.getElementById('notebookCanvas'),
  notebookSidebar: document.getElementById('notebookSidebar'),
  tableGridPicker: document.getElementById('tableGridPicker'),
  tableGridMatrix: document.getElementById('tableGridMatrix'),
  imageFloatToolbar: document.getElementById('imageFloatToolbar'),
  prevMonthBtn: document.getElementById('prevMonthBtn'),
  nextMonthBtn: document.getElementById('nextMonthBtn'),
  todayBtn: document.getElementById('todayBtn'),
  currentMonthLabel: document.getElementById('currentMonthLabel'),
  monthStatsText: document.getElementById('monthStatsText'),
  calendarGrid: document.getElementById('calendarGrid'),
  selectedDateTitle: document.getElementById('selectedDateTitle'),
  selectedDateSubtitle: document.getElementById('selectedDateSubtitle'),
  dayTaskBadge: document.getElementById('dayTaskBadge'),
  selectedDayTaskList: document.getElementById('selectedDayTaskList'),
  openNewTaskModalBtn: document.getElementById('openNewTaskModalBtn'),
  quickAddTaskInput: document.getElementById('quickAddTaskInput'),

  // 2. Center Modal (100% Notion 頁面格式：大標題 + 鍵值屬性 + 整頁向下流暢滾動)
  taskCenterModal: document.getElementById('taskCenterModal'),
  modalExpandBtn: document.getElementById('modalExpandBtn'),
  notionPageScrollable: document.getElementById('notionPageScrollable'),
  modalTaskCompletedCheckbox: document.getElementById('modalTaskCompletedCheckbox'),
  modalTaskDoneLabel: document.getElementById('modalTaskDoneLabel'),
  modalTaskTitleInput: document.getElementById('modalTaskTitleInput'),
  modalTaskClientInput: document.getElementById('modalTaskClientInput'),
  modalTaskStatusSelect: document.getElementById('modalTaskStatusSelect'),
  modalTaskDateText: document.getElementById('modalTaskDateText'),
  modalTaskStartDate: document.getElementById('modalTaskStartDate'),
  modalTaskEndDate: document.getElementById('modalTaskEndDate'),
  modalTaskPrioritySelect: document.getElementById('modalTaskPrioritySelect'),
  
  // Direct WYSIWYG Notes Canvas
  modalTemplateSelect: document.getElementById('modalTemplateSelect'),
  modalImageInput: document.getElementById('modalImageInput'),
  modalTaskWysiwygEditor: document.getElementById('modalTaskWysiwygEditor'),
  modalSaveStatus: document.getElementById('modalSaveStatus'),
  promoteToNotebookBtn: document.getElementById('promoteToNotebookBtn'),
  deleteTaskModalBtn: document.getElementById('deleteTaskModalBtn'),
  closeTaskModalBtn: document.getElementById('closeTaskModalBtn'),
  closeTaskModalActionBtn: document.getElementById('closeTaskModalActionBtn'),

  // 3. Notebook View (Direct WYSIWYG & Source)
  notebookTreeList: document.getElementById('notebookTreeList'),
  addCategoryBtn: document.getElementById('addCategoryBtn'),
  notebookCanvas: document.getElementById('notebookCanvas'),
  notebookDocTitle: document.getElementById('notebookDocTitle'),
  notebookCategorySelect: document.getElementById('notebookCategorySelect'),
  notebookTemplateSelect: document.getElementById('notebookTemplateSelectToolbar'),
  deleteNoteBtn: document.getElementById('deleteNoteBtn'),
  notebookImageInput: document.getElementById('notebookImageInput'),
  notebookWysiwygEditor: document.getElementById('notebookWysiwygEditor'),
  notebookMarkdownSource: document.getElementById('notebookMarkdownSource'),
  notebookSaveBtn: document.getElementById('notebookSaveBtn'),
  notebookToggleModeBtn: document.getElementById('notebookToggleModeBtn'),
  notebookModeIcon: document.getElementById('notebookModeIcon'),
  notebookModeText: document.getElementById('notebookModeText'),
  notebookSaveStatus: document.getElementById('notebookSaveStatus'),

  // Modal Action Buttons
  modalSaveTaskBtn: document.getElementById('modalSaveTaskBtn'),
  modalToggleModeBtn: document.getElementById('modalToggleModeBtn'),
  modalModeIcon: document.getElementById('modalModeIcon'),
  modalModeText: document.getElementById('modalModeText'),
  modalTaskMarkdownSource: document.getElementById('modalTaskMarkdownSource'),

  // 4. Search
  searchTriggerBtn: document.getElementById('searchTriggerBtn'),
  searchModal: document.getElementById('searchModal'),
  searchInputField: document.getElementById('searchInputField'),
  searchResultsList: document.getElementById('searchResultsList'),
  closeSearchModalBtn: document.getElementById('closeSearchModalBtn'),

  // Lightbox & Toast
  lightboxModal: document.getElementById('lightboxModal'),
  lightboxImage: document.getElementById('lightboxImage'),
  toastContainer: document.getElementById('toastContainer')
};

// --- Initialization ---

// --- Heartbeat Auto-Shutdown Loop ---
function startHeartbeatLoop() {
  const ping = () => {
    fetch('/api/heartbeat').catch(() => {});
  };
  ping();
  setInterval(ping, 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
  startHeartbeatLoop();
  setupEventListeners();

  // 1. 優先還原最後選取的日期
  const savedDate = localStorage.getItem(STORAGE_KEYS.SELECTED_DATE);
  if (savedDate && /^\d{4}-\d{2}-\d{2}$/.test(savedDate)) {
    state.selectedDate = savedDate;
    state.currentDate = new Date(savedDate);
  }

  await loadTemplates();
  await refreshCalendar();
  await loadSelectedDayTasks(state.selectedDate);
  await loadNotebookTree();

  // 2. 依據持久化狀態無縫恢復上次停留的視圖與筆記/待辦
  const savedView = localStorage.getItem(STORAGE_KEYS.ACTIVE_VIEW);
  if (savedView === 'notebook') {
    switchView('notebook');
    const savedNotePath = localStorage.getItem(STORAGE_KEYS.ACTIVE_NOTE_PATH);
    if (savedNotePath) {
      await loadNotebookNote(savedNotePath);
    }
  } else {
    switchView('calendar');
    // 檢查是否有正在開啟編輯的待辦任務彈窗
    const openTaskId = localStorage.getItem(STORAGE_KEYS.OPEN_TASK_ID);
    const openTaskDate = localStorage.getItem(STORAGE_KEYS.OPEN_TASK_DATE) || state.selectedDate;
    if (openTaskId) {
      if (openTaskDate !== state.selectedDate) {
        state.selectedDate = openTaskDate;
        await loadSelectedDayTasks(openTaskDate);
      }
      const targetTask = state.selectedDayTasks.find(t => t.id === openTaskId);
      if (targetTask) {
        openTaskModal(targetTask);
      }
    }
  }
});

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Navigation Tabs
  elements.tabCalendarBtn.addEventListener('click', () => switchView('calendar'));
  elements.tabNotebookBtn.addEventListener('click', () => switchView('notebook'));

  // Calendar Controls
  elements.prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  elements.nextMonthBtn.addEventListener('click', () => changeMonth(1));
  elements.todayBtn.addEventListener('click', () => {
    state.currentDate = new Date();
    state.selectedDate = getFormattedDate(new Date());
    refreshCalendar();
    loadSelectedDayTasks(state.selectedDate);
  });
  elements.openNewTaskModalBtn.addEventListener('click', () => openNewTaskModal(state.selectedDate));

  // Calendar View Switcher (Month / Week / Day)
  if (elements.calViewMonthBtn) elements.calViewMonthBtn.addEventListener('click', () => switchCalendarView('month'));
  if (elements.calViewWeekBtn) elements.calViewWeekBtn.addEventListener('click', () => switchCalendarView('week'));
  if (elements.calViewDayBtn) elements.calViewDayBtn.addEventListener('click', () => switchCalendarView('day'));

  // Collapsible Right Drawer (整合至頂部工具列)
  if (elements.calendarToggleDrawerBtn) {
    elements.calendarToggleDrawerBtn.addEventListener('click', () => {
      elements.calendarSideDrawer.classList.toggle('collapsed');
      updateCalendarDrawerToggleState();
    });
  }
  if (elements.drawerCollapseBtn) {
    elements.drawerCollapseBtn.addEventListener('click', () => {
      elements.calendarSideDrawer.classList.add('collapsed');
      updateCalendarDrawerToggleState();
    });
  }

  function updateNotebookSidebarToggleState() {
    if (!elements.notebookSidebar) return;
    const isCollapsed = elements.notebookSidebar.classList.contains('collapsed');
    if (elements.notebookToggleSidebarBtn) {
      elements.notebookToggleSidebarBtn.classList.toggle('is-collapsed', isCollapsed);
    }
    if (elements.notebookToggleSidebarIcon) {
      elements.notebookToggleSidebarIcon.textContent = isCollapsed ? '◧' : '◨';
    }
  }

  // Collapsible Notebook Sidebar
  if (elements.notebookToggleSidebarBtn) {
    elements.notebookToggleSidebarBtn.addEventListener('click', () => {
      elements.notebookSidebar.classList.toggle('collapsed');
      updateNotebookSidebarToggleState();
    });
  }
  if (elements.sidebarCollapseBtn) {
    elements.sidebarCollapseBtn.addEventListener('click', () => {
      elements.notebookSidebar.classList.add('collapsed');
      updateNotebookSidebarToggleState();
    });
  }

  // Notebook Zen Mode (沉浸式滿版放大，自動收折側邊欄，釋放 100% 寬度)
  if (elements.notebookZenModeBtn) {
    elements.notebookZenModeBtn.addEventListener('click', () => {
      if (!elements.notebookCanvas) return;
      const isZen = elements.notebookCanvas.classList.toggle('zen-mode');
      elements.notebookZenModeBtn.classList.toggle('active', isZen);
      elements.notebookZenModeBtn.innerHTML = `<span id="notebookZenModeIcon">${isZen ? '🗗' : '⛶'}</span> ${isZen ? '還原尺寸' : '滿版放大'}`;
      elements.notebookZenModeBtn.title = isZen ? '還原視窗模式 (ESC)' : '滿版放大模式';
      if (isZen && elements.notebookSidebar) {
        elements.notebookSidebar.classList.add('collapsed');
        updateNotebookSidebarToggleState();
      }
    });
  }

  // Init Table Grid Picker
  setupTableGridPicker();

  // Setup WYSIWYG global interactive enhancements (Checkboxes, Image Resize, Undo/Redo/SelectAll)
  setupCanvasInteractiveHandlers(elements.modalTaskWysiwygEditor, () => triggerTaskDebouncedSave());
  setupCanvasInteractiveHandlers(elements.notebookWysiwygEditor, () => triggerNotebookDebouncedSave());

  // Center Modal Controls
  if (elements.closeTaskModalBtn) elements.closeTaskModalBtn.addEventListener('click', closeTaskModal);
  if (elements.closeTaskModalActionBtn) elements.closeTaskModalActionBtn.addEventListener('click', closeTaskModal);
  // 智慧防拖曳防護：雙重檢驗 mousedown 與 mouseup，避免在畫布內反白文字拖出框外放開時造成畫布閃退
  attachSafeOverlayClose(elements.taskCenterModal, closeTaskModal);
  if (elements.deleteTaskModalBtn) elements.deleteTaskModalBtn.addEventListener('click', handleDeleteCurrentTaskFromModal);

  // Modal Expand / Fullscreen Toggle (Notion 頁面視窗縮放)
  if (elements.modalExpandBtn) {
    elements.modalExpandBtn.addEventListener('click', () => {
      const modalCanvas = elements.taskCenterModal.querySelector('.modal-center-canvas');
      if (modalCanvas) {
        const isExp = modalCanvas.classList.toggle('is-expanded');
        elements.modalExpandBtn.textContent = isExp ? '🗗' : '⛶';
        elements.modalExpandBtn.title = isExp ? '還原視窗尺寸' : '全螢幕 / 視窗切換';
      }
    });
  }

  // Quick Add Task in Calendar Side Drawer (極簡外層：按 Enter 立即建立並渲染)
  if (elements.quickAddTaskInput) {
    elements.quickAddTaskInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const title = elements.quickAddTaskInput.value.trim();
        if (!title) return;
        elements.quickAddTaskInput.disabled = true;
        try {
          const newTask = {
            id: `task_${Date.now()}`,
            title: title,
            date: state.selectedDate,
            startDate: state.selectedDate,
            endDate: state.selectedDate,
            completed: false,
            client: '一般',
            status: '進行中',
            priority: 'normal',
            tags: [],
            steps: [],
            content: ''
          };
          const res = await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newTask)
          });
          const result = await res.json();
          if (result.success) {
            elements.quickAddTaskInput.value = '';
            showToast('已快速建立任務');
            await refreshCalendar();
            await loadSelectedDayTasks(state.selectedDate);
          } else {
            showToast('建立失敗: ' + (result.error || '未知錯誤'));
          }
        } catch (err) {
          showToast('建立失敗: ' + err.message);
        } finally {
          elements.quickAddTaskInput.disabled = false;
          elements.quickAddTaskInput.focus();
        }
      }
    });
  }

  // Modal Properties Change
  const propInputs = [
    elements.modalTaskTitleInput,
    elements.modalTaskClientInput,
    elements.modalTaskStatusSelect,
    elements.modalTaskPrioritySelect,
    elements.modalTaskCompletedCheckbox,
    elements.modalTaskStartDate,
    elements.modalTaskEndDate
  ].filter(Boolean);
  propInputs.forEach(inp => {
    inp.addEventListener('input', triggerTaskDebouncedSave);
    inp.addEventListener('change', triggerTaskDebouncedSave);
  });

  // Sync Done Checkbox with Label Text
  if (elements.modalTaskCompletedCheckbox) {
    elements.modalTaskCompletedCheckbox.addEventListener('change', () => {
      if (elements.modalTaskDoneLabel) {
        elements.modalTaskDoneLabel.textContent = elements.modalTaskCompletedCheckbox.checked ? '已完成' : '未完成';
      }
    });
  }

  if (elements.modalTaskStartDate && elements.modalTaskEndDate) {
    elements.modalTaskStartDate.addEventListener('change', () => {
      if (elements.modalTaskEndDate.value < elements.modalTaskStartDate.value) {
        elements.modalTaskEndDate.value = elements.modalTaskStartDate.value;
      }
      triggerTaskDebouncedSave();
    });
    elements.modalTaskEndDate.addEventListener('change', () => {
      if (elements.modalTaskStartDate.value > elements.modalTaskEndDate.value) {
        elements.modalTaskStartDate.value = elements.modalTaskEndDate.value;
      }
      triggerTaskDebouncedSave();
    });
  }



  // Direct WYSIWYG Input for Task Note
  if (elements.modalTaskWysiwygEditor) {
    elements.modalTaskWysiwygEditor.addEventListener('input', triggerTaskDebouncedSave);
  }

  // Paste Screenshot Handler (Task Modal WYSIWYG)
  elements.modalTaskWysiwygEditor.addEventListener('paste', (e) => {
    handlePasteImageWysiwyg(e, 'todo', elements.modalTaskWysiwygEditor, () => triggerTaskDebouncedSave());
  });
  elements.modalImageInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadFileImageWysiwyg(e.target.files[0], 'todo', elements.modalTaskWysiwygEditor, () => triggerTaskDebouncedSave());
    }
  });

  // Template select in Task Modal
  elements.modalTemplateSelect.addEventListener('change', (e) => {
    applyTemplateToWysiwyg(e.target.value, elements.modalTaskWysiwygEditor, () => triggerTaskDebouncedSave());
    e.target.value = '';
  });

  // Promote Task to Notebook
  elements.promoteToNotebookBtn.addEventListener('click', handlePromoteToNotebook);

  // --- Notebooks View Events (Direct WYSIWYG) ---
  elements.addCategoryBtn.addEventListener('click', handleAddCategory);
  elements.notebookDocTitle.addEventListener('input', triggerNotebookDebouncedSave);
  elements.notebookCategorySelect.addEventListener('change', () => {
    if (state.currentNotebookNote) {
      state.currentNotebookNote.category = elements.notebookCategorySelect.value;
    }
    triggerNotebookDebouncedSave();
  });
  elements.notebookWysiwygEditor.addEventListener('input', triggerNotebookDebouncedSave);
  if (elements.notebookMarkdownSource) {
    elements.notebookMarkdownSource.addEventListener('input', triggerNotebookDebouncedSave);
    elements.notebookMarkdownSource.addEventListener('paste', () => {
      setTimeout(triggerNotebookDebouncedSave, 10);
    });
  }

  if (elements.modalTaskMarkdownSource) {
    elements.modalTaskMarkdownSource.addEventListener('input', triggerTaskDebouncedSave);
    elements.modalTaskMarkdownSource.addEventListener('paste', () => {
      setTimeout(triggerTaskDebouncedSave, 10);
    });
  }

  // Notebook Manual Save & Source Mode Toggle Buttons
  if (elements.notebookSaveBtn) {
    elements.notebookSaveBtn.addEventListener('click', async () => {
      await saveNotebookNoteImmediate();
      showToast('✅ 筆記已成功儲存至硬碟！');
    });
  }
  if (elements.notebookToggleModeBtn) {
    elements.notebookToggleModeBtn.addEventListener('click', () => toggleNotebookMarkdownMode());
  }

  // Task Modal Manual Save & Source Mode Toggle Buttons
  if (elements.modalSaveTaskBtn) {
    elements.modalSaveTaskBtn.addEventListener('click', async () => {
      await saveTaskImmediate();
      showToast('✅ 待辦任務已儲存完畢！');
    });
  }
  if (elements.modalToggleModeBtn) {
    elements.modalToggleModeBtn.addEventListener('click', () => toggleModalTaskMarkdownMode());
  }

  elements.notebookWysiwygEditor.addEventListener('paste', (e) => {
    handlePasteImageWysiwyg(e, 'notebook', elements.notebookWysiwygEditor, () => triggerNotebookDebouncedSave());
  });
  elements.notebookImageInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadFileImageWysiwyg(e.target.files[0], 'notebook', elements.notebookWysiwygEditor, () => triggerNotebookDebouncedSave());
    }
  });
  if (elements.notebookTemplateSelect) {
    elements.notebookTemplateSelect.addEventListener('change', (e) => {
      applyTemplateToWysiwyg(e.target.value, elements.notebookWysiwygEditor, () => triggerNotebookDebouncedSave());
      e.target.value = '';
    });
  }
  elements.deleteNoteBtn.addEventListener('click', handleDeleteNote);

  // Global Keyboard Shortcuts (Ctrl+S: Save, Ctrl+/: Toggle Source Mode)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (elements.taskCenterModal && elements.taskCenterModal.classList.contains('active')) {
        saveTaskImmediate();
        showToast('✅ 待辦任務已立即儲存！');
      } else if (state.activeView === 'notebook' || (elements.notebookView && elements.notebookView.classList.contains('active'))) {
        saveNotebookNoteImmediate();
        showToast('✅ 筆記已立即儲存！');
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?')) {
      e.preventDefault();
      if (elements.taskCenterModal && elements.taskCenterModal.classList.contains('active')) {
        toggleModalTaskMarkdownMode();
      } else if (state.activeView === 'notebook' || (elements.notebookView && elements.notebookView.classList.contains('active'))) {
        toggleNotebookMarkdownMode();
      }
    }
  });

  // Formatting Toolbar Buttons (Direct WYSIWYG Commands)
  document.querySelectorAll('.tool-btn[data-action], .tool-btn[data-modal-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const isModal = btn.hasAttribute('data-modal-action');
      const action = isModal ? btn.dataset.modalAction : btn.dataset.action;
      if (action === 'table') { e.stopPropagation(); }
      const targetEditor = isModal ? elements.modalTaskWysiwygEditor : (state.activeView === 'calendar' ? elements.modalTaskWysiwygEditor : elements.notebookWysiwygEditor);
      execWysiwygCommand(targetEditor, action, btn);
      if (isModal || state.activeView === 'calendar') triggerTaskDebouncedSave();
      else triggerNotebookDebouncedSave();
    });
  });

  // Initialize Slash Commands (Notion-style /)
  initSlashCommands();

  // Initialize Collapsible Block Toolbars & Floating Bubble Menu & Color Palette
  initCollapsibleBlockToolbars();
  initFloatingBubbleMenu();
  initColorPalettePicker();

  // Global Search
  elements.searchTriggerBtn.addEventListener('click', openSearchModal);
  elements.closeSearchModalBtn.addEventListener('click', closeSearchModal);
  attachSafeOverlayClose(elements.searchModal, closeSearchModal);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearchModal();
    }
    if (e.key === 'Escape') {
      if (elements.notebookCanvas && elements.notebookCanvas.classList.contains('zen-mode')) {
        elements.notebookCanvas.classList.remove('zen-mode');
        if (elements.notebookZenModeBtn) {
          elements.notebookZenModeBtn.classList.remove('active');
          elements.notebookZenModeBtn.innerHTML = '<span id="notebookZenModeIcon">⛶</span> 滿版放大';
          elements.notebookZenModeBtn.title = '滿版放大模式';
        }
      }
      closeTaskModal();
      closeSearchModal();
      closeLightbox();
      hideColorPalettePicker();
    }
  });
  elements.searchInputField.addEventListener('input', handleGlobalSearch);

  // Lightbox
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.markdown-body')) {
      openLightbox(e.target.src);
    }
  });
  elements.lightboxModal.addEventListener('click', closeLightbox);

  // 視窗卸載前強制存檔防呆 (BeforeUnload Protection)
  window.addEventListener('beforeunload', () => {
    if (state.saveDebounceTimer) {
      clearTimeout(state.saveDebounceTimer);
      state.saveDebounceTimer = null;
      if (state.activeView === 'notebook' || (elements.notebookView && elements.notebookView.classList.contains('active'))) {
        saveNotebookNoteImmediate();
      } else {
        saveTaskImmediate();
      }
    }
  });
}

// --- View Switching ---
function switchView(viewName) {
  state.activeView = viewName;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_VIEW, viewName);
  elements.tabCalendarBtn.classList.toggle('active', viewName === 'calendar');
  elements.tabNotebookBtn.classList.toggle('active', viewName === 'notebook');
  elements.calendarView.classList.toggle('active', viewName === 'calendar');
  elements.notebookView.classList.toggle('active', viewName === 'notebook');

  if (viewName === 'calendar') {
    refreshCalendar();
  } else {
    loadNotebookTree();
  }
}

// --- 1. Calendar Logic ---
function changeMonth(direction) {
  state.currentDate.setMonth(state.currentDate.getMonth() + direction);
  refreshCalendar();
}

async function refreshCalendar() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  elements.currentMonthLabel.textContent = `${year} 年 ${month + 1} 月`;

  try {
    const res = await fetch(`/api/calendar?month=${monthStr}`);
    const data = await res.json();
    if (data.success) {
      state.monthData = data.days || {};
      renderCalendarGrid(year, month);
      
      let totalTasks = 0;
      Object.values(state.monthData).forEach(taskList => totalTasks += taskList.length);
      elements.monthStatsText.textContent = `本月共有 ${totalTasks} 項任務與步驟紀錄`;
    }
  } catch (err) {
    console.error('載入月曆失敗:', err);
  }
}

function updateCalendarDrawerToggleState() {
  if (!elements.calendarSideDrawer) return;
  const isCollapsed = elements.calendarSideDrawer.classList.contains('collapsed');
  if (elements.calendarToggleDrawerBtn) {
    elements.calendarToggleDrawerBtn.classList.toggle('is-collapsed', isCollapsed);
  }
  if (elements.calendarToggleDrawerIcon) {
    elements.calendarToggleDrawerIcon.textContent = isCollapsed ? '◧' : '◨';
  }
}

// Notion 風格月曆渲染：以週為單位（Week Rows），多日日程以跨欄橫柱連貫展示
function renderCalendarGrid(year, month) {
  elements.calendarGrid.innerHTML = '';

  // 1. 星期列表頭
  const weekdaysRow = document.createElement('div');
  weekdaysRow.className = 'calendar-weekdays-row';
  const dayHeaders = ['日', '一', '二', '三', '四', '五', '六'];
  dayHeaders.forEach(dh => {
    const header = document.createElement('div');
    header.className = 'day-name-header';
    header.textContent = `週${dh}`;
    weekdaysRow.appendChild(header);
  });
  elements.calendarGrid.appendChild(weekdaysRow);

  // 2. 計算月曆日期陣列 (涵蓋前後月補齊 35 或 42 格)
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayStr = getFormattedDate(new Date());

  const allDays = [];

  // 上個月尾天
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    allDays.push({
      dayNum,
      dateStr: getFormattedDate(prevDate),
      isOtherMonth: true
    });
  }

  // 當月天數
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const curDate = new Date(year, month, day);
    allDays.push({
      dayNum: day,
      dateStr: getFormattedDate(curDate),
      isOtherMonth: false
    });
  }

  // 下個月首天補齊
  const totalRendered = allDays.length;
  const targetTotal = (totalRendered <= 35 ? 35 : 42);
  const nextMonthCells = targetTotal - totalRendered;
  for (let day = 1; day <= nextMonthCells; day++) {
    const nextDate = new Date(year, month + 1, day);
    allDays.push({
      dayNum: day,
      dateStr: getFormattedDate(nextDate),
      isOtherMonth: true
    });
  }

  // 3. 建立週容器並分週渲染
  const weeksContainer = document.createElement('div');
  weeksContainer.className = 'calendar-weeks-container';

  for (let w = 0; w < allDays.length; w += 7) {
    const weekDays = allDays.slice(w, w + 7);
    const weekRow = createCalendarWeekRow(weekDays, todayStr);
    weeksContainer.appendChild(weekRow);
  }

  elements.calendarGrid.appendChild(weeksContainer);
}

function createCalendarWeekRow(weekDays, todayStr) {
  const weekRow = document.createElement('div');
  weekRow.className = 'calendar-week-row';

  const weekStartStr = weekDays[0].dateStr;
  const weekEndStr = weekDays[6].dateStr;

  // 1. 底層 7 欄日期格 (背景、日期數字、選取事件)
  weekDays.forEach((dayInfo) => {
    const cell = document.createElement('div');
    cell.className = 'week-day-cell';
    if (dayInfo.isOtherMonth) cell.classList.add('other-month');
    if (dayInfo.dateStr === todayStr) cell.classList.add('is-today');
    if (dayInfo.dateStr === state.selectedDate) cell.classList.add('is-selected');

    const tasks = state.monthData[dayInfo.dateStr] || [];

    const numRow = document.createElement('div');
    numRow.className = 'day-number-row';

    const numSpan = document.createElement('span');
    numSpan.className = 'day-num';
    numSpan.textContent = dayInfo.dayNum;
    numRow.appendChild(numSpan);

    if (tasks.length > 0) {
      const countBadge = document.createElement('span');
      countBadge.className = 'day-task-count-badge';
      countBadge.textContent = `${tasks.filter(t => t.completed).length}/${tasks.length}`;
      numRow.appendChild(countBadge);
    }
    cell.appendChild(numRow);

    // 點擊格子切換選取日期並展開待辦抽屜
    cell.addEventListener('click', () => {
      document.querySelectorAll('.week-day-cell.is-selected').forEach(c => c.classList.remove('is-selected'));
      cell.classList.add('is-selected');
      state.selectedDate = dayInfo.dateStr;
      if (elements.calendarSideDrawer) {
        elements.calendarSideDrawer.classList.remove('collapsed');
        updateCalendarDrawerToggleState();
      }
      loadSelectedDayTasks(dayInfo.dateStr);
    });

    weekRow.appendChild(cell);
  });

  // 2. 上層事件軌道 (多日橫跨長條與單日任務)
  const eventsLayer = document.createElement('div');
  eventsLayer.className = 'week-events-layer';

  // 彙整該週的多日事件與單日任務
  const multiDayMap = new Map();
  const singleDayTasksByCol = [[], [], [], [], [], [], []];

  weekDays.forEach((dayInfo, colIdx) => {
    const tasks = state.monthData[dayInfo.dateStr] || [];
    tasks.forEach(task => {
      if (task.isMultiDay && task.startDate && task.endDate && task.startDate !== task.endDate) {
        if (!multiDayMap.has(task.id)) {
          multiDayMap.set(task.id, task);
        }
      } else {
        singleDayTasksByCol[colIdx].push(task);
      }
    });
  });

  // 渲染 Notion 式橫跨多欄長條 (Multi-day Bar)
  if (multiDayMap.size > 0) {
    const multidayTrack = document.createElement('div');
    multidayTrack.className = 'calendar-multiday-track';

    multiDayMap.forEach(task => {
      let startCol = 1;
      let endCol = 7;
      let continueLeft = false;
      let continueRight = false;

      if (task.startDate <= weekStartStr) {
        startCol = 1;
        if (task.startDate < weekStartStr) continueLeft = true;
      } else {
        const idx = weekDays.findIndex(d => d.dateStr === task.startDate);
        startCol = idx !== -1 ? idx + 1 : 1;
      }

      if (task.endDate >= weekEndStr) {
        endCol = 7;
        if (task.endDate > weekEndStr) continueRight = true;
      } else {
        const idx = weekDays.findIndex(d => d.dateStr === task.endDate);
        endCol = idx !== -1 ? idx + 1 : 7;
      }

      if (endCol < startCol) endCol = startCol;
      const spanCols = endCol - startCol + 1;

      const bar = document.createElement('div');
      bar.className = 'multiday-bar';
      if (task.client === '北富銀') bar.classList.add('client-fubon');
      if (task.client === '國瑞汽車') bar.classList.add('client-kuorui');
      if (task.completed) bar.classList.add('completed');
      if (continueLeft) bar.classList.add('continue-left');
      if (continueRight) bar.classList.add('continue-right');

      bar.style.gridColumn = `${startCol} / span ${spanCols}`;
      bar.title = `${task.client ? '[' + task.client + '] ' : ''}${task.title} (${task.startDate} ~ ${task.endDate})`;

      const clientSpan = task.client ? `[${task.client}] ` : '';
      const stepBadge = (task.stepsCount > 0) ? ` <span style="font-size: 0.68rem; opacity: 0.85; margin-left: 4px;">☑${task.stepsCompletedCount}/${task.stepsCount}</span>` : '';
      bar.innerHTML = `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${clientSpan}${task.title}</span>${stepBadge}`;

      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        openExistingTaskModal(task.id, task.date || task.startDate);
      });

      multidayTrack.appendChild(bar);
    });

    eventsLayer.appendChild(multidayTrack);
  }

  // 渲染單日任務標籤 (Single-day Task Pills)
  const hasSingleTasks = singleDayTasksByCol.some(list => list.length > 0);
  if (hasSingleTasks) {
    const singledayTrack = document.createElement('div');
    singledayTrack.className = 'calendar-singleday-track';

    singleDayTasksByCol.forEach((tasks, colIdx) => {
      const colContainer = document.createElement('div');
      colContainer.className = 'singleday-cell-tasks';
      colContainer.style.gridColumn = `${colIdx + 1}`;

      tasks.slice(0, 2).forEach(task => {
        const pill = document.createElement('div');
        pill.className = `singleday-pill ${task.completed ? 'completed' : ''}`;
        if (task.client === '北富銀') pill.classList.add('client-fubon');
        if (task.client === '國瑞汽車') pill.classList.add('client-kuorui');
        
        const clientSpan = task.client ? `[${task.client}] ` : '';
        pill.innerHTML = `<span style="overflow: hidden; text-overflow: ellipsis;">${clientSpan}${task.title}</span>`;
        if (task.stepsCount > 0) {
          pill.innerHTML += `<span style="font-size: 0.65rem; opacity: 0.8;">☑${task.stepsCompletedCount}/${task.stepsCount}</span>`;
        }

        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          openExistingTaskModal(task.id, task.date || weekDays[colIdx].dateStr);
        });

        colContainer.appendChild(pill);
      });

      if (tasks.length > 2) {
        const morePill = document.createElement('div');
        morePill.style.fontSize = '0.68rem';
        morePill.style.color = 'var(--text-dim)';
        morePill.textContent = `+${tasks.length - 2} 更多`;
        colContainer.appendChild(morePill);
      }

      singledayTrack.appendChild(colContainer);
    });

    eventsLayer.appendChild(singledayTrack);
  }

  weekRow.appendChild(eventsLayer);
  return weekRow;
}

async function loadSelectedDayTasks(dateStr) {
  if (dateStr) {
    localStorage.setItem(STORAGE_KEYS.SELECTED_DATE, dateStr);
  }
  elements.selectedDateTitle.textContent = dateStr;
  const dateObj = new Date(dateStr);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  elements.selectedDateSubtitle.textContent = weekdays[dateObj.getDay()];

  try {
    const res = await fetch(`/api/todos?date=${dateStr}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      state.selectedDayTasks = data.tasks || [];
      renderSelectedDayTaskList();
    }
  } catch (err) {
    console.error('載入任務失敗:', err);
  }
}

function renderSelectedDayTaskList() {
  elements.selectedDayTaskList.innerHTML = '';
  elements.dayTaskBadge.textContent = `${state.selectedDayTasks.length} 項任務`;

  if (state.selectedDayTasks.length === 0) {
    elements.selectedDayTaskList.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 40px 10px;">
        本日尚無任務<br>點擊下方按鈕新增一筆分步驟卡片
      </div>
    `;
    return;
  }

  state.selectedDayTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'task-item-card';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleTaskCompletion(task.date, task.id);
    });

    const contentDiv = document.createElement('div');
    contentDiv.className = 'task-card-content';

    const titleDiv = document.createElement('div');
    titleDiv.className = `task-card-title ${task.completed ? 'completed' : ''}`;
    titleDiv.textContent = task.title;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'task-card-meta';

    if (task.client) {
      const clientTag = document.createElement('span');
      clientTag.className = 'meta-tag client-tag';
      clientTag.textContent = `🏢 ${task.client}`;
      metaDiv.appendChild(clientTag);
    }
    if (task.isMultiDay && task.startDate && task.endDate) {
      const rangeTag = document.createElement('span');
      rangeTag.className = 'meta-tag';
      rangeTag.style.color = 'var(--accent-cyan)';
      rangeTag.textContent = `📅 跨日: ${task.startDate.slice(5)} ~ ${task.endDate.slice(5)}`;
      metaDiv.appendChild(rangeTag);
    }
    if (task.status) {
      const statusTag = document.createElement('span');
      statusTag.className = 'meta-tag status-tag';
      statusTag.textContent = task.status;
      metaDiv.appendChild(statusTag);
    }
    const contentStr = task.content || '';
    const totalMatches = (contentStr.match(/^(\s*)-\s*\[([ xX])\]/gm) || []);
    const doneMatches = (contentStr.match(/^(\s*)-\s*\[[xX]\]/gm) || []);
    const stepsCount = totalMatches.length > 0 ? totalMatches.length : (Array.isArray(task.steps) ? task.steps.length : 0);
    const doneCount = totalMatches.length > 0 ? doneMatches.length : (Array.isArray(task.steps) ? task.steps.filter(s => s && s.done).length : 0);

    if (stepsCount > 0) {
      const stepsTag = document.createElement('span');
      stepsTag.className = 'meta-tag steps-tag';
      stepsTag.textContent = `☑ ${doneCount}/${stepsCount} 步驟`;
      metaDiv.appendChild(stepsTag);
    }

    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(metaDiv);

    // Delete Task Button (One-click delete)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-task-card';
    deleteBtn.title = '刪除此任務';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`確定要刪除待辦任務 [${task.title}] 嗎？`)) {
        await deleteTaskById(task.date, task.id);
      }
    });

    card.appendChild(checkbox);
    card.appendChild(contentDiv);
    card.appendChild(deleteBtn);

    card.addEventListener('click', () => openTaskCenterModal(task));
    elements.selectedDayTaskList.appendChild(card);
  });
}

async function toggleTaskCompletion(date, id) {
  try {
    const res = await fetch(`/api/todos/${date}/${id}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      await refreshCalendar();
      await loadSelectedDayTasks(date);
    }
  } catch (err) {
    showToast('更新失敗: ' + err.message);
  }
}

async function deleteTaskById(date, id) {
  try {
    const res = await fetch(`/api/todos/${date}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('任務已成功刪除');
      await refreshCalendar();
      await loadSelectedDayTasks(date);
    }
  } catch (err) {
    showToast('刪除失敗: ' + err.message);
  }
}

async function handleDeleteCurrentTaskFromModal() {
  if (!state.currentEditingTask) return;
  if (confirm(`確定要刪除任務 [${state.currentEditingTask.title || '此任務'}] 嗎？`)) {
    await deleteTaskById(state.currentEditingTask.date, state.currentEditingTask.id);
    closeTaskModal();
  }
}

// --- 2. 100% Notion-Style Free-Flow Page Modal ---
function openNewTaskModal(dateStr) {
  openTaskCenterModal({
    id: `task_${Date.now()}`,
    title: '',
    date: dateStr,
    startDate: dateStr,
    endDate: dateStr,
    completed: false,
    client: '北富銀',
    status: '進行中',
    priority: 'normal',
    tags: [],
    content: ''
  });
}

function openTaskCenterModal(task) {
  state.currentEditingTask = {
    ...task
  };

  // 平滑相容：若歷史資料含有舊版 steps 陣列，自動轉化並附加至正文 Markdown
  let content = task.content || '';
  if (Array.isArray(task.steps) && task.steps.length > 0 && !content.includes('- [')) {
    let stepsMd = '\n\n### 執行步驟清單\n';
    task.steps.forEach(st => {
      const indent = '  '.repeat(st.level || 0);
      stepsMd += `${indent}- [${st.done ? 'x' : ' '}] ${st.text || ''}\n`;
    });
    content = content + stepsMd;
    task.content = content;
    task.steps = [];
  }

  elements.modalTaskTitleInput.value = task.title || '';
  elements.modalTaskCompletedCheckbox.checked = !!task.completed;
  if (elements.modalTaskDoneLabel) {
    elements.modalTaskDoneLabel.textContent = task.completed ? '已完成' : '未完成';
  }
  if (elements.modalTaskDateText) elements.modalTaskDateText.textContent = task.date || '';
  if (elements.modalTaskStartDate) elements.modalTaskStartDate.value = task.startDate || task.date || getFormattedDate(new Date());
  if (elements.modalTaskEndDate) elements.modalTaskEndDate.value = task.endDate || task.startDate || task.date || getFormattedDate(new Date());
  elements.modalTaskClientInput.value = task.client || '';
  elements.modalTaskStatusSelect.value = task.status || '進行中';
  elements.modalTaskPrioritySelect.value = task.priority || 'normal';

  // Load Direct WYSIWYG Content (直接所見即所得，支援可打勾 Todo 與 Table, Callout)
  elements.modalTaskWysiwygEditor.innerHTML = renderMarkdownToHtml(task.content || '');

  // Reset Edit Mode to WYSIWYG
  state.modalTaskEditMode = 'wysiwyg';
  if (elements.modalTaskWysiwygEditor) elements.modalTaskWysiwygEditor.style.display = 'block';
  if (elements.modalTaskMarkdownSource) {
    elements.modalTaskMarkdownSource.style.display = 'none';
    elements.modalTaskMarkdownSource.value = task.content || '';
  }
  if (elements.modalToggleModeBtn) elements.modalToggleModeBtn.classList.remove('active');
  if (elements.modalModeIcon) elements.modalModeIcon.textContent = '🔀';
  if (elements.modalModeText) elements.modalModeText.textContent = '源碼模式';

  // Reset page scroll position to top
  if (elements.notionPageScrollable) {
    elements.notionPageScrollable.scrollTop = 0;
  }

  elements.modalSaveStatus.textContent = '● 已載入最新 Markdown 內容';
  elements.modalSaveStatus.style.color = 'var(--text-muted)';

  // Reset collapsible toolbar to collapsed by default
  const modalToggleBlocksBtn = document.getElementById('modalToggleBlocksBtn');
  const modalExpandedBlocks = document.getElementById('modalExpandedBlocks');
  if (modalExpandedBlocks) modalExpandedBlocks.classList.remove('is-expanded');
  if (modalToggleBlocksBtn) {
    modalToggleBlocksBtn.classList.remove('active');
    const textSpan = modalToggleBlocksBtn.querySelector('.toggle-text');
    if (textSpan) textSpan.textContent = '工具箱';
  }

  elements.taskCenterModal.classList.add('active');
  localStorage.setItem(STORAGE_KEYS.OPEN_TASK_ID, task.id);
  localStorage.setItem(STORAGE_KEYS.OPEN_TASK_DATE, task.startDate || task.date || state.selectedDate);
  setTimeout(() => {
    if (!task.title) elements.modalTaskTitleInput.focus();
  }, 100);
}

/**
 * 智慧防拖曳穿透之彈窗遮罩安全關閉處理器 (Smart Safe Overlay Close)
 * 核心原理：只有當滑鼠在背景遮罩上「按下 (mousedown)」且在背景遮罩上「放開 (mouseup)」時，
 * 才判定為使用者刻意點擊遮罩空白處關閉彈窗。
 * 若使用者是在編輯器/畫布內選取反白文字，即使游標拉出框外在遮罩上放開，也 100% 免疫、絕不關閉彈窗。
 */
function attachSafeOverlayClose(modalElement, closeCallback) {
  if (!modalElement || typeof closeCallback !== 'function') return;
  let isMouseDownOnOverlay = false;

  modalElement.addEventListener('mousedown', (e) => {
    isMouseDownOnOverlay = (e.target === modalElement);
  });

  modalElement.addEventListener('mouseup', (e) => {
    const isMouseUpOnOverlay = (e.target === modalElement);
    if (isMouseDownOnOverlay && isMouseUpOnOverlay) {
      closeCallback();
    }
    isMouseDownOnOverlay = false;
  });
}

function closeTaskModal() {
  if (elements.taskCenterModal.classList.contains('active')) {
    elements.taskCenterModal.classList.remove('active');
    localStorage.removeItem(STORAGE_KEYS.OPEN_TASK_ID);
    localStorage.removeItem(STORAGE_KEYS.OPEN_TASK_DATE);
    const modalCanvas = elements.taskCenterModal.querySelector('.modal-center-canvas');
    if (modalCanvas) modalCanvas.classList.remove('is-expanded');
    if (elements.modalExpandBtn) {
      elements.modalExpandBtn.textContent = '⛶';
      elements.modalExpandBtn.title = '全螢幕 / 視窗切換';
    }
    saveTaskImmediate();
    refreshCalendar();
    loadSelectedDayTasks(state.selectedDate);
  }
}

function triggerTaskDebouncedSave() {
  elements.modalSaveStatus.textContent = '● 正在自動存檔中...';
  elements.modalSaveStatus.style.color = 'var(--accent-amber)';

  clearTimeout(state.saveDebounceTimer);
  state.saveDebounceTimer = setTimeout(() => saveTaskImmediate(), 500);
}

async function saveTaskImmediate() {
  if (!state.currentEditingTask) return;

  const title = elements.modalTaskTitleInput.value.trim() || '未命名任務';
  const client = elements.modalTaskClientInput.value.trim();
  const status = elements.modalTaskStatusSelect.value;
  const completed = elements.modalTaskCompletedCheckbox.checked;

  // Convert WYSIWYG HTML directly to Markdown
  const markdownBody = (state.modalTaskEditMode === 'markdown' && elements.modalTaskMarkdownSource)
    ? elements.modalTaskMarkdownSource.value
    : htmlToMarkdown(elements.modalTaskWysiwygEditor.innerHTML);

  const startDate = elements.modalTaskStartDate ? elements.modalTaskStartDate.value : (state.currentEditingTask.startDate || state.currentEditingTask.date);
  const endDate = elements.modalTaskEndDate ? elements.modalTaskEndDate.value : (state.currentEditingTask.endDate || startDate);

  const taskData = {
    id: state.currentEditingTask.id,
    title,
    date: startDate,
    startDate,
    endDate,
    completed,
    client,
    status,
    priority: elements.modalTaskPrioritySelect.value,
    tags: [client, status].filter(Boolean),
    steps: state.currentEditingTask.steps || [],
    content: markdownBody
  };

  try {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskData)
    });
    const result = await res.json();
    if (result.success) {
      elements.modalSaveStatus.textContent = '● 已自動防抖儲存至 Markdown';
      elements.modalSaveStatus.style.color = 'var(--accent-emerald)';
      // 內文輸入時僅更新記憶體與右側抽屜，不強制整頁月曆刷新，消除打字延遲
      if (Array.isArray(state.selectedDayTasks)) {
        const idx = state.selectedDayTasks.findIndex(t => t.id === taskData.id);
        if (idx !== -1) {
          state.selectedDayTasks[idx] = { ...state.selectedDayTasks[idx], ...taskData };
        } else {
          state.selectedDayTasks.push(taskData);
        }
      }
      renderSelectedDayTaskList();
    }
  } catch (err) {
    elements.modalSaveStatus.textContent = '● 存檔失敗: ' + err.message;
    elements.modalSaveStatus.style.color = 'var(--accent-rose)';
  }
}

async function handlePromoteToNotebook() {
  if (!state.currentEditingTask) return;
  const client = elements.modalTaskClientInput.value.trim() || '一般專案';
  const noteTitle = elements.modalTaskTitleInput.value.trim() || '工作紀錄';

  if (!confirm(`確定要將本篇排錯工作紀錄沉澱至知識庫 [${client} / ${noteTitle}] 嗎？`)) return;

  try {
    const res = await fetch('/api/todos/promote-to-notebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.currentEditingTask.date,
        id: state.currentEditingTask.id,
        category: client,
        noteTitle
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('⭐ 成功沉澱至個人知識庫！');
      await loadNotebookTree();
    } else {
      showToast('沉澱失敗: ' + data.error);
    }
  } catch (err) {
    showToast('沉澱失敗: ' + err.message);
  }
}

// --- 3. Notebooks View Logic (Direct WYSIWYG + 100% Inline Renaming) ---
async function loadNotebookTree() {
  try {
    const res = await fetch(`/api/notebooks?_t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      state.notebookTree = data.tree || [];
      populateCategorySelect();
      renderNotebookTree();
    }
  } catch (err) {
    console.error('載入知識庫失敗:', err);
  }
}

function renderNotebookTree() {
  elements.notebookTreeList.innerHTML = '';

  if (!state.notebookTree || state.notebookTree.length === 0) {
    elements.notebookTreeList.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 40px 10px;">
        尚無任何客戶分類<br>請點擊右上角「＋ 新增」建立
      </div>
    `;
    return;
  }

  // 自動展開保存之筆記的上層目錄
  const savedNotePath = localStorage.getItem(STORAGE_KEYS.ACTIVE_NOTE_PATH);
  const activePath = (state.currentNotebookNote && state.currentNotebookNote.relPath) ? state.currentNotebookNote.relPath : savedNotePath;
  if (activePath) {
    const parts = activePath.split('/');
    let currentAccum = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentAccum = currentAccum ? (currentAccum + '/' + parts[i]) : parts[i];
      state.collapsedCategories.delete(currentAccum);
    }
  }

  // 遞迴渲染分類與筆記
  state.notebookTree.forEach(rootCat => {
    renderCategoryNode(rootCat, elements.notebookTreeList, 0);
  });

  // 如果尚未選中任何筆記，優先選取上次保存的筆記，若無則自動選取第一個
  if (!state.currentNotebookNote) {
    if (savedNotePath) {
      loadNotebookNote(savedNotePath);
    } else {
      const firstNote = findFirstNoteInTree(state.notebookTree);
      if (firstNote) {
        loadNotebookNote(firstNote.path);
      }
    }
  }
}

function findFirstNoteInTree(categories) {
  for (const cat of categories) {
    if (cat.notes && cat.notes.length > 0) return cat.notes[0];
    if (cat.subCategories && cat.subCategories.length > 0) {
      const found = findFirstNoteInTree(cat.subCategories);
      if (found) return found;
    }
  }
  return null;
}

function renderCategoryNode(group, container, depth) {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'category-group';
  const groupKey = group.relPath || group.category;
  if (state.collapsedCategories.has(groupKey)) {
    groupDiv.classList.add('collapsed');
  }

  const header = document.createElement('div');
  header.className = 'category-header' + (depth > 0 ? ' sub-category' : '');

  const nameBadge = document.createElement('div');
  nameBadge.className = 'category-name-badge';
  nameBadge.innerHTML = `
    <span class="category-arrow">▼</span>
    <span>${depth === 0 ? '📁' : '📂'}</span>
    <span class="cat-title-text">${group.category}</span>
    <span style="font-size: 0.72rem; color: var(--text-dim);">(${group.count || 0})</span>
  `;

  // Folder toggle collapse
  header.addEventListener('click', (e) => {
    if (e.target.closest('.category-header-actions') || e.target.closest('input')) return;
    groupDiv.classList.toggle('collapsed');
    if (groupDiv.classList.contains('collapsed')) {
      state.collapsedCategories.add(groupKey);
    } else {
      state.collapsedCategories.delete(groupKey);
    }
  });

  // Note HTML5 Drag & Drop target on category header
  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    header.classList.add('drag-over');
  });
  header.addEventListener('dragleave', (e) => {
    if (!header.contains(e.relatedTarget)) {
      header.classList.remove('drag-over');
    }
  });
  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    header.classList.remove('drag-over');
    const noteRelPath = e.dataTransfer.getData('text/plain');
    if (!noteRelPath) return;
    await handleMoveNoteToCategory(noteRelPath, groupKey, group.category);
  });

  // 100% Inline Rename Functionality (原地行內更名)
  const triggerInlineRename = () => {
    const textSpan = nameBadge.querySelector('.cat-title-text');
    if (!textSpan || nameBadge.querySelector('input')) return;

    const currentName = group.category;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename-input';
    input.value = currentName;

    textSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    const commitRename = async () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (!newName || newName === currentName) {
        renderNotebookTree();
        return;
      }

      try {
        const res = await fetch('/api/notebooks/category/rename', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldRelPath: groupKey, newName })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✔ 目錄已成功更名為：${data.newName}`);
          await loadNotebookTree();
        } else {
          showToast('更名失敗: ' + data.error);
          renderNotebookTree();
        }
      } catch (err) {
        showToast('更名失敗: ' + err.message);
        renderNotebookTree();
      }
    };

    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        committed = true;
        renderNotebookTree();
      }
    });
  };

  nameBadge.addEventListener('dblclick', triggerInlineRename);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'category-header-actions';

  // 1. ＋📁 新增子目錄按鈕
  const addSubFolderBtn = document.createElement('button');
  addSubFolderBtn.className = 'btn-category-action';
  addSubFolderBtn.title = '在此目錄下新增子目錄/子專案';
  addSubFolderBtn.innerHTML = '📁+';
  addSubFolderBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const folderName = prompt(`請輸入在 [${group.category}] 底下的新子目錄名稱：`);
    if (!folderName || !folderName.trim()) return;

    try {
      const res = await fetch('/api/notebooks/category/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName.trim(), parentPath: groupKey })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✔ 已建立子目錄：${data.name}`);
        state.collapsedCategories.delete(groupKey); // 確保展開
        await loadNotebookTree();
      } else {
        showToast('建立失敗: ' + data.error);
      }
    } catch (err) {
      showToast('建立失敗: ' + err.message);
    }
  });

  // 2. ＋📄 新增筆記按鈕
  const addNoteBtn = document.createElement('button');
  addNoteBtn.className = 'btn-category-action';
  addNoteBtn.title = '在此目錄下新增筆記頁面';
  addNoteBtn.innerHTML = '📄+';
  addNoteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCreateNewNote(groupKey);
  });

  // 3. ✏️ 重新命名按鈕
  const renameBtn = document.createElement('button');
  renameBtn.className = 'btn-category-action';
  renameBtn.title = '重新命名此目錄';
  renameBtn.innerHTML = '✏️';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerInlineRename();
  });

  actionsDiv.appendChild(addSubFolderBtn);
  actionsDiv.appendChild(addNoteBtn);
  actionsDiv.appendChild(renameBtn);

  header.appendChild(nameBadge);
  header.appendChild(actionsDiv);

  const subList = document.createElement('div');
  subList.className = 'category-notes-sublist' + (depth > 0 ? ' nested' : '');

  // A. 遞迴渲染所有子目錄
  if (group.subCategories && group.subCategories.length > 0) {
    group.subCategories.forEach(subGroup => {
      renderCategoryNode(subGroup, subList, depth + 1);
    });
  }

  // B. 渲染當前目錄下的筆記 (支援 HTML5 拖曳歸類)
  if (group.notes && group.notes.length > 0) {
    group.notes.forEach(note => {
      const noteItem = document.createElement('div');
      noteItem.className = 'note-tree-item';
      noteItem.setAttribute('draggable', 'true');
      if (state.currentNotebookNote && state.currentNotebookNote.relPath === note.path) {
        noteItem.classList.add('active');
      }
      noteItem.innerHTML = `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📄 ${note.title}</span>`;
      noteItem.addEventListener('click', () => loadNotebookNote(note.path));

      // Drag start & end handlers
      noteItem.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', note.path);
        e.dataTransfer.effectAllowed = 'move';
        noteItem.classList.add('dragging');
      });
      noteItem.addEventListener('dragend', () => {
        noteItem.classList.remove('dragging');
        document.querySelectorAll('.category-header.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      subList.appendChild(noteItem);
    });
  }

  groupDiv.appendChild(header);
  groupDiv.appendChild(subList);
  container.appendChild(groupDiv);
}

function populateCategorySelect() {
  const currentCategory = state.currentNotebookNote 
    ? (state.currentNotebookNote.category || '') 
    : (elements.notebookCategorySelect ? elements.notebookCategorySelect.value : '');
  elements.notebookCategorySelect.innerHTML = '';
  
  function addOptionsRecursive(list, prefix) {
    prefix = prefix || '';
    list.forEach(item => {
      const opt = document.createElement('option');
      const val = item.relPath || item.category;
      opt.value = val;
      opt.textContent = prefix ? (prefix + ' / ' + item.category) : item.category;
      elements.notebookCategorySelect.appendChild(opt);
      if (item.subCategories && item.subCategories.length > 0) {
        addOptionsRecursive(item.subCategories, opt.textContent);
      }
    });
  }

  if (state.notebookTree) {
    addOptionsRecursive(state.notebookTree, '');
  }

  if (currentCategory) {
    const options = Array.from(elements.notebookCategorySelect.options);
    const matched = options.find(o => o.value === currentCategory || o.value.toLowerCase() === currentCategory.toLowerCase());
    if (matched) {
      elements.notebookCategorySelect.value = matched.value;
    }
  }
}

async function loadNotebookNote(relPath) {
  try {
    const res = await fetch(`/api/notebooks/note?path=${encodeURIComponent(relPath)}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.success) {
      state.currentNotebookNote = data;
      elements.notebookDocTitle.value = data.title;
      if (elements.notebookCategorySelect) {
        const options = Array.from(elements.notebookCategorySelect.options);
        const matched = options.find(o => o.value === data.category || o.value.toLowerCase() === (data.category || '').toLowerCase());
        if (matched) {
          elements.notebookCategorySelect.value = matched.value;
        } else {
          elements.notebookCategorySelect.value = data.category;
        }
      }
      localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTE_PATH, data.relPath);

      // Direct WYSIWYG Load (所見即所得，支援 Callout 與 Table)
      elements.notebookWysiwygEditor.innerHTML = renderMarkdownToHtml(data.content || '');
      if (elements.notebookMarkdownSource) {
        elements.notebookMarkdownSource.value = data.content || '';
      }

      elements.notebookSaveStatus.textContent = '● 已載入最新 Markdown 內容';
      elements.notebookSaveStatus.style.color = 'var(--text-muted)';

      document.querySelectorAll('.note-tree-item.active').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.note-tree-item').forEach(el => {
        if (el.textContent.includes(data.title)) el.classList.add('active');
      });
    }
  } catch (err) {
    showToast('載入筆記失敗: ' + err.message);
  }
}

function triggerNotebookDebouncedSave() {
  elements.notebookSaveStatus.textContent = '● 正在自動存檔中...';
  elements.notebookSaveStatus.style.color = 'var(--accent-amber)';

  clearTimeout(state.saveDebounceTimer);
  state.saveDebounceTimer = setTimeout(async () => {
    await saveNotebookNoteImmediate();
  }, 500);
}

async function saveNotebookNoteImmediate() {
  if (!state.currentNotebookNote && !elements.notebookDocTitle.value.trim() && !elements.notebookWysiwygEditor.innerText.trim()) return;

  const oldTitle = state.currentNotebookNote ? state.currentNotebookNote.title : '';
  const oldCategory = state.currentNotebookNote ? state.currentNotebookNote.category : '';
  const oldRelPath = state.currentNotebookNote ? state.currentNotebookNote.relPath : null;

  // 確保存檔時的分類優先以目前筆記已綁定的分類為準，避免選單暫時不符時被竄改
  const category = (elements.notebookCategorySelect.value && elements.notebookCategorySelect.value.trim())
    ? elements.notebookCategorySelect.value.trim()
    : (oldCategory || '未分類');

  const title = elements.notebookDocTitle.value.trim() || '未命名筆記';

  // Convert WYSIWYG HTML directly to Markdown
  const markdownBody = (state.notebookEditMode === 'markdown' && elements.notebookMarkdownSource)
    ? elements.notebookMarkdownSource.value
    : htmlToMarkdown(elements.notebookWysiwygEditor.innerHTML);

  try {
    const res = await fetch('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category,
        title,
        content: markdownBody,
        oldRelPath
      })
    });
    const data = await res.json();
    if (data.success) {
      elements.notebookSaveStatus.textContent = '● 已自動存盤至本地 Markdown';
      elements.notebookSaveStatus.style.color = 'var(--accent-emerald)';
      if (state.currentNotebookNote) {
        state.currentNotebookNote.relPath = data.relPath;
        state.currentNotebookNote.title = title;
        state.currentNotebookNote.category = category;
      } else {
        state.currentNotebookNote = {
          relPath: data.relPath,
          title,
          category,
          content: markdownBody
        };
      }
      localStorage.setItem(STORAGE_KEYS.ACTIVE_NOTE_PATH, data.relPath);

      // 純內文編輯時抑制重組目錄樹，唯有重命名或改分類時才重繪
      const isRenameOrMove = (oldTitle && oldTitle !== title) || (oldCategory && oldCategory !== category) || !oldRelPath;
      if (isRenameOrMove) {
        await loadNotebookTree();
      }
    } else {
      elements.notebookSaveStatus.textContent = '● 存檔失敗: ' + (data.error || '未知錯誤');
      elements.notebookSaveStatus.style.color = 'var(--accent-rose)';
    }
  } catch (err) {
    elements.notebookSaveStatus.textContent = '● 存檔失敗: ' + err.message;
    elements.notebookSaveStatus.style.color = 'var(--accent-rose)';
  }
}

function handleAddCategory() {
  const catName = prompt('請輸入新的客戶名稱或章節分類：');
  if (catName && catName.trim()) {
    handleCreateNewNote(catName.trim());
  }
}

// 搬移筆記至指定目錄 (Drag & Drop Move Note)
async function handleMoveNoteToCategory(noteRelPath, targetCategoryPath, categoryName) {
  try {
    const res = await fetch('/api/notebooks/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteRelPath, targetCategoryPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✔ 筆記已成功移動至 [${categoryName}]`);
      state.collapsedCategories.delete(targetCategoryPath);
      await loadNotebookTree();
      if (data.newPath) {
        await loadNotebookNote(data.newPath);
      }
    } else {
      showToast('移動失敗: ' + (data.error || data.message));
    }
  } catch (err) {
    showToast('移動失敗: ' + err.message);
  }
}

function handleCreateNewNote(category) {
  const title = prompt(`請輸入在 [${category}] 下新增的筆記標題：`, '新技術筆記');
  if (title && title.trim()) {
    state.currentNotebookNote = {
      title: title.trim(),
      category,
      content: `# ${title.trim()}\n\n> 建立時間：${getFormattedDate(new Date())}\n\n`,
      relPath: null
    };
    elements.notebookDocTitle.value = state.currentNotebookNote.title;
    elements.notebookCategorySelect.value = category;
    elements.notebookWysiwygEditor.innerHTML = marked.parse(state.currentNotebookNote.content);
    saveNotebookNoteImmediate();
  }
}

async function handleDeleteNote() {
  if (!state.currentNotebookNote || !state.currentNotebookNote.relPath) return;
  if (!confirm(`確定要刪除筆記 [${state.currentNotebookNote.title}] 嗎？`)) return;

  try {
    const res = await fetch(`/api/notebooks?path=${encodeURIComponent(state.currentNotebookNote.relPath)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('筆記已刪除');
      state.currentNotebookNote = null;
      await loadNotebookTree();
    }
  } catch (err) {
    showToast('刪除失敗: ' + err.message);
  }
}

// --- Mode Toggle Handlers (Markdown Source ⇄ WYSIWYG) ---
function toggleNotebookMarkdownMode() {
  if (!elements.notebookWysiwygEditor || !elements.notebookMarkdownSource) return;
  const isWysiwyg = state.notebookEditMode !== 'markdown';
  if (isWysiwyg) {
    const md = htmlToMarkdown(elements.notebookWysiwygEditor.innerHTML);
    elements.notebookMarkdownSource.value = md;
    elements.notebookWysiwygEditor.style.display = 'none';
    elements.notebookMarkdownSource.style.display = 'block';
    state.notebookEditMode = 'markdown';
    if (elements.notebookToggleModeBtn) elements.notebookToggleModeBtn.classList.add('active');
    if (elements.notebookModeIcon) elements.notebookModeIcon.textContent = '📝';
    if (elements.notebookModeText) elements.notebookModeText.textContent = '視覺模式';
    elements.notebookMarkdownSource.focus();
  } else {
    const html = renderMarkdownToHtml(elements.notebookMarkdownSource.value);
    elements.notebookWysiwygEditor.innerHTML = html;
    elements.notebookMarkdownSource.style.display = 'none';
    elements.notebookWysiwygEditor.style.display = 'block';
    state.notebookEditMode = 'wysiwyg';
    if (elements.notebookToggleModeBtn) elements.notebookToggleModeBtn.classList.remove('active');
    if (elements.notebookModeIcon) elements.notebookModeIcon.textContent = '🔀';
    if (elements.notebookModeText) elements.notebookModeText.textContent = '源碼模式';
    elements.notebookWysiwygEditor.focus();
  }
}

function toggleModalTaskMarkdownMode() {
  if (!elements.modalTaskWysiwygEditor || !elements.modalTaskMarkdownSource) return;
  const isWysiwyg = state.modalTaskEditMode !== 'markdown';
  if (isWysiwyg) {
    const md = htmlToMarkdown(elements.modalTaskWysiwygEditor.innerHTML);
    elements.modalTaskMarkdownSource.value = md;
    elements.modalTaskWysiwygEditor.style.display = 'none';
    elements.modalTaskMarkdownSource.style.display = 'block';
    state.modalTaskEditMode = 'markdown';
    if (elements.modalToggleModeBtn) elements.modalToggleModeBtn.classList.add('active');
    if (elements.modalModeIcon) elements.modalModeIcon.textContent = '📝';
    if (elements.modalModeText) elements.modalModeText.textContent = '視覺模式';
    elements.modalTaskMarkdownSource.focus();
  } else {
    const html = renderMarkdownToHtml(elements.modalTaskMarkdownSource.value);
    elements.modalTaskWysiwygEditor.innerHTML = html;
    elements.modalTaskMarkdownSource.style.display = 'none';
    elements.modalTaskWysiwygEditor.style.display = 'block';
    state.modalTaskEditMode = 'wysiwyg';
    if (elements.modalToggleModeBtn) elements.modalToggleModeBtn.classList.remove('active');
    if (elements.modalModeIcon) elements.modalModeIcon.textContent = '🔀';
    if (elements.modalModeText) elements.modalModeText.textContent = '源碼模式';
    elements.modalTaskWysiwygEditor.focus();
  }
}

// --- Image Pasting & WebP Uploading in WYSIWYG ---
async function handlePasteImageWysiwyg(event, contextType, editorElem, onSaved) {
  const clipboard = event.clipboardData || (event.originalEvent && event.originalEvent.clipboardData);
  if (!clipboard) return;
  const items = clipboard.items || [];
  let hasImage = false;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') !== -1) {
      hasImage = true;
      event.preventDefault();
      const file = items[i].getAsFile();
      if (file) {
        await uploadFileImageWysiwyg(file, contextType, editorElem, onSaved);
      }
      break;
    }
  }

  // If text/HTML was pasted (not an image), allow browser paste and schedule immediate save
  if (!hasImage) {
    setTimeout(() => {
      if (onSaved) onSaved();
    }, 10);
  }
}

async function uploadFileImageWysiwyg(file, contextType, editorElem, onSaved) {
  showToast('📷 正在轉換 WebP 並儲存至事件目錄...');

  const formData = new FormData();
  formData.append('image', file);
  formData.append('contextType', contextType);

  if (contextType === 'todo' && state.currentEditingTask) {
    formData.append('date', state.currentEditingTask.date);
    formData.append('taskId', state.currentEditingTask.id);
  } else if (contextType === 'notebook' && state.currentNotebookNote) {
    formData.append('notebookRelPath', state.currentNotebookNote.relPath);
  }

  try {
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      // Insert img tag directly into WYSIWYG editor
      insertHtmlAtCursor(editorElem, `<p><img src="${data.url}" alt="截圖" /></p><p></p>`);
      if (onSaved) onSaved();
      showToast(`✅ 截圖已自動瘦身為 WebP (${data.filename})`);
    } else {
      showToast('圖片上傳失敗: ' + data.error);
    }
  } catch (err) {
    showToast('圖片上傳失敗: ' + err.message);
  }
}

// --- 游標與選區記憶追蹤機制 (用於下拉選單點擊失焦時還原游標) ---
let lastSavedEditorRange = null;
let lastSavedEditor = null;

// --- 編輯器歷史快照機制 (確保套用模板或重大變更時 100% 支援 Ctrl+Z 還原) ---
const editorHistoryMap = new WeakMap();

function recordEditorSnapshot(editorElem) {
  if (!editorElem) return;
  let history = editorHistoryMap.get(editorElem);
  if (!history) {
    history = { undoStack: [], redoStack: [] };
    editorHistoryMap.set(editorElem, history);
  }
  history.undoStack.push(editorElem.innerHTML);
  if (history.undoStack.length > 50) history.undoStack.shift();
  history.redoStack = [];
}

function restoreEditorSnapshotUndo(editorElem, onAutoSave) {
  if (!editorElem) return false;
  const history = editorHistoryMap.get(editorElem);
  if (history && history.undoStack.length > 0) {
    history.redoStack.push(editorElem.innerHTML);
    const prevState = history.undoStack.pop();
    editorElem.innerHTML = prevState;
    if (onAutoSave) onAutoSave();
    return true;
  }
  return false;
}

function restoreEditorSnapshotRedo(editorElem, onAutoSave) {
  if (!editorElem) return false;
  const history = editorHistoryMap.get(editorElem);
  if (history && history.redoStack.length > 0) {
    history.undoStack.push(editorElem.innerHTML);
    const nextState = history.redoStack.pop();
    editorElem.innerHTML = nextState;
    if (onAutoSave) onAutoSave();
    return true;
  }
  return false;
}

function saveCurrentEditorRange(editorElem) {
  if (!editorElem) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editorElem.contains(range.commonAncestorContainer)) {
      lastSavedEditorRange = range.cloneRange();
      lastSavedEditor = editorElem;
    }
  }
}

/**
 * 智慧於游標當前區塊的「下方」展開插入 HTML，並完美支援 Ctrl+Z 撤銷還原
 */
function insertHtmlBelowCursor(editorElem, htmlString) {
  if (!editorElem) return;
  editorElem.focus();

  // 1. 記錄快照 (確保能以 Ctrl+Z 還原)
  recordEditorSnapshot(editorElem);

  let range = null;
  const sel = window.getSelection();

  if (sel && sel.rangeCount > 0) {
    const curRange = sel.getRangeAt(0);
    if (editorElem.contains(curRange.commonAncestorContainer)) {
      range = curRange;
    }
  }

  if (!range && lastSavedEditor === editorElem && lastSavedEditorRange) {
    range = lastSavedEditorRange.cloneRange();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 尋找游標所屬的區塊級元素 (段落、標題、清單項等)
  let currentBlock = null;
  if (range) {
    let node = range.startContainer;
    while (node && node !== editorElem) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'table'].includes(tag)) {
          currentBlock = node;
          break;
        }
      }
      node = node.parentNode;
    }
  }

  // 決定插入目標位置：若當前行有文字，在下方開闢新行；若當前行是完全空行，就地展開
  let targetNode = null;
  if (currentBlock && currentBlock !== editorElem) {
    const isCurrentBlockEmpty = !currentBlock.innerText.trim();
    if (isCurrentBlockEmpty) {
      targetNode = currentBlock;
    } else {
      const newParagraph = document.createElement('p');
      newParagraph.innerHTML = '<br>';
      currentBlock.after(newParagraph);
      targetNode = newParagraph;
    }
  } else {
    if (!editorElem.innerText.trim()) {
      targetNode = null;
    } else {
      const newParagraph = document.createElement('p');
      newParagraph.innerHTML = '<br>';
      editorElem.appendChild(newParagraph);
      targetNode = newParagraph;
    }
  }

  if (targetNode) {
    const newRange = document.createRange();
    newRange.selectNodeContents(targetNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  // 2. 優先以 document.execCommand('insertHTML') 寫入原生 Undo 堆疊
  let execSuccess = false;
  try {
    execSuccess = document.execCommand('insertHTML', false, htmlString);
  } catch (err) {
    execSuccess = false;
  }

  // 若原生指令未成功，回退以 DOM 替換
  if (!execSuccess) {
    if (targetNode) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlString;
      const frag = document.createDocumentFragment();
      while (tempDiv.firstChild) {
        frag.appendChild(tempDiv.firstChild);
      }
      targetNode.replaceWith(frag);
    } else {
      editorElem.innerHTML = htmlString;
    }
  }

  saveCurrentEditorRange(editorElem);
}

function insertHtmlAtCursor(editorElem, htmlString) {
  if (!editorElem) return;
  editorElem.focus();
  let range = null;
  const sel = window.getSelection();

  // 1. 優先使用當前焦點內的 Range
  if (sel && sel.rangeCount > 0) {
    const curRange = sel.getRangeAt(0);
    if (editorElem.contains(curRange.commonAncestorContainer)) {
      range = curRange;
    }
  }

  // 2. 若當前焦點已失焦（如點擊上方工具列下拉選單），以暫存之最後游標還原
  if (!range && lastSavedEditor === editorElem && lastSavedEditorRange) {
    range = lastSavedEditorRange.cloneRange();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  if (range) {
    range.deleteContents();
    const el = document.createElement('div');
    el.innerHTML = htmlString;
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = el.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    range.insertNode(frag);
    if (lastNode) {
      const newRange = range.cloneRange();
      newRange.setStartAfter(lastNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      saveCurrentEditorRange(editorElem);
    }
  } else {
    // 3. 完全無游標紀錄時：空白則填入，已有內容則於末尾附加換行
    if (!editorElem.innerText.trim()) {
      editorElem.innerHTML = htmlString;
    } else {
      editorElem.innerHTML += '<p><br></p>' + htmlString;
    }
    saveCurrentEditorRange(editorElem);
  }
}

// 移動游標至指定元素結尾
function moveCaretToElement(elem) {
  if (!elem) return;
  elem.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(elem);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// WYSIWYG Toolbar Commands (與 Notion / Word 標點對齊之全套工具庫)
function execWysiwygCommand(editorElem, action, btnElem) {
  editorElem.focus();
  const sel = window.getSelection();
  let anchor = null;
  if (sel && sel.anchorNode) {
    anchor = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  }
  const insideCalloutContent = anchor ? anchor.closest('.callout-content') : null;

  switch (action) {
    case 'h1': document.execCommand('formatBlock', false, '<h1>'); break;
    case 'h2': document.execCommand('formatBlock', false, '<h2>'); break;
    case 'h3': document.execCommand('formatBlock', false, '<h3>'); break;
    case 'bold': document.execCommand('bold', false, null); break;
    case 'bullet': {
      if (insideCalloutContent) {
        // Enforce bullet list strictly inside callout content
        const curBlock = anchor.closest('p, div, li') || insideCalloutContent;
        const text = (curBlock.innerText || curBlock.textContent || '').trim();
        const ul = document.createElement('ul');
        ul.innerHTML = `<li>${text || '<br>'}</li>`;
        curBlock.replaceWith(ul);
        const li = ul.querySelector('li');
        moveCaretToElement(li);
      } else {
        document.execCommand('insertUnorderedList', false, null);
      }
      break;
    }
    case 'number': {
      if (insideCalloutContent) {
        // Enforce numbered list strictly inside callout content
        const curBlock = anchor.closest('p, div, li') || insideCalloutContent;
        const text = (curBlock.innerText || curBlock.textContent || '').trim();
        const ol = document.createElement('ol');
        ol.innerHTML = `<li>${text || '<br>'}</li>`;
        curBlock.replaceWith(ol);
        const li = ol.querySelector('li');
        moveCaretToElement(li);
      } else {
        document.execCommand('insertOrderedList', false, null);
      }
      break;
    }
    case 'quote': document.execCommand('formatBlock', false, '<blockquote>'); break;
    case 'divider':
      insertHtmlAtCursor(editorElem, '<hr><p></p>');
      break;
    case 'code':
      insertHtmlAtCursor(editorElem, `<pre><code>-- 在此輸入 SQL 或指令\nselect @@version;\n</code></pre><p></p>`);
      break;
    case 'todo': {
      if (insideCalloutContent) {
        const curBlock = anchor.closest('p, div, li') || insideCalloutContent;
        const text = (curBlock.innerText || curBlock.textContent || '').trim();
        const todoDiv = document.createElement('div');
        todoDiv.className = 'todo-item-line';
        todoDiv.dataset.level = '0';
        todoDiv.innerHTML = `<input type="checkbox" class="interactive-todo-cb"><span class="todo-text-span" contenteditable="true">${text}</span>`;
        curBlock.replaceWith(todoDiv);
        const span = todoDiv.querySelector('.todo-text-span');
        if (span) {
          moveCaretToElement(span);
        }
      } else {
        insertHtmlAtCursor(editorElem, `<div class="todo-item-line" data-level="0"><input type="checkbox" class="interactive-todo-cb"><span class="todo-text-span" contenteditable="true"></span></div>`);
        const spans = editorElem.querySelectorAll('.todo-item-line .todo-text-span');
        if (spans.length > 0) {
          const lastSpan = spans[spans.length - 1];
          lastSpan.focus();
        }
      }
      break;
    }
    case 'table':
      toggleTableGridPicker(editorElem, btnElem);
      break;
    case 'color':
      toggleColorPalettePicker(editorElem, btnElem);
      break;
    case 'callout-note':
    case 'callout-warning':
    case 'callout-tip': {
      let icon = '💡', cls = 'callout-note', defaultTitle = '筆記重點：';
      if (action === 'callout-warning') { icon = '⚠️'; cls = 'callout-warning'; defaultTitle = '警示事項：'; }
      else if (action === 'callout-tip') { icon = '✨'; cls = 'callout-tip'; defaultTitle = '技巧提示：'; }

      const calloutHtml = `<div class="callout-block ${cls}"><span class="callout-icon">${icon}</span><div class="callout-content"><p><b>${defaultTitle}</b>在此輸入內容...</p></div></div>`;
      insertHtmlAtCursor(editorElem, calloutHtml);
      const callouts = editorElem.querySelectorAll('.callout-block .callout-content p');
      if (callouts.length > 0) {
        const targetP = callouts[callouts.length - 1];
        moveCaretToElement(targetP);
      }
      break;
    }
    case 'toggle':
      insertHtmlAtCursor(editorElem, `
        <details class="toggle-block">
          <summary>▶ 點擊展開 / 收合詳細排查日誌與 SQL 語法</summary>
          <div class="toggle-content">
            <p>在此輸入詳細 SQL 查詢指令、錯誤訊息截圖或 Exception Log 紀錄...</p>
          </div>
        </details><p></p>
      `);
      break;
  }
}

// --- Slash Command System (Notion Style / 快捷選單) ---
let activeSlashEditor = null;
const slashMenu = document.getElementById('slashCommandMenu');

function initSlashCommands() {
  const editors = [elements.modalTaskWysiwygEditor, elements.notebookWysiwygEditor];
  editors.forEach(editor => {
    if (!editor) return;
    editor.addEventListener('keydown', (e) => {
      if (e.key === '/') {
        activeSlashEditor = editor;
        setTimeout(() => showSlashMenu(editor), 10);
      } else if (slashMenu && slashMenu.classList.contains('active')) {
        if (e.key === 'Escape') {
          hideSlashMenu();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          navigateSlashMenu(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const selected = slashMenu.querySelector('.slash-item.selected') || slashMenu.querySelector('.slash-item');
          if (selected) {
            triggerSlashItem(selected.dataset.slash);
          }
        }
      }
    });
  });

  if (slashMenu) {
    slashMenu.querySelectorAll('.slash-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerSlashItem(item.dataset.slash);
      });
    });
  }

  document.addEventListener('click', (e) => {
    if (slashMenu && !slashMenu.contains(e.target)) {
      hideSlashMenu();
    }
  });
}

function showSlashMenu(editor) {
  if (!slashMenu) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  const top = Math.min(window.innerHeight - 380, rect.bottom + 8);
  const left = Math.min(window.innerWidth - 300, Math.max(16, rect.left));
  slashMenu.style.top = `${top}px`;
  slashMenu.style.left = `${left}px`;
  slashMenu.classList.add('active');

  const items = slashMenu.querySelectorAll('.slash-item');
  items.forEach((item, idx) => item.classList.toggle('selected', idx === 0));
}

function hideSlashMenu() {
  if (slashMenu) slashMenu.classList.remove('active');
}

function navigateSlashMenu(dir) {
  if (!slashMenu) return;
  const items = Array.from(slashMenu.querySelectorAll('.slash-item'));
  let currentIdx = items.findIndex(item => item.classList.contains('selected'));
  if (currentIdx === -1) currentIdx = 0;
  items[currentIdx].classList.remove('selected');
  const nextIdx = (currentIdx + dir + items.length) % items.length;
  items[nextIdx].classList.add('selected');
  items[nextIdx].scrollIntoView({ block: 'nearest' });
}

function triggerSlashItem(slashAction) {
  hideSlashMenu();
  if (!activeSlashEditor) return;
  
  // Clean trailing "/"
  const sel = window.getSelection();
  if (sel && sel.anchorNode && sel.anchorNode.nodeType === Node.TEXT_NODE) {
    const text = sel.anchorNode.textContent;
    if (text.endsWith('/')) {
      sel.anchorNode.textContent = text.slice(0, -1);
    }
  }

  // 支援斜線指令直接套用模板
  if (slashAction && slashAction.startsWith('template:')) {
    const filename = slashAction.replace('template:', '');
    const isModal = (activeSlashEditor === elements.modalTaskWysiwygEditor);
    applyTemplateToWysiwyg(filename, activeSlashEditor, isModal ? triggerTaskDebouncedSave : triggerNotebookDebouncedSave);
    return;
  }

  execWysiwygCommand(activeSlashEditor, slashAction);
  if (activeSlashEditor === elements.modalTaskWysiwygEditor) triggerTaskDebouncedSave();
  else triggerNotebookDebouncedSave();
}

// --- Notion-Style Collapsible Toolbars (極簡單行常駐 + 點擊展開 15 項區塊工具箱) ---
function initCollapsibleBlockToolbars() {
  const modalToggleBlocksBtn = document.getElementById('modalToggleBlocksBtn');
  const modalExpandedBlocks = document.getElementById('modalExpandedBlocks');
  if (modalToggleBlocksBtn && modalExpandedBlocks) {
    modalToggleBlocksBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExp = modalExpandedBlocks.classList.toggle('is-expanded');
      modalToggleBlocksBtn.classList.toggle('active', isExp);
      const textSpan = modalToggleBlocksBtn.querySelector('.toggle-text');
      if (textSpan) textSpan.textContent = isExp ? '收合工具' : '工具箱';
    });
  }

  const notebookToggleBlocksBtn = document.getElementById('notebookToggleBlocksBtn');
  const notebookExpandedBlocks = document.getElementById('notebookExpandedBlocks');
  if (notebookToggleBlocksBtn && notebookExpandedBlocks) {
    notebookToggleBlocksBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExp = notebookExpandedBlocks.classList.toggle('is-expanded');
      notebookToggleBlocksBtn.classList.toggle('active', isExp);
      const textSpan = notebookToggleBlocksBtn.querySelector('.toggle-text');
      if (textSpan) textSpan.textContent = isExp ? '收合工具' : '工具箱';
    });
  }
}

// --- Notion-Style Floating Selection Bubble Menu (反白選取文字浮動工具列) ---
let activeEditorForBubble = null;

function initFloatingBubbleMenu() {
  const bubbleMenu = document.getElementById('floatingBubbleMenu');
  if (!bubbleMenu) return;

  const editors = [elements.modalTaskWysiwygEditor, elements.notebookWysiwygEditor].filter(Boolean);

  function checkSelectionAndPosition() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      bubbleMenu.style.display = 'none';
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      bubbleMenu.style.display = 'none';
      return;
    }

    const range = sel.getRangeAt(0);
    let matchedEditor = null;
    for (const ed of editors) {
      if (ed.contains(range.commonAncestorContainer)) {
        matchedEditor = ed;
        break;
      }
    }

    if (!matchedEditor) {
      bubbleMenu.style.display = 'none';
      return;
    }

    activeEditorForBubble = matchedEditor;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      bubbleMenu.style.display = 'none';
      return;
    }

    // Position centered right above the highlighted text range
    const top = Math.max(10, rect.top - 10);
    const left = Math.min(window.innerWidth - 180, Math.max(180, rect.left + rect.width / 2));
    bubbleMenu.style.top = `${top}px`;
    bubbleMenu.style.left = `${left}px`;
    bubbleMenu.style.display = 'flex';
  }

  document.addEventListener('selectionchange', () => {
    requestAnimationFrame(checkSelectionAndPosition);
  });

  document.addEventListener('mousedown', (e) => {
    if (bubbleMenu && !bubbleMenu.contains(e.target)) {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          bubbleMenu.style.display = 'none';
          const picker = document.getElementById('colorPalettePicker');
          if (picker && !picker.contains(e.target)) hideColorPalettePicker();
        }
      }, 50);
    }
  });

  bubbleMenu.querySelectorAll('.bubble-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      // Prevent button click from unfocusing / deselecting active text!
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.bubbleAction;
      if (activeEditorForBubble && action) {
        execWysiwygCommand(activeEditorForBubble, action, btn);
        if (activeEditorForBubble === elements.modalTaskWysiwygEditor) triggerTaskDebouncedSave();
        else triggerNotebookDebouncedSave();
        requestAnimationFrame(checkSelectionAndPosition);
      }
    });
  });
}

// --- Notion-Style Color & Highlight Palette Picker (待辦事項與筆記本 100% 一致) ---
let currentColorTargetEditor = null;
let currentColorSavedRange = null;
let colorPickerLeaveTimer = null;

function hideColorPalettePicker() {
  clearTimeout(colorPickerLeaveTimer);
  const picker = document.getElementById('colorPalettePicker');
  if (picker) picker.style.display = 'none';
}

function scheduleColorPickerClose() {
  clearTimeout(colorPickerLeaveTimer);
  colorPickerLeaveTimer = setTimeout(() => {
    hideColorPalettePicker();
  }, 300);
}

function cancelColorPickerClose() {
  clearTimeout(colorPickerLeaveTimer);
}

function toggleColorPalettePicker(editorElem, anchorBtn) {
  const picker = document.getElementById('colorPalettePicker');
  if (!picker) return;

  if (picker.style.display === 'block') {
    hideColorPalettePicker();
    return;
  }

  cancelColorPickerClose();
  currentColorTargetEditor = editorElem;

  // 暫存當前選區或游標
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (editorElem.contains(range.commonAncestorContainer)) {
      currentColorSavedRange = range.cloneRange();
    }
  }

  // 定位調色盤面板 (智慧偵測視窗上下空間，空間不足時自動向上翻轉展開)
  if (anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const pickerHeight = 360; // 面板高度預估
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let top = 0;
    // 若下方空間不足以容納色盤，且上方空間較寬裕，則自動翻轉至按鈕上方展開
    if (spaceBelow < pickerHeight && spaceAbove > spaceBelow) {
      top = Math.max(10, rect.top - pickerHeight - 8);
    } else {
      top = Math.min(window.innerHeight - pickerHeight - 10, rect.bottom + 6);
      if (top < 10) top = 10;
    }

    const left = Math.min(window.innerWidth - 270, Math.max(10, rect.left - 50));
    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;
  }

  picker.style.display = 'block';
}

function initColorPalettePicker() {
  const picker = document.getElementById('colorPalettePicker');
  if (!picker) return;

  picker.addEventListener('mousedown', (e) => {
    // 防止點擊色盤導致反白選區失焦
    e.preventDefault();
  });

  // 智慧防手震自動收合 (Smart Hover Bridge)
  picker.addEventListener('mouseenter', cancelColorPickerClose);
  picker.addEventListener('mouseleave', scheduleColorPickerClose);

  // 監聽所有觸發色彩按鈕的 hover 狀態
  document.querySelectorAll('[data-action="color"], [data-modal-action="color"], [data-bubble-action="color"]').forEach(btn => {
    btn.addEventListener('mouseenter', cancelColorPickerClose);
    btn.addEventListener('mouseleave', scheduleColorPickerClose);
  });

  picker.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const colorType = btn.dataset.colorType; // 'text' 或 'bg'
      const colorVal = btn.dataset.color; // 如 '#f43f5e' 或 'rgba(...)' 或 ''

      if (currentColorTargetEditor) {
        applyColorToSelection(currentColorTargetEditor, colorType, colorVal);
      }
      hideColorPalettePicker();
    });
  });

  document.addEventListener('click', (e) => {
    if (picker && picker.style.display === 'block') {
      if (!picker.contains(e.target) && !e.target.closest('[data-action="color"], [data-modal-action="color"], [data-bubble-action="color"]')) {
        hideColorPalettePicker();
      }
    }
  });
}

function applyColorToSelection(editorElem, type, color) {
  if (!editorElem) return;
  recordEditorSnapshot(editorElem);
  editorElem.focus();

  // 若有暫存的 Range 則還原選區
  const sel = window.getSelection();
  if (currentColorSavedRange) {
    sel.removeAllRanges();
    sel.addRange(currentColorSavedRange.cloneRange());
  }

  if (type === 'text') {
    if (!color) {
      document.execCommand('removeFormat', false, null);
    } else {
      document.execCommand('foreColor', false, color);
    }
  } else if (type === 'bg') {
    if (!color) {
      document.execCommand('hiliteColor', false, 'transparent');
    } else {
      document.execCommand('hiliteColor', false, color);
    }
  }

  saveCurrentEditorRange(editorElem);

  if (editorElem === elements.modalTaskWysiwygEditor) triggerTaskDebouncedSave();
  else triggerNotebookDebouncedSave();
}

function applyTemplateToWysiwyg(filename, editorElem, onSaved) {
  if (!filename || !editorElem) return;
  const template = state.templates.find(t => t.filename === filename);
  if (template) {
    const templateHtml = marked.parse(template.content);
    // 智慧於當前游標所在區塊的「下方」展開插入模板，並完整支援 Ctrl+Z 還原
    insertHtmlBelowCursor(editorElem, templateHtml);
    if (onSaved) onSaved();
    showToast(`已於游標下方套用模板：${template.name} (可按 Ctrl+Z 還原)`);
  }
}

// --- Templates ---
async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const data = await res.json();
    if (data.success) {
      state.templates = data.templates || [];
      populateTemplateSelects();
    }
  } catch (err) {
    console.error('載入模板失敗:', err);
  }
}

function populateTemplateSelects() {
  const selects = [
    elements.modalTemplateSelect,
    elements.notebookTemplateSelect
  ].filter(Boolean);
  selects.forEach(selectElem => {
    selectElem.innerHTML = '<option value="">📋 套用模板...</option>';
    state.templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.filename;
      opt.textContent = t.name;
      selectElem.appendChild(opt);
    });
  });

  // 同步動態整合至斜線指令選單 (/ 快捷選單)
  updateSlashMenuTemplates();
}

function updateSlashMenuTemplates() {
  if (!slashMenu) return;
  slashMenu.querySelectorAll('.slash-item-template').forEach(el => el.remove());

  state.templates.forEach(t => {
    const item = document.createElement('div');
    item.className = 'slash-item slash-item-template';
    item.dataset.slash = `template:${t.filename}`;
    item.innerHTML = `
      <span class="slash-icon">📋</span>
      <div class="slash-text">
        <span class="slash-title">套用模板：${t.name}</span>
        <span class="slash-desc">於此行原地展開並插入完整工作模板</span>
      </div>
    `;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerSlashItem(item.dataset.slash);
    });
    slashMenu.appendChild(item);
  });
}

// --- Global Search (Ctrl+K) ---
function openSearchModal() {
  elements.searchModal.classList.add('active');
  elements.searchInputField.value = '';
  elements.searchResultsList.innerHTML = `
    <div style="text-align: center; color: var(--text-dim); padding: 40px 0;">
      輸入關鍵字即可即時檢索待辦步驟與客戶知識庫
    </div>
  `;
  setTimeout(() => elements.searchInputField.focus(), 100);
}

function closeSearchModal() {
  elements.searchModal.classList.remove('active');
}

let searchTimer = null;
function handleGlobalSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = elements.searchInputField.value.trim();
    if (!q) return;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success) {
        renderSearchResults(data.results);
      }
    } catch (err) {
      console.error('搜尋失敗:', err);
    }
  }, 250);
}

function renderSearchResults(results) {
  elements.searchResultsList.innerHTML = '';
  if (results.length === 0) {
    elements.searchResultsList.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); padding: 30px 0;">
        查無符合關鍵字之內容
      </div>
    `;
    return;
  }

  results.forEach(res => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const typeBadge = res.type === 'todo' ? '📅 待辦' : '📚 知識庫';
    const subInfo = res.type === 'todo' ? `${res.client || ''} · ${res.date}` : res.category;

    item.innerHTML = `
      <div class="result-title-row">
        <span class="result-title">${res.title}</span>
        <span style="font-size: 0.75rem; color: var(--accent-cyan);">${typeBadge} · ${subInfo}</span>
      </div>
      <div class="result-snippet">${res.snippet}</div>
    `;

    item.addEventListener('click', () => {
      closeSearchModal();
      if (res.type === 'todo') {
        switchView('calendar');
        state.selectedDate = res.date;
        refreshCalendar();
        loadSelectedDayTasks(res.date);
      } else {
        switchView('notebook');
        loadNotebookNote(res.path);
      }
    });

    elements.searchResultsList.appendChild(item);
  });
}

// --- Lightbox ---
function openLightbox(imgSrc) {
  elements.lightboxImage.src = imgSrc;
  elements.lightboxModal.classList.add('active');
}
function closeLightbox() {
  elements.lightboxModal.classList.remove('active');
}

// --- Toast Notifications ---
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function getFormattedDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


/* ========================================================
   v3.0.0 NEW INTERACTIVE LOGIC & EXTENSIONS
   ======================================================== */

// --- 1. Calendar View Switcher (Month / Week / Day) ---
function switchCalendarView(mode) {
  state.calendarViewMode = mode;
  [elements.calViewMonthBtn, elements.calViewWeekBtn, elements.calViewDayBtn].forEach(b => {
    if (b) b.classList.remove('active');
  });

  if (mode === 'month') {
    if (elements.calViewMonthBtn) elements.calViewMonthBtn.classList.add('active');
    if (elements.calendarGrid) elements.calendarGrid.style.display = 'flex';
    if (elements.calendarWeekGrid) elements.calendarWeekGrid.style.display = 'none';
    if (elements.calendarDayView) elements.calendarDayView.style.display = 'none';
    renderCalendarGrid(state.currentDate.getFullYear(), state.currentDate.getMonth());
  } else if (mode === 'week') {
    if (elements.calViewWeekBtn) elements.calViewWeekBtn.classList.add('active');
    if (elements.calendarGrid) elements.calendarGrid.style.display = 'none';
    if (elements.calendarWeekGrid) elements.calendarWeekGrid.style.display = 'flex';
    if (elements.calendarDayView) elements.calendarDayView.style.display = 'none';
    renderWeekGrid(state.currentDate);
  } else if (mode === 'day') {
    if (elements.calViewDayBtn) elements.calViewDayBtn.classList.add('active');
    if (elements.calendarGrid) elements.calendarGrid.style.display = 'none';
    if (elements.calendarWeekGrid) elements.calendarWeekGrid.style.display = 'none';
    if (elements.calendarDayView) elements.calendarDayView.style.display = 'flex';
    renderDayView(state.selectedDate);
  }
}

// Render Week Grid (Notion 風格：單行全高 7 欄日曆行 + 跨欄連續彩色長條卡片 + 單日全高卡片)
function renderWeekGrid(refDate) {
  if (!elements.calendarWeekGrid) return;
  elements.calendarWeekGrid.innerHTML = '';

  const curr = new Date(refDate);
  const firstDay = new Date(curr.setDate(curr.getDate() - curr.getDay())); // Sunday
  const todayStr = getFormattedDate(new Date());

  const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const weekDays = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(firstDay);
    day.setDate(day.getDate() + i);
    const dateStr = getFormattedDate(day);
    weekDays.push({
      dateStr,
      dayName: dayNames[i],
      dateObj: day,
      dayNum: day.getDate(),
      monthNum: day.getMonth() + 1,
      isToday: dateStr === todayStr,
      isSelected: dateStr === state.selectedDate
    });
  }

  const weekStartStr = weekDays[0].dateStr;
  const weekEndStr = weekDays[6].dateStr;

  // 1. 彙整跨日任務與單日任務
  const multiDayMap = new Map();
  const singleDayTasksByCol = [[], [], [], [], [], [], []];

  weekDays.forEach((d, colIdx) => {
    const tasks = state.monthData[d.dateStr] || [];
    tasks.forEach(t => {
      if (t.isMultiDay && t.startDate && t.endDate && t.startDate !== t.endDate) {
        if (!multiDayMap.has(t.id)) {
          multiDayMap.set(t.id, t);
        }
      } else {
        singleDayTasksByCol[colIdx].push(t);
      }
    });
  });

  // 2. 表頭 (7 欄：週日至週六 + 日期數字與今日膠囊)
  const headerRow = document.createElement('div');
  headerRow.className = 'week-view-header';

  weekDays.forEach((d) => {
    const colHeader = document.createElement('div');
    colHeader.className = `week-view-header-col ${d.isToday ? 'is-today' : ''} ${d.isSelected ? 'is-selected' : ''}`;
    colHeader.dataset.date = d.dateStr;
    colHeader.innerHTML = `
      <span class="week-header-dayname">${d.dayName}</span>
      <span class="week-header-datenumber ${d.isToday ? 'today-badge' : ''}">${d.monthNum}/${d.dayNum}</span>
    `;
    colHeader.addEventListener('click', () => {
      selectWeekDate(d.dateStr);
    });
    headerRow.appendChild(colHeader);
  });
  elements.calendarWeekGrid.appendChild(headerRow);

  // 3. 週曆主體 (Body)
  const bodyContainer = document.createElement('div');
  bodyContainer.className = 'week-view-body';

  // 3.1 跨日任務長條軌道 (Notion-style Continuous Multiday Bars)
  if (multiDayMap.size > 0) {
    const multidaySection = document.createElement('div');
    multidaySection.className = 'week-view-multiday-area';

    multiDayMap.forEach(task => {
      let startCol = 1;
      let endCol = 7;
      let continueLeft = false;
      let continueRight = false;

      if (task.startDate <= weekStartStr) {
        startCol = 1;
        if (task.startDate < weekStartStr) continueLeft = true;
      } else {
        const idx = weekDays.findIndex(d => d.dateStr === task.startDate);
        startCol = idx !== -1 ? idx + 1 : 1;
      }

      if (task.endDate >= weekEndStr) {
        endCol = 7;
        if (task.endDate > weekEndStr) continueRight = true;
      } else {
        const idx = weekDays.findIndex(d => d.dateStr === task.endDate);
        endCol = idx !== -1 ? idx + 1 : 7;
      }

      if (endCol < startCol) endCol = startCol;
      const spanCols = endCol - startCol + 1;

      const bar = document.createElement('div');
      bar.className = 'multiday-bar week-spanning-bar';
      if (task.client === '北富銀') bar.classList.add('client-fubon');
      if (task.client === '國瑞汽車') bar.classList.add('client-kuorui');
      if (task.completed) bar.classList.add('completed');
      if (continueLeft) bar.classList.add('continue-left');
      if (continueRight) bar.classList.add('continue-right');

      bar.style.gridColumn = `${startCol} / span ${spanCols}`;
      bar.title = `${task.client ? '[' + task.client + '] ' : ''}${task.title} (${task.startDate} ~ ${task.endDate})`;

      const clientSpan = task.client ? `<span class="multiday-client-tag">${task.client}</span>` : '';
      const stepBadge = (task.stepsCount > 0) ? `<span class="multiday-step-badge">☑ ${task.stepsCompletedCount}/${task.stepsCount}</span>` : '';
      bar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; width: 100%;">
          ${clientSpan}
          <span class="multiday-title-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${task.title}</span>
          ${stepBadge}
        </div>
      `;

      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        openExistingTaskModal(task.id, task.date || task.startDate);
      });

      multidaySection.appendChild(bar);
    });

    bodyContainer.appendChild(multidaySection);
  }

  // 3.2 7 欄全高單日任務區 (Full-height Columns Area)
  const columnsArea = document.createElement('div');
  columnsArea.className = 'week-view-columns-area';

  weekDays.forEach((d, colIdx) => {
    const colDiv = document.createElement('div');
    colDiv.className = `week-view-col ${d.isToday ? 'is-today' : ''} ${d.isSelected ? 'is-selected' : ''}`;
    colDiv.dataset.date = d.dateStr;

    colDiv.addEventListener('click', (e) => {
      if (e.target.closest('.week-task-card') || e.target.closest('.btn-col-add-task')) return;
      selectWeekDate(d.dateStr);
    });

    const tasksListDiv = document.createElement('div');
    tasksListDiv.className = 'week-col-task-list';

    const dayTasks = singleDayTasksByCol[colIdx] || [];
    if (dayTasks.length > 0) {
      dayTasks.forEach(t => {
        const card = document.createElement('div');
        card.className = `week-task-card ${t.completed ? 'completed' : ''}`;
        if (t.client === '北富銀') card.style.borderLeftColor = '#f59e0b';
        if (t.client === '國瑞汽車') card.style.borderLeftColor = '#10b981';

        const pct = t.stepsCount > 0 ? Math.round((t.stepsCompletedCount / t.stepsCount) * 100) : (t.completed ? 100 : 0);
        card.innerHTML = `
          <div class="week-task-card-header">
            ${t.client ? `<span class="week-task-client-badge">${t.client}</span>` : ''}
            <span class="week-task-priority ${t.priority || 'normal'}">●</span>
          </div>
          <div class="week-task-card-title">${t.title}</div>
          ${t.stepsCount > 0 ? `
            <div class="week-task-progress-info">
              <span>步驟 ${t.stepsCompletedCount}/${t.stepsCount}</span>
              <span>${pct}%</span>
            </div>
            <div class="week-task-progress-bar"><div class="week-task-progress-fill" style="width: ${pct}%"></div></div>
          ` : ''}
        `;

        card.addEventListener('click', (e) => {
          e.stopPropagation();
          openExistingTaskModal(t.id, d.dateStr);
        });

        tasksListDiv.appendChild(card);
      });
    }

    colDiv.appendChild(tasksListDiv);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-col-add-task';
    addBtn.innerHTML = '<span>＋</span> 新增任務';
    addBtn.title = `新增 ${d.dateStr} 任務`;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openNewTaskModal(d.dateStr);
    });
    colDiv.appendChild(addBtn);

    columnsArea.appendChild(colDiv);
  });

  bodyContainer.appendChild(columnsArea);
  elements.calendarWeekGrid.appendChild(bodyContainer);
}

function selectWeekDate(dateStr) {
  state.selectedDate = dateStr;
  document.querySelectorAll('.week-view-col, .week-view-header-col').forEach(el => {
    el.classList.toggle('is-selected', el.dataset.date === dateStr);
  });
  if (elements.calendarSideDrawer) {
    elements.calendarSideDrawer.classList.remove('collapsed');
    updateCalendarDrawerToggleState();
  }
  loadSelectedDayTasks(dateStr);
}

// Render Day View
function renderDayView(dateStr) {
  if (!elements.calendarDayView) return;
  elements.calendarDayView.innerHTML = '';

  const dateObj = new Date(dateStr);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const tasks = state.monthData[dateStr] || [];

  const header = document.createElement('div');
  header.className = 'day-view-header';
  header.innerHTML = `
    <div class="day-view-title">📅 ${dateStr} (${weekdays[dateObj.getDay()]}) 詳細任務看板</div>
    <button class="btn-primary" style="padding: 6px 14px; font-size: 0.85rem;" id="dayViewAddTaskBtn">＋ 新增今日任務</button>
  `;
  elements.calendarDayView.appendChild(header);

  header.querySelector('#dayViewAddTaskBtn').addEventListener('click', () => openNewTaskModal(dateStr));

  const listContainer = document.createElement('div');
  listContainer.className = 'day-view-task-list';

  if (tasks.length === 0) {
    listContainer.innerHTML = '<div style="color: var(--text-dim); padding: 40px; text-align: center;">本日尚無排定任務，點擊上方按鈕建立新任務</div>';
  } else {
    tasks.forEach(t => {
      const card = document.createElement('div');
      card.className = 'day-view-task-card';
      const stepsHtml = (t.steps || []).map(s => `
        <div class="day-step-row ${s.completed ? 'done' : ''}">
          <span>${s.completed ? '☑️' : '⬜'}</span>
          <span>${s.text}</span>
        </div>
      `).join('');

      const rangeBadge = (t.isMultiDay && t.startDate && t.endDate) ? `<span style="font-size: 0.72rem; color: var(--accent-cyan); margin-left: 8px;">📅 跨日: ${t.startDate.slice(5)}~${t.endDate.slice(5)}</span>` : '';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main);">
            ${t.client ? '<span style="color: var(--accent-indigo); margin-right: 6px;">[' + t.client + ']</span>' : ''}${t.title}${rangeBadge}
          </div>
          <span style="font-size: 0.78rem; padding: 2px 8px; border-radius: 12px; background: rgba(255,255,255,0.08); color: var(--text-dim);">
            ${t.status || '待處理'}
          </span>
        </div>
        ${t.steps && t.steps.length > 0 ? `<div class="day-view-steps">${stepsHtml}</div>` : ''}
      `;
      card.addEventListener('click', () => openExistingTaskModal(t.id, dateStr));
      listContainer.appendChild(card);
    });
  }

  elements.calendarDayView.appendChild(listContainer);
}

// --- Robust openExistingTaskModal ---
async function openExistingTaskModal(taskId, dateStr) {
  try {
    if (dateStr) {
      const res = await fetch(`/api/todos?date=${dateStr}`);
      const data = await res.json();
      if (data.success && data.tasks) {
        const task = data.tasks.find(t => t.id === taskId);
        if (task) {
          openTaskCenterModal(task);
          return;
        }
      }
    }
    // Search across state.monthData
    for (const d in state.monthData) {
      const found = state.monthData[d].find(t => t.id === taskId);
      if (found) {
        const fullRes = await fetch(`/api/todos?date=${found.date || d}`);
        const fullData = await fullRes.json();
        const fullTask = fullData.tasks ? fullData.tasks.find(t => t.id === taskId) : null;
        if (fullTask) {
          openTaskCenterModal(fullTask);
          return;
        }
      }
    }
  } catch (err) {
    console.error('開啟任務失敗:', err);
  }
}

// --- 2. Table Grid Picker (8x8 visual matrix) ---
let currentEditorForTable = null;

function setupTableGridPicker() {
  if (elements.tableGridPicker) {
    elements.tableGridPicker.style.setProperty('display', 'none', 'important');
  }
  if (!elements.tableGridMatrix) return;
  elements.tableGridMatrix.innerHTML = '';

  for (let r = 1; r <= 8; r++) {
    for (let c = 1; c <= 8; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      cell.addEventListener('mouseenter', () => highlightGrid(r, c));
      cell.addEventListener('mouseover', () => highlightGrid(r, c));
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        insertSelectedTable(r, c);
      });
      elements.tableGridMatrix.appendChild(cell);
    }
  }

  // 容器層委派 mousemove，確保滑鼠快速掠過方格時即時平滑更新尺寸數字
  elements.tableGridMatrix.addEventListener('mousemove', (e) => {
    const target = e.target.closest('.grid-cell');
    if (target) {
      const r = parseInt(target.dataset.row);
      const c = parseInt(target.dataset.col);
      highlightGrid(r, c);
    }
  });

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    if (elements.tableGridPicker && !elements.tableGridPicker.contains(e.target) && !e.target.closest('[data-action="table"]') && !e.target.closest('[data-modal-action="table"]')) {
      elements.tableGridPicker.style.setProperty('display', 'none', 'important');
    }
  });
}

function highlightGrid(targetRow, targetCol) {
  if (!elements.tableGridMatrix) return;
  const cells = elements.tableGridMatrix.querySelectorAll('.grid-cell');
  cells.forEach(c => {
    const r = parseInt(c.dataset.row);
    const col = parseInt(c.dataset.col);
    if (r <= targetRow && col <= targetCol) {
      c.classList.add('highlighted');
    } else {
      c.classList.remove('highlighted');
    }
  });
  const dimLabel = document.getElementById('gridDimensionsLabel');
  if (dimLabel) {
    dimLabel.textContent = `${targetRow} × ${targetCol}`;
  }
}

function toggleTableGridPicker(editorElem, btnElem) {
  currentEditorForTable = editorElem;
  if (!elements.tableGridPicker) return;
  if (elements.tableGridPicker.style.display === 'block') {
    elements.tableGridPicker.style.setProperty('display', 'none', 'important');
    return;
  }
  if (btnElem) {
    const rect = btnElem.getBoundingClientRect();
    elements.tableGridPicker.style.top = (rect.bottom + 6) + 'px';
    elements.tableGridPicker.style.left = Math.min(window.innerWidth - 220, Math.max(10, rect.left)) + 'px';
  }
  elements.tableGridPicker.style.setProperty('display', 'block', 'important');
  highlightGrid(1, 1);
}

function insertSelectedTable(rows, cols) {
  if (!currentEditorForTable) return;
  currentEditorForTable.focus();

  let theadThs = '';
  for (let c = 1; c <= cols; c++) {
    theadThs += `<th>標題 ${c}</th>`;
  }

  let tbodyRows = '';
  for (let r = 1; r <= rows; r++) {
    let tds = '';
    for (let c = 1; c <= cols; c++) {
      tds += `<td>單元格 ${r}-${c}</td>`;
    }
    tbodyRows += `<tr>${tds}</tr>`;
  }

  const tableHtml = `
    <table>
      <thead><tr>${theadThs}</tr></thead>
      <tbody>${tbodyRows}</tbody>
    </table><p></p>
  `;

  insertHtmlAtCursor(currentEditorForTable, tableHtml);
  if (elements.tableGridPicker) elements.tableGridPicker.style.setProperty('display', 'none', 'important');
}

// --- 3. Interactive WYSIWYG Enhancements (Checkbox, Image Resizing, Undo/Redo, Scoped Select All) ---
let activeSelectedImg = null;

function setupCanvasInteractiveHandlers(editorElem, onAutoSave) {
  if (!editorElem) return;

  // 隨時追蹤並記憶最後一次游標位置 (支援失焦後仍能插入指定位置)
  ['keyup', 'mouseup', 'focus'].forEach(evt => {
    editorElem.addEventListener(evt, () => saveCurrentEditorRange(editorElem));
  });

  // Checkbox toggle click & change handler
  const handleCheckboxToggle = (e) => {
    if (e.target && e.target.classList.contains('interactive-todo-cb')) {
      const line = e.target.closest('.todo-item-line');
      if (line) {
        if (e.target.checked) {
          line.classList.add('is-done');
          e.target.setAttribute('checked', 'checked');
        } else {
          line.classList.remove('is-done');
          e.target.removeAttribute('checked');
        }
        if (onAutoSave) onAutoSave();
      }
    }
  };
  editorElem.addEventListener('change', handleCheckboxToggle);
  editorElem.addEventListener('click', handleCheckboxToggle);

  // Todo Item Line Keyboard Controls (Enter: next item / exit; Tab: multi-level indent; Shift+Tab: outdent; Backspace: outdent/remove)
  editorElem.addEventListener('keydown', (e) => {
    const sel = window.getSelection();
    let anchor = null;
    if (sel && sel.anchorNode) {
      anchor = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    }
    const currentTodo = anchor ? anchor.closest('.todo-item-line') : e.target.closest('.todo-item-line');
    const currentLi = anchor ? anchor.closest('li') : e.target.closest('li');

    // 0. Callout Block Exit (Shift+Enter) and Delete (Backspace)
    const currentCallout = anchor ? anchor.closest('.callout-block') : e.target.closest('.callout-block');
    if (currentCallout) {
      const isInsideCalloutContent = anchor && anchor.closest('.callout-content');
      if (isInsideCalloutContent && e.key === 'Enter' && e.shiftKey) {
        // Shift+Enter: Escape callout container!
        e.preventDefault();
        const newP = document.createElement('p');
        newP.innerHTML = '<br>';
        currentCallout.after(newP);
        moveCaretToElement(newP);
        if (onAutoSave) onAutoSave();
        return;
      }

      if (isInsideCalloutContent && e.key === 'Backspace') {
        const contentEl = currentCallout.querySelector('.callout-content');
        const allText = contentEl ? (contentEl.innerText || contentEl.textContent || '').trim() : '';
        if (!allText) {
          e.preventDefault();
          const newP = document.createElement('p');
          newP.innerHTML = '<br>';
          currentCallout.replaceWith(newP);
          moveCaretToElement(newP);
          if (onAutoSave) onAutoSave();
          return;
        }
      }
    }

    // 1. Table Tab Navigation & Auto-Row Expansion (Word / Notion standard)
    const currentCell = anchor ? anchor.closest('td, th') : null;
    if (currentCell && e.key === 'Tab') {
      const table = currentCell.closest('table');
      if (table) {
        e.preventDefault();
        const allCells = Array.from(table.querySelectorAll('th, td'));
        const currentIndex = allCells.indexOf(currentCell);

        if (e.shiftKey) {
          if (currentIndex > 0) {
            moveCaretToElement(allCells[currentIndex - 1]);
          }
        } else {
          if (currentIndex < allCells.length - 1) {
            moveCaretToElement(allCells[currentIndex + 1]);
          } else {
            // Auto-append a new row at the bottom of the table
            const tbody = table.querySelector('tbody') || table;
            const headerRow = table.querySelector('tr');
            const colCount = headerRow ? headerRow.querySelectorAll('th, td').length : 2;
            const newTr = document.createElement('tr');
            for (let i = 0; i < colCount; i++) {
              const newTd = document.createElement('td');
              newTd.innerHTML = '<br>';
              newTr.appendChild(newTd);
            }
            tbody.appendChild(newTr);
            const firstNewCell = newTr.querySelector('td');
            moveCaretToElement(firstNewCell);
            if (onAutoSave) onAutoSave();
          }
        }
        return;
      }
    }

    // 2. Code Block Tab Indent and Shift+Enter Exit
    const currentCode = anchor ? anchor.closest('pre') : null;
    if (currentCode) {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
        if (onAutoSave) onAutoSave();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        const newP = document.createElement('p');
        newP.innerHTML = '<br>';
        currentCode.after(newP);
        moveCaretToElement(newP);
        if (onAutoSave) onAutoSave();
        return;
      }
    }

    // 3. Tab / Shift+Tab inside bullet or numbered list & Smart Exit on empty item
    if (currentLi && !currentTodo) {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          document.execCommand('outdent', false, null);
        } else {
          document.execCommand('indent', false, null);
        }
        if (onAutoSave) onAutoSave();
        return;
      }

      if (e.key === 'Enter') {
        const liText = (currentLi.innerText || currentLi.textContent || '').trim();
        // Empty bullet -> exit list to normal paragraph (Google Docs / Notion standard)
        if (!liText) {
          e.preventDefault();
          const listParent = currentLi.closest('ul, ol');
          currentLi.remove();
          const newP = document.createElement('p');
          newP.innerHTML = '<br>';
          if (listParent) {
            listParent.after(newP);
            if (!listParent.querySelector('li')) {
              listParent.remove();
            }
          } else {
            editorElem.appendChild(newP);
          }
          moveCaretToElement(newP);
          if (onAutoSave) onAutoSave();
          return;
        }
      }
    }

    // 2. Tab / Enter / Backspace inside Todo item
    if (currentTodo) {
      const span = currentTodo.querySelector('.todo-text-span');
      const text = span ? (span.innerText || span.textContent).trim() : '';
      const currentLevel = parseInt(currentTodo.dataset.level || '0', 10);

      if (e.key === 'Enter') {
        e.preventDefault();
        if (!text) {
          // Empty todo item -> exit todo, convert to normal paragraph
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          currentTodo.replaceWith(p);
          if (sel) {
            const range = document.createRange();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          if (onAutoSave) onAutoSave();
          return;
        }

        // Create next todo line with the exact same indentation level!
        const newLine = document.createElement('div');
        newLine.className = 'todo-item-line';
        newLine.dataset.level = currentLevel;
        newLine.style.marginLeft = (currentLevel * 24) + 'px';
        newLine.innerHTML = `<input type="checkbox" class="interactive-todo-cb"><span class="todo-text-span" contenteditable="true"></span>`;
        currentTodo.after(newLine);
        const newSpan = newLine.querySelector('.todo-text-span');
        if (newSpan) {
          newSpan.focus();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(newSpan);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        if (onAutoSave) onAutoSave();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        let newLevel = currentLevel;
        if (e.shiftKey) {
          newLevel = Math.max(0, currentLevel - 1);
        } else {
          newLevel = Math.min(8, currentLevel + 1);
        }
        currentTodo.dataset.level = newLevel;
        currentTodo.style.marginLeft = (newLevel * 24) + 'px';
        if (onAutoSave) onAutoSave();
        return;
      }

      if (e.key === 'Backspace' && !text) {
        e.preventDefault();
        if (currentLevel > 0) {
          const newLevel = currentLevel - 1;
          currentTodo.dataset.level = newLevel;
          currentTodo.style.marginLeft = (newLevel * 24) + 'px';
        } else {
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          currentTodo.replaceWith(p);
          if (sel) {
            const range = document.createRange();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        if (onAutoSave) onAutoSave();
        return;
      }
    }

    // 3. Tab in general paragraphs (insert 2 spaces instead of losing focus)
    if (e.key === 'Tab' && !currentTodo && !currentLi) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
      if (onAutoSave) onAutoSave();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (e.shiftKey) {
        // Redo (雙重支援：原生 + 快照)
        e.preventDefault();
        const nativeSuccess = document.execCommand('redo', false, null);
        if (!nativeSuccess) {
          restoreEditorSnapshotRedo(editorElem, onAutoSave);
        }
      } else {
        // Undo (雙重支援：原生 + 快照，100% 確保模板與重大變更可撤銷)
        e.preventDefault();
        const nativeSuccess = document.execCommand('undo', false, null);
        if (!nativeSuccess) {
          restoreEditorSnapshotUndo(editorElem, onAutoSave);
        }
      }
      if (onAutoSave) onAutoSave();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      // Redo
      e.preventDefault();
      const nativeSuccess = document.execCommand('redo', false, null);
      if (!nativeSuccess) {
        restoreEditorSnapshotRedo(editorElem, onAutoSave);
      }
      if (onAutoSave) onAutoSave();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      // Scoped Select All (Only within current note canvas!)
      e.preventDefault();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorElem);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  // Image Click & Resize Handle
  editorElem.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') {
      selectImageForResizing(e.target, editorElem, onAutoSave);
    } else if (!e.target.closest('.image-resizable-wrapper') && !e.target.closest('.image-float-toolbar')) {
      deselectImage();
    }
  });
}

function selectImageForResizing(imgElem, editorElem, onAutoSave) {
  deselectImage();
  activeSelectedImg = imgElem;

  let wrapper = imgElem.closest('.image-resizable-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'image-resizable-wrapper';
    imgElem.parentNode.insertBefore(wrapper, imgElem);
    wrapper.appendChild(imgElem);

    const handle = document.createElement('div');
    handle.className = 'image-resize-handle';
    wrapper.appendChild(handle);

    setupResizeHandleDrag(handle, imgElem, wrapper, onAutoSave);
  }

  wrapper.classList.add('is-selected');
  showImageFloatToolbar(wrapper, imgElem, onAutoSave);
}

function deselectImage() {
  if (activeSelectedImg) {
    const wrapper = activeSelectedImg.closest('.image-resizable-wrapper');
    if (wrapper) wrapper.classList.remove('is-selected');
    activeSelectedImg = null;
  }
  if (elements.imageFloatToolbar) {
    elements.imageFloatToolbar.style.display = 'none';
  }
}

function showImageFloatToolbar(wrapper, imgElem, onAutoSave) {
  if (!elements.imageFloatToolbar) return;
  wrapper.appendChild(elements.imageFloatToolbar);
  elements.imageFloatToolbar.style.display = 'flex';

  // Preset buttons
  elements.imageFloatToolbar.querySelectorAll('[data-img-size]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const size = btn.dataset.imgSize;
      imgElem.style.width = size;
      imgElem.style.height = 'auto';
      if (onAutoSave) onAutoSave();
    };
  });

  elements.imageFloatToolbar.querySelectorAll('[data-img-align]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      wrapper.classList.remove('align-left', 'align-center', 'align-right');
      const align = btn.dataset.imgAlign;
      if (align !== 'none') wrapper.classList.add('align-' + align);
      if (onAutoSave) onAutoSave();
    };
  });

  const zoomBtn = elements.imageFloatToolbar.querySelector('#imgToolZoom');
  if (zoomBtn) {
    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      openLightbox(imgElem.src);
    };
  }

  const delBtn = elements.imageFloatToolbar.querySelector('#imgToolDelete');
  if (delBtn) {
    delBtn.onclick = (e) => {
      e.stopPropagation();
      wrapper.remove();
      deselectImage();
      if (onAutoSave) onAutoSave();
    };
  }
}

function setupResizeHandleDrag(handle, imgElem, wrapper, onAutoSave) {
  let startX, startY, startWidth, startHeight;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = imgElem.offsetWidth;
    startHeight = imgElem.offsetHeight;

    const onMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const newWidth = Math.max(60, startWidth + dx);
      imgElem.style.width = newWidth + 'px';
      imgElem.style.height = 'auto';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (onAutoSave) onAutoSave();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function triggerTaskAutoSave() { triggerTaskDebouncedSave(); }
function triggerNotebookAutoSave() { triggerNotebookDebouncedSave(); }

