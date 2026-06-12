const fs = require('fs');
const path = require('path');

// ⚠️ 請務必將這裡的檔名，改成您從 Bio-IDE 下載的那個 JSON 檔案的真實名稱！
const workspaceFile = 'BioIDE_Workspace_2026-06-11.json'; 

try {
    const rawData = fs.readFileSync(path.join(__dirname, workspaceFile), 'utf8');
    const workspace = JSON.parse(rawData);

    console.log("📦 正在從 Bio-IDE VFS 還原實體檔案...\n");

    workspace.tabs.forEach(tab => {
        // 略過 IDE 的錯誤恢復暫存檔，或 unpack.js 本身 (如果您是用 IDE 匯出的話)
        if (tab.name.includes('Error-Recovery') || tab.name === 'unpack.js') return;

        const filePath = path.join(__dirname, tab.name);
        const dirName = path.dirname(filePath);
        
        // 如果是 src 或 src/workers，自動幫您把資料夾建好
        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }
        
        fs.writeFileSync(filePath, tab.code, 'utf8');
        console.log(`✅ 成功還原實體檔案: ${tab.name}`);
    });

    console.log('\n🎉 解包完成！現在您可以打開終端機 (Terminal)，依序執行：');
    console.log('👉 npm install');
    console.log('👉 npm run dev');
    console.log('👉 npm run build');
} catch (err) {
    console.error("❌ 解包失敗，請檢查 JSON 檔名是否正確填寫！", err.message);
}