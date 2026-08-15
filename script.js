// ========== SECURITY UTILITIES ==========

// 1. Sanitization - منع هجمات XSS
function sanitizeText(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);
    
    // إزالة HTML tags والسماح فقط بالنص الآمن
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '=': '&#x3D;',
        '`': '&#x60;'
    };
    return text.replace(/[&<>"'/=`]/g, function(match) {
        return map[match];
    });
}

// التحقق من صحة النص (منع الأكواد الضارة)
function isValidText(text) {
    if (typeof text !== 'string') return false;
    // منع الـ JavaScript URLs والـ event handlers
    const dangerousPatterns = [
        /javascript:/i,
        /on\w+\s*=/i,
        /<script/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
        /data:text\/html/i,
        /vbscript:/i
    ];
    return !dangerousPatterns.some(pattern => pattern.test(text));
}

// 2. التحقق من صحة الملفات المستوردة
function validateRETBFile(data) {
    // التحقق من وجود البيانات الأساسية
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid file format: Data is not an object');
    }
    
    // التحقق من وجود grid
    if (!data.grid || !Array.isArray(data.grid)) {
        throw new Error('Invalid file: Missing or invalid grid data');
    }
    
    // التحقق من حجم البيانات (منع الملفات الكبيرة جداً)
    const MAX_FILE_SIZE_MB = 10;
    const jsonString = JSON.stringify(data);
    const sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > MAX_FILE_SIZE_MB) {
        throw new Error(`File too large: ${sizeInMB.toFixed(2)}MB (max ${MAX_FILE_SIZE_MB}MB)`);
    }
    
    // التحقق من عدد الصفوف والأعمدة
    const MAX_ROWS_FILE = 1000;
    const MAX_COLS_FILE = 100;
    if (data.grid.length > MAX_ROWS_FILE) {
        throw new Error(`Too many rows: ${data.grid.length} (max ${MAX_ROWS_FILE})`);
    }
    if (data.grid.length > 0 && data.grid[0].length > MAX_COLS_FILE) {
        throw new Error(`Too many columns: ${data.grid[0].length} (max ${MAX_COLS_FILE})`);
    }
    
    // التحقق من صحة كل خلية
    for (let r = 0; r < data.grid.length; r++) {
        if (!Array.isArray(data.grid[r])) {
            throw new Error(`Invalid row ${r}: Not an array`);
        }
        for (let c = 0; c < data.grid[r].length; c++) {
            const cell = data.grid[r][c];
            if (!cell || typeof cell !== 'object') {
                throw new Error(`Invalid cell at [${r}][${c}]: Not an object`);
            }
            // التحقق من وجود value
            if (cell.value !== undefined && typeof cell.value === 'string') {
                // تطهير النصوص في الملف المستورد
                data.grid[r][c].value = sanitizeText(cell.value);
                // التحقق من صحة النص
                if (!isValidText(cell.value)) {
                    throw new Error(`Suspicious content detected in cell [${r}][${c}]`);
                }
            }
            // التحقق من type مسموح به
            const allowedTypes = ['text', 'number', 'checkbox', 'date', 'link'];
            if (cell.type && !allowedTypes.includes(cell.type)) {
                throw new Error(`Invalid cell type at [${r}][${c}]: ${cell.type}`);
            }
        }
    }
    
    // التحقق من colWidths
    if (data.colWidths && !Array.isArray(data.colWidths)) {
        throw new Error('Invalid colWidths: Not an array');
    }
    if (data.colWidths) {
        for (let w of data.colWidths) {
            if (typeof w !== 'number' || w < 20 || w > 500) {
                throw new Error(`Invalid column width: ${w} (must be between 20-500)`);
            }
        }
    }
    
    return true;
}

// 3. التحقق من الحدود (Boundary Checking)
function validateCellAccess(row, col) {
    if (row < 0 || row >= gridData.length) {
        console.warn(`Invalid row access: ${row}`);
        return false;
    }
    if (col < 0 || col >= colWidths.length) {
        console.warn(`Invalid column access: ${col}`);
        return false;
    }
    return true;
}

function getCellSafe(row, col) {
    if (!validateCellAccess(row, col)) {
        return null;
    }
    return gridData[row][col];
}

function setCellSafe(row, col, value) {
    if (!validateCellAccess(row, col)) {
        return false;
    }
    gridData[row][col] = value;
    return true;
}

// ========== DATA MODEL ==========
let gridData = [];
let rowHeights = [];
let colWidths = [];
let merges = [];
let activeFilter = null;
let activeSort = null;
let rowNumberingEnabled = true;
let wordWrapEnabled = false;

// Color settings - each cell stores its own colors
let cellColors = []; // 2D array parallel to gridData

let selectedRow = 0, selectedCol = 0;
let selectionEndRow = 0, selectionEndCol = 0;
let isSelecting = false;

let historyStack = [];
let historyIndex = -1;
let clipboardData = null;

const DEFAULT_ROWS = 15;
const DEFAULT_COLS = 8;
const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_COL_WIDTH = 100;
const MAX_ROWS = 800;
const MAX_COLS = 80;

function initEmptyGrid(rows, cols) {
    let newGrid = [];
    let newColors = [];
    for(let i=0; i<rows; i++) {
        newGrid[i] = [];
        newColors[i] = [];
        for(let j=0; j<cols; j++) {
            newGrid[i][j] = { value: '', type: 'text', align: 'left' };
            newColors[i][j] = null;
        }
    }
    return { grid: newGrid, colors: newColors };
}

function resetTable(rows=DEFAULT_ROWS, cols=DEFAULT_COLS) {
    rows = Math.min(rows, MAX_ROWS);
    cols = Math.min(cols, MAX_COLS);
    if (rows < 1) rows = 1;
    if (cols < 1) cols = 1;

    let result = initEmptyGrid(rows, cols);
    gridData = result.grid;
    cellColors = result.colors;
    rowHeights = Array(rows).fill(DEFAULT_ROW_HEIGHT);
    colWidths = Array(cols).fill(DEFAULT_COL_WIDTH);
    merges = [];
    activeFilter = null;
    activeSort = null;
    selectedRow = 0; selectedCol = 0;
    selectionEndRow = 0; selectionEndCol = 0;
    renderSheet();
    saveToHistory();
    updateStatus();
}

function saveToHistory() {
    const state = JSON.parse(JSON.stringify({
        grid: gridData,
        rowHeights,
        colWidths,
        merges,
        cellColors: cellColors
    }));
    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    historyStack.push(state);
    historyIndex = historyStack.length - 1;
    if (historyStack.length > 50) historyStack.shift();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreState(historyStack[historyIndex]);
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        restoreState(historyStack[historyIndex]);
    }
}

function restoreState(state) {
    gridData = state.grid;
    rowHeights = state.rowHeights;
    colWidths = state.colWidths;
    merges = state.merges;
    cellColors = state.cellColors || [];
    while (cellColors.length < gridData.length) {
        cellColors.push(new Array(colWidths.length).fill(null));
    }
    for (let i = 0; i < cellColors.length; i++) {
        while (cellColors[i].length < colWidths.length) {
            cellColors[i].push(null);
        }
    }
    activeFilter = null;
    activeSort = null;
    renderSheet();
    updateStatus();
}

function isCellMerged(row, col) {
    if (!validateCellAccess(row, col)) return null;
    for (let m of merges) {
        if (row >= m.r && row < m.r + m.rowspan && col >= m.c && col < m.c + m.colspan) {
            return m;
        }
    }
    return null;
}

function applyFilterAndSort() {
    let rows = [...Array(gridData.length).keys()];
    if (activeFilter) {
        rows = rows.filter(rowIdx => {
            let val = getCellRawValue(rowIdx, activeFilter.colIndex);
            if (!val && val !== 0) return false;
            return val.toString().toLowerCase().includes(activeFilter.condition.toLowerCase());
        });
    }
    if (activeSort) {
        rows.sort((a,b) => {
            let valA = getCellRawValue(a, activeSort.col);
            let valB = getCellRawValue(b, activeSort.col);
            if (typeof valA === 'number' && typeof valB === 'number') {
                return activeSort.dir === 'asc' ? valA - valB : valB - valA;
            }
            let strA = String(valA || '').toLowerCase();
            let strB = String(valB || '').toLowerCase();
            return activeSort.dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
    }
    return rows;
}

function getCellRawValue(row, col) {
    if (!validateCellAccess(row, col)) return '';
    if (!gridData[row] || !gridData[row][col]) return '';
    let cell = gridData[row][col];
    if (cell.type === 'checkbox') return cell.value ? 'true' : 'false';
    return cell.value;
}

function updateCellValue(row, col, newValue, newType = null) {
    if (!validateCellAccess(row, col)) return;
    
    let old = gridData[row][col];
    let type = newType || old.type;
    let align = old.align || 'left';
    let value = newValue;
    
    // تطهير النص إذا كان من نوع text
    if (type === 'text' || type === 'link') {
        if (typeof value === 'string') {
            // التحقق من صحة النص
            if (!isValidText(value)) {
                // تجاهل المدخلات الضارة
                return;
            }
            value = sanitizeText(value);
        }
    }
    
    if (type === 'number' && !isNaN(parseFloat(newValue))) {
        value = parseFloat(newValue);
    }
    
    gridData[row][col] = { value: value, type: type, align: align };
    saveToHistory();
    renderSheet();
}

// Minimize column - like Resize Col but for minimizing
function minimizeColumn() {
    if (selectedCol === undefined || selectedCol < 0) {
        return;
    }
    if (!validateCellAccess(0, selectedCol)) return;
    
    let currentWidth = colWidths[selectedCol];
    let newW = prompt('Minimize column width (pixels):', currentWidth);
    if (newW !== null && newW !== '') {
        let parsedWidth = parseInt(newW);
        if (isNaN(parsedWidth) || parsedWidth < 10) {
            return;
        }
        // Apply to all columns in selection range
        let { minCol, maxCol } = getSelectedRange();
        for (let c = minCol; c <= maxCol; c++) {
            if (c >= 0 && c < colWidths.length) {
                colWidths[c] = parsedWidth;
            }
        }
        saveToHistory();
        renderSheet();
    }
}

// Apply cell background color to ALL selected cells
function applyCellColor(color) {
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) {
                if (!cellColors[r][c]) {
                    cellColors[r][c] = { bg: null, text: null };
                }
                cellColors[r][c].bg = color;
            }
        }
    }
    saveToHistory();
    renderSheet();
    updateStatus();
}

// Apply text color to ALL selected cells
function applyTextColor(color) {
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) {
                if (!cellColors[r][c]) {
                    cellColors[r][c] = { bg: null, text: null };
                }
                cellColors[r][c].text = color;
            }
        }
    }
    saveToHistory();
    renderSheet();
    updateStatus();
}

// Clear colors from selected cells
function clearSelectedColors() {
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c] && cellColors[r][c]) {
                cellColors[r][c] = null;
            }
        }
    }
    saveToHistory();
    renderSheet();
    updateStatus();
}

function getCellColor(row, col) {
    if (!validateCellAccess(row, col)) return null;
    if (cellColors[row] && cellColors[row][col]) {
        return cellColors[row][col];
    }
    return null;
}

function getCellBgColor(row, col) {
    let color = getCellColor(row, col);
    return color ? color.bg : null;
}

function getCellTextColor(row, col) {
    let color = getCellColor(row, col);
    return color ? color.text : null;
}

// Merge function with warning
function mergeSelected() {
    if (selectedRow === undefined || selectedCol === undefined) {
        return;
    }
    if (!validateCellAccess(selectedRow, selectedCol)) return;
    
    let minRow = Math.min(selectedRow, selectionEndRow);
    let maxRow = Math.max(selectedRow, selectionEndRow);
    let minCol = Math.min(selectedCol, selectionEndCol);
    let maxCol = Math.max(selectedCol, selectionEndCol);

    if (minRow === maxRow && minCol === maxCol) {
        return;
    }

    let confirmMerge = confirm("⚠️ Warning: Merging cells will keep only the content of the top-left cell. All other data in the selected range will be lost. Do you want to continue?");
    if (!confirmMerge) return;

    merges = merges.filter(m => {
        let mEndRow = m.r + m.rowspan - 1;
        let mEndCol = m.c + m.colspan - 1;
        return !(m.r <= maxRow && mEndRow >= minRow && m.c <= maxCol && mEndCol >= minCol);
    });

    merges.push({ r: minRow, c: minCol, rowspan: maxRow - minRow + 1, colspan: maxCol - minCol + 1 });
    let mainValue = gridData[minRow][minCol].value;
    let mainType = gridData[minRow][minCol].type;
    let mainAlign = gridData[minRow][minCol].align;
    let mainColors = cellColors[minRow] && cellColors[minRow][minCol] ?
        JSON.parse(JSON.stringify(cellColors[minRow][minCol])) : null;

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (!(r === minRow && c === minCol)) {
                gridData[r][c] = { value: '', type: 'text', align: 'left' };
                cellColors[r][c] = null;
            }
        }
    }
    gridData[minRow][minCol] = { value: mainValue, type: mainType, align: mainAlign };
    cellColors[minRow][minCol] = mainColors;

    saveToHistory();
    renderSheet();
    updateStatus();
}

function unmergeSelected() {
    if (selectedRow === undefined || selectedCol === undefined) {
        return;
    }
    if (!validateCellAccess(selectedRow, selectedCol)) return;
    
    let foundMerge = null;
    for (let m of merges) {
        if (selectedRow >= m.r && selectedRow < m.r + m.rowspan &&
            selectedCol >= m.c && selectedCol < m.c + m.colspan) {
            foundMerge = m;
            break;
        }
    }
    if (foundMerge) {
        merges = merges.filter(m => m !== foundMerge);
        let mainValue = gridData[foundMerge.r][foundMerge.c].value;
        let mainType = gridData[foundMerge.r][foundMerge.c].type;
        let mainColors = cellColors[foundMerge.r] && cellColors[foundMerge.r][foundMerge.c] ?
            JSON.parse(JSON.stringify(cellColors[foundMerge.r][foundMerge.c])) : null;

        for (let r = foundMerge.r; r < foundMerge.r + foundMerge.rowspan; r++) {
            for (let c = foundMerge.c; c < foundMerge.c + foundMerge.colspan; c++) {
                if (r === foundMerge.r && c === foundMerge.c) {
                    gridData[r][c] = { value: mainValue, type: mainType, align: 'left' };
                    cellColors[r][c] = mainColors;
                } else {
                    gridData[r][c] = { value: '', type: 'text', align: 'left' };
                    cellColors[r][c] = null;
                }
            }
        }
        saveToHistory();
        renderSheet();
    }
}

function getSelectedRange() {
    let minRow = Math.max(0, Math.min(selectedRow, selectionEndRow));
    let maxRow = Math.min(gridData.length - 1, Math.max(selectedRow, selectionEndRow));
    let minCol = Math.max(0, Math.min(selectedCol, selectionEndCol));
    let maxCol = Math.min(colWidths.length - 1, Math.max(selectedCol, selectionEndCol));
    return { minRow, maxRow, minCol, maxCol };
}

function applyToSelectedRange(callback) {
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) {
                callback(r, c);
            }
        }
    }
    saveToHistory();
    renderSheet();
}

function setAlignment(align) {
    applyToSelectedRange((r,c) => gridData[r][c].align = align);
}

function deleteContent() {
    if (confirm("Delete content of selected cells? This cannot be undone.")) {
        applyToSelectedRange((r,c) => {
            gridData[r][c].value = '';
            gridData[r][c].type = 'text';
            cellColors[r][c] = null;
        });
    }
}

function copySelection() {
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    clipboardData = [];
    for (let r = minRow; r <= maxRow; r++) {
        let rowData = [];
        for (let c = minCol; c <= maxCol; c++) {
            rowData.push({
                cell: JSON.parse(JSON.stringify(gridData[r][c])),
                colors: cellColors[r] && cellColors[r][c] ?
                    JSON.parse(JSON.stringify(cellColors[r][c])) : null
            });
        }
        clipboardData.push(rowData);
    }
}

function cutSelection() {
    copySelection();
    deleteContent();
}

function pasteSelection() {
    if (!clipboardData) {
        return;
    }
    let { minRow, minCol } = getSelectedRange();
    for (let i = 0; i < clipboardData.length && minRow + i < gridData.length; i++) {
        for (let j = 0; j < clipboardData[0].length && minCol + j < colWidths.length; j++) {
            let pasteItem = clipboardData[i][j];
            gridData[minRow + i][minCol + j] = JSON.parse(JSON.stringify(pasteItem.cell));
            cellColors[minRow + i][minCol + j] = pasteItem.colors ?
                JSON.parse(JSON.stringify(pasteItem.colors)) : null;
        }
    }
    saveToHistory();
    renderSheet();
}

function addRow() {
    if (gridData.length >= MAX_ROWS) {
        return;
    }
    let newRow = [];
    let newColorRow = [];
    for (let j = 0; j < colWidths.length; j++) {
        newRow.push({ value: '', type: 'text', align: 'left' });
        newColorRow.push(null);
    }
    gridData.push(newRow);
    cellColors.push(newColorRow);
    rowHeights.push(DEFAULT_ROW_HEIGHT);
    saveToHistory();
    renderSheet();
}

function addColumn() {
    if (colWidths.length >= MAX_COLS) {
        return;
    }
    for (let i = 0; i < gridData.length; i++) {
        gridData[i].push({ value: '', type: 'text', align: 'left' });
        cellColors[i].push(null);
    }
    colWidths.push(DEFAULT_COL_WIDTH);
    saveToHistory();
    renderSheet();
}

function deleteRow() {
    if (gridData.length <= 1) {
        return;
    }
    if (confirm("Delete selected row? This action cannot be undone.")) {
        let { minRow } = getSelectedRange();
        gridData.splice(minRow, 1);
        cellColors.splice(minRow, 1);
        rowHeights.splice(minRow, 1);
        if (selectedRow >= gridData.length) selectedRow = gridData.length - 1;
        if (selectionEndRow >= gridData.length) selectionEndRow = gridData.length - 1;
        saveToHistory();
        renderSheet();
    }
}

function deleteColumn() {
    if (colWidths.length <= 1) {
        return;
    }
    if (confirm("Delete selected column? This action cannot be undone.")) {
        let { minCol } = getSelectedRange();
        for (let i = 0; i < gridData.length; i++) {
            gridData[i].splice(minCol, 1);
            cellColors[i].splice(minCol, 1);
        }
        colWidths.splice(minCol, 1);
        if (selectedCol >= colWidths.length) selectedCol = colWidths.length - 1;
        if (selectionEndCol >= colWidths.length) selectionEndCol = colWidths.length - 1;
        saveToHistory();
        renderSheet();
    }
}

function duplicateRow() {
    let { minRow } = getSelectedRange();
    let newRow = JSON.parse(JSON.stringify(gridData[minRow]));
    let newColorRow = JSON.parse(JSON.stringify(cellColors[minRow]));
    gridData.splice(minRow + 1, 0, newRow);
    cellColors.splice(minRow + 1, 0, newColorRow);
    rowHeights.splice(minRow + 1, 0, rowHeights[minRow]);
    saveToHistory();
    renderSheet();
}

function duplicateColumn() {
    let { minCol } = getSelectedRange();
    for (let i = 0; i < gridData.length; i++) {
        gridData[i].splice(minCol + 1, 0, JSON.parse(JSON.stringify(gridData[i][minCol])));
        cellColors[i].splice(minCol + 1, 0, cellColors[i][minCol] ?
            JSON.parse(JSON.stringify(cellColors[i][minCol])) : null);
    }
    colWidths.splice(minCol + 1, 0, colWidths[minCol]);
    saveToHistory();
    renderSheet();
}

function resizeRow() {
    if (!validateCellAccess(selectedRow, 0)) return;
    let newH = prompt('Row height (pixels):', rowHeights[selectedRow]);
    if (newH) {
        let parsedHeight = parseInt(newH);
        if (parsedHeight > 0 && parsedHeight < 500) {
            rowHeights[selectedRow] = parsedHeight;
            renderSheet();
            saveToHistory();
        }
    }
}

function resizeColumn() {
    if (!validateCellAccess(0, selectedCol)) return;
    let newW = prompt('Column width (pixels):', colWidths[selectedCol]);
    if (newW) {
        let parsedWidth = parseInt(newW);
        if (parsedWidth > 20 && parsedWidth < 500) {
            colWidths[selectedCol] = parsedWidth;
            renderSheet();
            saveToHistory();
        }
    }
}

function sortColumn(dir) {
    if (selectedCol !== undefined && validateCellAccess(0, selectedCol)) {
        if (merges.length > 0 && !confirm("Sorting will clear all merged cells due to technical limitations. Continue?")) return;
        activeSort = { col: selectedCol, dir: dir };
        activeFilter = null;
        if (merges.length > 0) merges = [];
        renderSheet();
        saveToHistory();
    }
}

function filterColumn() {
    let cond = prompt('Filter text (cells containing):', '');
    if (cond !== null && cond !== '') {
        // تطهير النص
        cond = sanitizeText(cond);
        if (merges.length > 0 && !confirm("Filtering will clear all merged cells. Continue?")) return;
        activeFilter = { colIndex: selectedCol, condition: cond };
        activeSort = null;
        if (merges.length > 0) merges = [];
        renderSheet();
        updateStatus();
        saveToHistory();
    }
}

function clearFilter() {
    activeFilter = null;
    activeSort = null;
    if (merges.length > 0) {
        merges = [];
    }
    renderSheet();
    updateStatus();
    saveToHistory();
}

function updateStatus() {
    document.getElementById('filterStatus').innerHTML = activeFilter ? `<span class="filter-badge">Filter: ${activeFilter.condition}</span>` : '';
    let { minRow, maxRow, minCol, maxCol } = getSelectedRange();
    let colLetter = String.fromCharCode(65 + (selectedCol % 26));
    if (selectedCol >= 26) colLetter = String.fromCharCode(64 + Math.floor(selectedCol / 26)) + colLetter;
    document.getElementById('cellCoord').innerHTML = `Cell: ${colLetter}${selectedRow + 1}`;
    if (minRow !== maxRow || minCol !== maxCol) {
        let count = (maxRow - minRow + 1) * (maxCol - minCol + 1);
        document.getElementById('selectionRange').innerHTML = `Selected: ${count} cells`;
    } else {
        document.getElementById('selectionRange').innerHTML = '';
    }

    // Show color info
    let cellColor = getCellBgColor(selectedRow, selectedCol);
    let textColor = getCellTextColor(selectedRow, selectedCol);
    let colorInfoText = '';
    if (cellColor) colorInfoText += `BG: ${cellColor} `;
    if (textColor) colorInfoText += `Text: ${textColor}`;
    document.getElementById('colorInfo').innerHTML = colorInfoText;

    let totalCells = gridData.length * colWidths.length;
    document.getElementById('performanceHint').innerHTML = `${gridData.length}x${colWidths.length} (${totalCells} cells)`;
}

function insertIntoSelected(type, defaultValue = '') {
    let { minRow, minCol } = getSelectedRange();
    if (!validateCellAccess(minRow, minCol)) return;
    
    if (type === 'checkbox') {
        gridData[minRow][minCol] = { value: false, type: 'checkbox', align: 'left' };
    } else if (type === 'date') {
        gridData[minRow][minCol] = { value: new Date().toISOString().slice(0, 10), type: 'date', align: 'left' };
    } else if (type === 'number') {
        let val = prompt('Enter a number:', '0');
        if (val !== null) {
            let num = parseFloat(val);
            if (!isNaN(num)) {
                gridData[minRow][minCol] = { value: num, type: 'number', align: 'left' };
            }
        }
    } else if (type === 'link') {
        let url = prompt('Enter link (URL):', 'https://');
        if (url) {
            // التحقق من صحة الرابط
            if (isValidText(url)) {
                let sanitizedUrl = sanitizeText(url);
                // التحقق من أن الرابط آمن (ليس javascript: أو بيانات ضارة)
                if (!/^javascript:/i.test(sanitizedUrl) && !/^data:/i.test(sanitizedUrl)) {
                    gridData[minRow][minCol] = { value: sanitizedUrl, type: 'link', align: 'left' };
                }
            }
        }
    } else {
        let val = prompt('Enter text:', '');
        if (val !== null) {
            if (isValidText(val)) {
                gridData[minRow][minCol] = { value: sanitizeText(val), type: 'text', align: 'left' };
            }
        }
    }
    saveToHistory();
    renderSheet();
}

function searchText() {
    let query = prompt('Search for:', '');
    if (!query) return;
    query = sanitizeText(query);
    let results = [];
    for (let r = 0; r < gridData.length; r++) {
        for (let c = 0; c < colWidths.length; c++) {
            let val = gridData[r][c].value;
            if (val && val.toString().toLowerCase().includes(query.toLowerCase())) {
                results.push([r, c]);
            }
        }
    }
    if (results.length) {
        let [r, c] = results[0];
        selectedRow = r; selectedCol = c;
        selectionEndRow = r; selectionEndCol = c;
        renderSheet();
    }
}

function toggleFullscreen() {
    document.body.classList.toggle('fullscreen');
}

function toggleWordWrap() {
    wordWrapEnabled = !wordWrapEnabled;
    renderSheet();
    document.getElementById('wordWrapBtn').classList.toggle('active', wordWrapEnabled);
}

function toggleRowNumbering() {
    rowNumberingEnabled = !rowNumberingEnabled;
    renderSheet();
    document.getElementById('rowNumberingBtn').classList.toggle('active', rowNumberingEnabled);
}

function exportRETB() {
    let exportData = {
        version: 'RESTUDIO_TABLE_V2',
        grid: gridData,
        rowHeights,
        colWidths,
        merges,
        cellColors: cellColors
    };
    let blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `table_${new Date().toISOString().slice(0,19)}.retb`;
    a.click();
    URL.revokeObjectURL(blob);
}

function importRETB(file) {
    let reader = new FileReader();
    reader.onload = e => {
        try {
            let data = JSON.parse(e.target.result);
            
            // التحقق من صحة الملف
            validateRETBFile(data);
            
            if (data.grid) gridData = data.grid;
            if (data.rowHeights) rowHeights = data.rowHeights;
            if (data.colWidths) colWidths = data.colWidths;
            if (data.merges) merges = data.merges;
            if (data.cellColors) {
                cellColors = data.cellColors;
            } else {
                cellColors = [];
                for (let i = 0; i < gridData.length; i++) {
                    cellColors[i] = new Array(colWidths.length).fill(null);
                }
            }
            while (cellColors.length < gridData.length) {
                cellColors.push(new Array(colWidths.length).fill(null));
            }
            for (let i = 0; i < cellColors.length; i++) {
                while (cellColors[i].length < colWidths.length) {
                    cellColors[i].push(null);
                }
            }
            renderSheet();
            saveToHistory();
        } catch(err) {
            console.error('Import error:', err.message);
            alert(`❌ Import failed: ${err.message}`);
        }
    };
    reader.readAsText(file);
}

function newTable() {
    let hasData = gridData.some(row => row.some(cell => cell.value !== '' && cell.value !== null && cell.value !== false));
    if (hasData && !confirm("Create a new table? All current data will be lost.")) return;
    let rows = parseInt(prompt(`Number of rows (max ${MAX_ROWS}):`, DEFAULT_ROWS) || DEFAULT_ROWS);
    let cols = parseInt(prompt(`Number of columns (max ${MAX_COLS}):`, DEFAULT_COLS) || DEFAULT_COLS);
    if (rows > MAX_ROWS) rows = MAX_ROWS;
    if (cols > MAX_COLS) cols = MAX_COLS;
    resetTable(rows, cols);
}

function renderSheet() {
    const table = document.getElementById('spreadsheet');
    table.innerHTML = '';
    let filteredRows = applyFilterAndSort();
    const thead = document.createElement('thead');
    let headerRow = document.createElement('tr');

    if (rowNumberingEnabled) {
        let th = document.createElement('th');
        th.innerText = '#';
        th.classList.add('row-header');
        th.style.width = '50px';
        headerRow.appendChild(th);
    }
    for (let c = 0; c < colWidths.length; c++) {
        let th = document.createElement('th');
        let colLetter = String.fromCharCode(65 + (c % 26));
        if (c >= 26) colLetter = String.fromCharCode(64 + Math.floor(c / 26)) + colLetter;
        th.innerText = colLetter;
        th.style.width = colWidths[c] + 'px';
        th.setAttribute('data-col', c);
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let idx = 0; idx < filteredRows.length; idx++) {
        let r = filteredRows[idx];
        let tr = document.createElement('tr');
        tr.style.height = rowHeights[r] + 'px';

        if (rowNumberingEnabled) {
            let tdNum = document.createElement('td');
            tdNum.innerText = r + 1;
            tdNum.classList.add('row-header');
            tdNum.style.backgroundColor = '#252525';
            tdNum.style.textAlign = 'center';
            tdNum.style.color = '#f0f0f0';
            tr.appendChild(tdNum);
        }

        for (let c = 0; c < colWidths.length; c++) {
            let merge = isCellMerged(r, c);
            if (merge && !(merge.r === r && merge.c === c)) continue;
            let td = document.createElement('td');
            if (merge) {
                if (merge.rowspan > 1) td.rowSpan = merge.rowspan;
                if (merge.colspan > 1) td.colSpan = merge.colspan;
            }
            td.setAttribute('data-row', r);
            td.setAttribute('data-col', c);
            let cell = gridData[r][c];
            td.style.textAlign = cell.align || 'left';
            if (wordWrapEnabled) td.style.whiteSpace = 'normal';
            else td.style.whiteSpace = 'nowrap';

            // Check if this cell is selected
            let isSelected = (r >= Math.min(selectedRow, selectionEndRow) &&
                              r <= Math.max(selectedRow, selectionEndRow) &&
                              c >= Math.min(selectedCol, selectionEndCol) &&
                              c <= Math.max(selectedCol, selectionEndCol));

            // Apply cell background color
            let cellBgColor = getCellBgColor(r, c);
            let cellTextColor = getCellTextColor(r, c);

            if (isSelected) {
                if (cellBgColor) {
                    td.style.backgroundColor = cellBgColor;
                    td.style.boxShadow = 'inset 0 0 0 1000px rgba(58, 110, 165, 0.5)';
                } else {
                    td.style.backgroundColor = 'var(--selection)';
                    td.style.boxShadow = 'none';
                }
                td.style.outline = '2px solid var(--primary)';
                td.style.outlineOffset = '-1px';
                td.classList.add('selected');
                td.style.color = cellTextColor || '#ffffff';
            } else {
                td.style.backgroundColor = cellBgColor || '#2d2d2d';
                td.style.color = cellTextColor || '#f0f0f0';
                td.style.outline = 'none';
                td.style.boxShadow = 'none';
            }

            if (cell.type === 'checkbox') {
                td.classList.add('checkbox-cell');
                let chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = cell.value === true || cell.value === 'true';
                chk.addEventListener('change', (e) => {
                    e.stopPropagation();
                    updateCellValue(r, c, chk.checked, 'checkbox');
                });
                td.appendChild(chk);
            } else if (cell.type === 'link') {
                td.classList.add('link-cell');
                let link = document.createElement('a');
                link.href = cell.value || '#';
                link.target = '_blank';
                link.innerText = cell.value || 'Link';
                link.onclick = (e) => e.stopPropagation();
                if (cellTextColor) {
                    link.style.color = cellTextColor;
                }
                td.appendChild(link);
            } else {
                td.innerText = cell.value !== undefined && cell.value !== null ? cell.value : '';
            }

            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    attachCellEvents();
    updateStatus();
}

function attachCellEvents() {
    document.querySelectorAll('#spreadsheet tbody td').forEach(td => {
        let row = parseInt(td.getAttribute('data-row'));
        let col = parseInt(td.getAttribute('data-col'));
        if (isNaN(row) || !validateCellAccess(row, col)) return;
        td.onmousedown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'A') return;
            e.preventDefault();
            selectedRow = row;
            selectedCol = col;
            selectionEndRow = row;
            selectionEndCol = col;
            isSelecting = true;
            renderSheet();
            updateStatus();
        };
        td.onmouseenter = () => {
            if (isSelecting && validateCellAccess(row, col)) {
                selectionEndRow = row;
                selectionEndCol = col;
                renderSheet();
                updateStatus();
            }
        };
        td.ondblclick = (e) => {
            if (gridData[row][col].type === 'checkbox') return;
            let currVal = gridData[row][col].value;
            let newVal = prompt('Edit cell value:', currVal);
            if (newVal !== null) {
                if (isValidText(newVal)) {
                    updateCellValue(row, col, sanitizeText(newVal), gridData[row][col].type);
                }
            }
        };
    });
    document.body.onmouseup = () => { isSelecting = false; updateStatus(); };
    document.querySelectorAll('#spreadsheet th').forEach(th => {
        let col = parseInt(th.getAttribute('data-col'));
        if (!isNaN(col) && col >= 0 && col < colWidths.length) {
            th.onclick = (e) => {
                e.stopPropagation();
                selectedRow = 0;
                selectedCol = col;
                selectionEndRow = gridData.length - 1;
                selectionEndCol = col;
                renderSheet();
                updateStatus();
            };
        }
    });
}

function init() {
    resetTable(12, 7);
    gridData[0][0] = { value: 'Product', type: 'text', align: 'center' };
    gridData[0][1] = { value: 'Quantity', type: 'text', align: 'center' };
    gridData[0][2] = { value: 'Price', type: 'text', align: 'center' };
    gridData[1][0] = { value: 'Apples', type: 'text', align: 'left' };
    gridData[1][1] = { value: 50, type: 'number', align: 'right' };
    gridData[1][2] = { value: 2.5, type: 'number', align: 'right' };
    gridData[2][0] = { value: 'Oranges', type: 'text', align: 'left' };
    gridData[2][1] = { value: 30, type: 'number', align: 'right' };
    gridData[2][2] = { value: 3.0, type: 'number', align: 'right' };
    gridData[3][0] = { value: 'Bananas', type: 'text', align: 'left' };
    gridData[3][1] = { value: 20, type: 'number', align: 'right' };
    gridData[3][2] = { value: 1.8, type: 'number', align: 'right' };
    renderSheet();

    // Buttons
    document.getElementById('newTableBtn').onclick = newTable;
    document.getElementById('exportBtn').onclick = exportRETB;
    document.getElementById('undoBtn').onclick = undo;
    document.getElementById('redoBtn').onclick = redo;
    document.getElementById('cutBtn').onclick = cutSelection;
    document.getElementById('copyBtn').onclick = copySelection;
    document.getElementById('pasteBtn').onclick = pasteSelection;
    document.getElementById('deleteContentBtn').onclick = deleteContent;
    document.getElementById('addRowBtn').onclick = addRow;
    document.getElementById('addColBtn').onclick = addColumn;
    document.getElementById('delRowBtn').onclick = deleteRow;
    document.getElementById('delColBtn').onclick = deleteColumn;
    document.getElementById('dupRowBtn').onclick = duplicateRow;
    document.getElementById('dupColBtn').onclick = duplicateColumn;
    document.getElementById('resizeRowBtn').onclick = resizeRow;
    document.getElementById('resizeColBtn').onclick = resizeColumn;
    document.getElementById('minimizeColBtn').onclick = minimizeColumn;
    document.getElementById('sortAscBtn').onclick = () => sortColumn('asc');
    document.getElementById('sortDescBtn').onclick = () => sortColumn('desc');
    document.getElementById('filterBtn').onclick = filterColumn;
    document.getElementById('clearFilterBtn').onclick = clearFilter;
    document.getElementById('mergeCellsBtn').onclick = mergeSelected;
    document.getElementById('unmergeCellsBtn').onclick = unmergeSelected;
    document.getElementById('alignLeftBtn').onclick = () => setAlignment('left');
    document.getElementById('alignCenterBtn').onclick = () => setAlignment('center');
    document.getElementById('alignRightBtn').onclick = () => setAlignment('right');
    document.getElementById('insertTextBtn').onclick = () => insertIntoSelected('text');
    document.getElementById('insertNumberBtn').onclick = () => insertIntoSelected('number');
    document.getElementById('insertCheckboxBtn').onclick = () => insertIntoSelected('checkbox');
    document.getElementById('insertDateBtn').onclick = () => insertIntoSelected('date');
    document.getElementById('insertLinkBtn').onclick = () => insertIntoSelected('link');
    document.getElementById('fullscreenBtn').onclick = toggleFullscreen;
    document.getElementById('exitFullscreenBtn').onclick = toggleFullscreen;
    document.getElementById('searchBtn').onclick = searchText;
    document.getElementById('wordWrapBtn').onclick = toggleWordWrap;
    document.getElementById('rowNumberingBtn').onclick = toggleRowNumbering;
    document.getElementById('rowNumberingBtn').classList.add('active');

    // Cell Color Picker
    document.getElementById('cellColorPicker').oninput = function() {
        applyCellColor(this.value);
    };
    document.getElementById('cellColorPicker').onchange = function() {
        applyCellColor(this.value);
    };
    document.getElementById('cellColorBtn').onclick = function() {
        document.getElementById('cellColorPicker').click();
    };

    // Text Color Picker
    document.getElementById('textColorPicker').oninput = function() {
        applyTextColor(this.value);
    };
    document.getElementById('textColorPicker').onchange = function() {
        applyTextColor(this.value);
    };
    document.getElementById('textColorBtn').onclick = function() {
        document.getElementById('textColorPicker').click();
    };

    // Clear Colors Button
    document.getElementById('clearColorBtn').onclick = clearSelectedColors;

    let importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.retb';
    importInput.style.display = 'none';
    document.body.appendChild(importInput);
    importInput.onchange = () => { if(importInput.files[0]) importRETB(importInput.files[0]); importInput.value = ''; };
    let fakeImportBtn = document.createElement('button');
    fakeImportBtn.className = 'tool-btn';
    fakeImportBtn.innerHTML = '<i class="ti ti-upload"></i> Import .RETB';
    fakeImportBtn.onclick = () => importInput.click();
    document.querySelector('.tool-group:first-child').appendChild(fakeImportBtn);
}

init();
