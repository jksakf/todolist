# PersonalWorkHub (todolist) 版本控制與 GitHub 發佈規格書

## 1. 需求總結 (Requirement Summary)
- **目標範疇**：針對 `c:\MentorTrust\AI\todolist` 獨立建立 Git 版本控制儲存庫，不波及工作區內其他專案。
- **儲存庫屬性**：GitHub Public（公開）儲存庫。
- **安全性與隱私規範**：
  - 嚴格排除 `data/` 內使用者的真實待辦事項、筆記資料與資源檔案。
  - 透過 `.gitkeep` 保留目錄骨架，確保專案能正常被 clone 與啟動。
  - 排除二進位檔案（`PersonalWorkHub.exe`、`*.exe`）、系統檔案（`Thumbs.db` 等）與日誌（`*.log`）。
- **目標遠端**：使用者於 GitHub 建立之空白 Repository，透過 HTTPS 進行驗證與初次推送。
- **預設分支**：採用 `main`。

---

## 2. 正式假設 (Formal Assumptions)
1. 使用者本機已安裝 Git，全域已配置 `user.name = Ian Yang` 與 `user.email = kian0963315188@gmail.com`。
2. 遠端推送將依賴 Windows Git Credential Manager 或 GitHub Personal Access Token (PAT) 進行 HTTPS 授權。
3. 待辦事項與記事資料屬於本機隱私，不應進入公開儲存庫的 Git commit 歷史紀錄中。

---

## 3. 完整決策紀錄 (Decision Log)

| 決策項目 | 採納方案 | 考慮過的替代方案 | 採納原因與權衡考量 |
| :--- | :--- | :--- | :--- |
| **版控範圍** | 僅獨立版控 `todolist` | 工作區 Monorepo、多專案各自獨立 | todolist 為獨立完整前後端應用，單一 Repo 架構清晰，避免與未完成/不同性質專案混合。 |
| **資料隔離策略** | 方案 A：`.gitignore` 深度防護 + `.gitkeep` 骨架保留 | 方案 B（手動無防護）、方案 C（範本隔離自建邏輯） | 既能保障公開儲存庫絕對無個人隱私外洩風險，又無需修改後端現有程式碼架構 (符合 YAGNI)。 |
| **分支與提交策略** | `main` 分支 + 繁中規範化語意提交 | 預設 `master`、隨意 commit 訊息 | 符合當前 GitHub 預設標準與專案規範，歷史紀錄具高度可讀性。 |

---

## 4. 最終設計方案 (Final Design Specification)

### 4.1 檔案過濾規範 (`.gitignore`)
```gitignore
# Dependencies
node_modules/
package-lock.json

# Build outputs & Binaries
dist/
build/
*.exe
PersonalWorkHub.exe

# Logs and runtime data
logs/
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# User Data & Privacy Isolation
# 忽略使用者實體資料，僅保留目錄結構
data/*
!data/**/
!data/**/.gitkeep

# System files
Thumbs.db
ehthumbs.db
Desktop.ini
.DS_Store

# IDE and Editor files
.vscode/
.idea/
*.sublime-project
*.sublime-workspace

# Temporary files
*.tmp
*.temp
```

### 4.2 目錄骨架定義
於以下目錄建立空白 `.gitkeep`：
- `data/assets/.gitkeep`
- `data/notebooks/.gitkeep`
- `data/templates/.gitkeep`
- `data/todos/.gitkeep`

### 4.3 執行步驟流程
1. 更新 `.gitignore` 與補充 `.gitkeep`。
2. 於 `todolist` 目錄執行 `git init -b main`。
3. 執行 `git add .`。
4. 檢查暫存狀態清單，確認無二進位與隱私檔案。
5. 執行 `git commit -m "feat: 初始化 PersonalWorkHub 專案結構與前後端原始碼"`。
6. 設定遠端位址：`git remote add origin <GitHub_Repository_URL>`。
7. 推送至遠端：`git push -u origin main`。

