// ========== SECURITY UTILITIES ==========

function sanitizeText(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);
    
    var map = {
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

function isValidText(text) {
    if (typeof text !== 'string') return false;
    var dangerousPatterns = [
        /javascript:/i,
        /on\w+\s*=/i,
        /<script/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
        /data:text\/html/i,
        /vbscript:/i
    ];
    for (var i = 0; i < dangerousPatterns.length; i++) {
        if (dangerousPatterns[i].test(text)) return false;
    }
    return true;
}

function validateRETBFile(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid file format: Data is not an object');
    }
    
    var MAX_FILE_SIZE_MB = 10;
    var jsonString = JSON.stringify(data);
    var sizeInMB = new Blob([jsonString]).size / (1024 * 1024);
    if (sizeInMB > MAX_FILE_SIZE_MB) {
        throw new Error('File too large: ' + sizeInMB.toFixed(2) + 'MB (max ' + MAX_FILE_SIZE_MB + 'MB)');
    }
    
    if (data.grid && !Array.isArray(data.grid)) {
        throw new Error('Invalid file: Grid must be an array');
    }
    
    var MAX_ROWS_FILE = 1000;
    var MAX_COLS_FILE = 100;
    if (data.grid && data.grid.length > MAX_ROWS_FILE) {
        throw new Error('Too many rows: ' + data.grid.length + ' (max ' + MAX_ROWS_FILE + ')');
    }
    if (data.grid && data.grid.length > 0 && data.grid[0].length > MAX_COLS_FILE) {
        throw new Error('Too many columns: ' + data.grid[0].length + ' (max ' + MAX_COLS_FILE + ')');
    }
    
    if (data.grid) {
        for (var r = 0; r < data.grid.length; r++) {
            if (!Array.isArray(data.grid[r])) {
                throw new Error('Invalid row ' + r + ': Not an array');
            }
            for (var c = 0; c < data.grid[r].length; c++) {
                var cell = data.grid[r][c];
                if (!cell || typeof cell !== 'object') {
                    throw new Error('Invalid cell at [' + r + '][' + c + ']: Not an object');
                }
                if (cell.value !== undefined && typeof cell.value === 'string') {
                    if (!isValidText(cell.value)) {
                        throw new Error('Suspicious content detected in cell [' + r + '][' + c + ']');
                    }
                    data.grid[r][c].value = sanitizeText(cell.value);
                }
                var allowedTypes = ['text', 'number', 'checkbox', 'date', 'link'];
                if (cell.type && allowedTypes.indexOf(cell.type) === -1) {
                    throw new Error('Invalid cell type at [' + r + '][' + c + ']: ' + cell.type);
                }
            }
        }
    }
    
    if (data.colWidths) {
        for (var w = 0; w < data.colWidths.length; w++) {
            if (typeof data.colWidths[w] !== 'number' || data.colWidths[w] < 20 || data.colWidths[w] > 500) {
                throw new Error('Invalid column width: ' + data.colWidths[w] + ' (must be between 20-500)');
            }
        }
    }
    
    return true;
}

function validateCellAccess(row, col) {
    if (row < 0 || row >= gridData.length) return false;
    if (col < 0 || col >= colWidths.length) return false;
    return true;
}

// ========== DATA MODEL ==========
var gridData = [];
var rowHeights = [];
var colWidths = [];
var merges = [];
var activeFilter = null;
var activeSort = null;
var rowNumberingEnabled = true;
var wordWrapEnabled = false;
var cellColors = [];
var selectedRow = 0, selectedCol = 0;
var selectionEndRow = 0, selectionEndCol = 0;
var isSelecting = false;
var historyStack = [];
var historyIndex = -1;
var clipboardData = null;

var DEFAULT_ROWS = 15;
var DEFAULT_COLS = 8;
var DEFAULT_ROW_HEIGHT = 32;
var DEFAULT_COL_WIDTH = 100;
var MAX_ROWS = 800;
var MAX_COLS = 80;

function initEmptyGrid(rows, cols) {
    var newGrid = [];
    var newColors = [];
    for (var i = 0; i < rows; i++) {
        newGrid[i] = [];
        newColors[i] = [];
        for (var j = 0; j < cols; j++) {
            newGrid[i][j] = { value: '', type: 'text', align: 'left' };
            newColors[i][j] = null;
        }
    }
    return { grid: newGrid, colors: newColors };
}

function resetTable(rows, cols) {
    rows = rows || DEFAULT_ROWS;
    cols = cols || DEFAULT_COLS;
    rows = Math.min(rows, MAX_ROWS);
    cols = Math.min(cols, MAX_COLS);
    if (rows < 1) rows = 1;
    if (cols < 1) cols = 1;

    var result = initEmptyGrid(rows, cols);
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
    var state = JSON.parse(JSON.stringify({
        grid: gridData,
        rowHeights: rowHeights,
        colWidths: colWidths,
        merges: merges,
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
    for (var i = 0; i < cellColors.length; i++) {
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
    for (var m = 0; m < merges.length; m++) {
        var merge = merges[m];
        if (row >= merge.r && row < merge.r + merge.rowspan && col >= merge.c && col < merge.c + merge.colspan) {
            return merge;
        }
    }
    return null;
}

function applyFilterAndSort() {
    var rows = [];
    for (var i = 0; i < gridData.length; i++) rows.push(i);
    if (activeFilter) {
        rows = rows.filter(function(rowIdx) {
            var val = getCellRawValue(rowIdx, activeFilter.colIndex);
            if (!val && val !== 0) return false;
            return val.toString().toLowerCase().indexOf(activeFilter.condition.toLowerCase()) !== -1;
        });
    }
    if (activeSort) {
        rows.sort(function(a, b) {
            var valA = getCellRawValue(a, activeSort.col);
            var valB = getCellRawValue(b, activeSort.col);
            if (typeof valA === 'number' && typeof valB === 'number') {
                return activeSort.dir === 'asc' ? valA - valB : valB - valA;
            }
            var strA = String(valA || '').toLowerCase();
            var strB = String(valB || '').toLowerCase();
            return activeSort.dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
    }
    return rows;
}

function getCellRawValue(row, col) {
    if (!validateCellAccess(row, col)) return '';
    if (!gridData[row] || !gridData[row][col]) return '';
    var cell = gridData[row][col];
    if (cell.type === 'checkbox') return cell.value ? 'true' : 'false';
    return cell.value;
}

function updateCellValue(row, col, newValue, newType) {
    if (!validateCellAccess(row, col)) return;
    var old = gridData[row][col];
    var type = newType || old.type;
    var align = old.align || 'left';
    var value = newValue;
    if (type === 'text' || type === 'link') {
        if (typeof value === 'string') {
            if (!isValidText(value)) return;
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

function minimizeColumn() {
    if (selectedCol === undefined || selectedCol < 0 || !validateCellAccess(0, selectedCol)) return;
    var currentWidth = colWidths[selectedCol];
    var newW = prompt('Minimize column width (pixels):', currentWidth);
    if (newW !== null && newW !== '') {
        var parsedWidth = parseInt(newW);
        if (isNaN(parsedWidth) || parsedWidth < 10) return;
        var range = getSelectedRange();
        for (var c = range.minCol; c <= range.maxCol; c++) {
            if (c >= 0 && c < colWidths.length) colWidths[c] = parsedWidth;
        }
        saveToHistory();
        renderSheet();
    }
}

function applyCellColor(color) {
    var range = getSelectedRange();
    for (var r = range.minRow; r <= range.maxRow; r++) {
        for (var c = range.minCol; c <= range.maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) {
                if (!cellColors[r][c]) cellColors[r][c] = { bg: null, text: null };
                cellColors[r][c].bg = color;
            }
        }
    }
    saveToHistory();
    renderSheet();
    updateStatus();
}

function applyTextColor(color) {
    var range = getSelectedRange();
    for (var r = range.minRow; r <= range.maxRow; r++) {
        for (var c = range.minCol; c <= range.maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) {
                if (!cellColors[r][c]) cellColors[r][c] = { bg: null, text: null };
                cellColors[r][c].text = color;
            }
        }
    }
    saveToHistory();
    renderSheet();
    updateStatus();
}

function clearSelectedColors() {
    var range = getSelectedRange();
    for (var r = range.minRow; r <= range.maxRow; r++) {
        for (var c = range.minCol; c <= range.maxCol; c++) {
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
    if (cellColors[row] && cellColors[row][col]) return cellColors[row][col];
    return null;
}

function getCellBgColor(row, col) {
    var color = getCellColor(row, col);
    return color ? color.bg : null;
}

function getCellTextColor(row, col) {
    var color = getCellColor(row, col);
    return color ? color.text : null;
}

function mergeSelected() {
    if (selectedRow === undefined || selectedCol === undefined || !validateCellAccess(selectedRow, selectedCol)) return;
    var minRow = Math.min(selectedRow, selectionEndRow);
    var maxRow = Math.max(selectedRow, selectionEndRow);
    var minCol = Math.min(selectedCol, selectionEndCol);
    var maxCol = Math.max(selectedCol, selectionEndCol);
    if (minRow === maxRow && minCol === maxCol) return;
    if (!confirm("Warning: Merging cells will keep only the content of the top-left cell. All other data in the selected range will be lost. Do you want to continue?")) return;

    merges = merges.filter(function(m) {
        var mEndRow = m.r + m.rowspan - 1;
        var mEndCol = m.c + m.colspan - 1;
        return !(m.r <= maxRow && mEndRow >= minRow && m.c <= maxCol && mEndCol >= minCol);
    });

    merges.push({ r: minRow, c: minCol, rowspan: maxRow - minRow + 1, colspan: maxCol - minCol + 1 });
    var mainValue = gridData[minRow][minCol].value;
    var mainType = gridData[minRow][minCol].type;
    var mainAlign = gridData[minRow][minCol].align;
    var mainColors = cellColors[minRow] && cellColors[minRow][minCol] ? JSON.parse(JSON.stringify(cellColors[minRow][minCol])) : null;

    for (var r = minRow; r <= maxRow; r++) {
        for (var c = minCol; c <= maxCol; c++) {
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
    if (selectedRow === undefined || selectedCol === undefined || !validateCellAccess(selectedRow, selectedCol)) return;
    var foundMerge = null;
    for (var m = 0; m < merges.length; m++) {
        var merge = merges[m];
        if (selectedRow >= merge.r && selectedRow < merge.r + merge.rowspan &&
            selectedCol >= merge.c && selectedCol < merge.c + merge.colspan) {
            foundMerge = merge;
            break;
        }
    }
    if (foundMerge) {
        merges = merges.filter(function(m) { return m !== foundMerge; });
        var mainValue = gridData[foundMerge.r][foundMerge.c].value;
        var mainType = gridData[foundMerge.r][foundMerge.c].type;
        var mainColors = cellColors[foundMerge.r] && cellColors[foundMerge.r][foundMerge.c] ? JSON.parse(JSON.stringify(cellColors[foundMerge.r][foundMerge.c])) : null;

        for (var r = foundMerge.r; r < foundMerge.r + foundMerge.rowspan; r++) {
            for (var c = foundMerge.c; c < foundMerge.c + foundMerge.colspan; c++) {
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
    var minRow = Math.max(0, Math.min(selectedRow, selectionEndRow));
    var maxRow = Math.min(gridData.length - 1, Math.max(selectedRow, selectionEndRow));
    var minCol = Math.max(0, Math.min(selectedCol, selectionEndCol));
    var maxCol = Math.min(colWidths.length - 1, Math.max(selectedCol, selectionEndCol));
    return { minRow: minRow, maxRow: maxRow, minCol: minCol, maxCol: maxCol };
}

function applyToSelectedRange(callback) {
    var range = getSelectedRange();
    for (var r = range.minRow; r <= range.maxRow; r++) {
        for (var c = range.minCol; c <= range.maxCol; c++) {
            if (validateCellAccess(r, c) && gridData[r] && gridData[r][c]) callback(r, c);
        }
    }
    saveToHistory();
    renderSheet();
}

function setAlignment(align) {
    applyToSelectedRange(function(r, c) { gridData[r][c].align = align; });
}

function deleteContent() {
    if (confirm("Delete content of selected cells? This cannot be undone.")) {
        applyToSelectedRange(function(r, c) {
            gridData[r][c].value = '';
            gridData[r][c].type = 'text';
            cellColors[r][c] = null;
        });
    }
}

function copySelection() {
    var range = getSelectedRange();
    clipboardData = [];
    for (var r = range.minRow; r <= range.maxRow; r++) {
        var rowData = [];
        for (var c = range.minCol; c <= range.maxCol; c++) {
            rowData.push({
                cell: JSON.parse(JSON.stringify(gridData[r][c])),
                colors: cellColors[r] && cellColors[r][c] ? JSON.parse(JSON.stringify(cellColors[r][c])) : null
            });
        }
        clipboardData.push(rowData);
    }
}

function cutSelection() { copySelection(); deleteContent(); }

function pasteSelection() {
    if (!clipboardData) return;
    var range = getSelectedRange();
    for (var i = 0; i < clipboardData.length && range.minRow + i < gridData.length; i++) {
        for (var j = 0; j < clipboardData[0].length && range.minCol + j < colWidths.length; j++) {
            var pasteItem = clipboardData[i][j];
            gridData[range.minRow + i][range.minCol + j] = JSON.parse(JSON.stringify(pasteItem.cell));
            cellColors[range.minRow + i][range.minCol + j] = pasteItem.colors ? JSON.parse(JSON.stringify(pasteItem.colors)) : null;
        }
    }
    saveToHistory();
    renderSheet();
}

function addRow() {
    if (gridData.length >= MAX_ROWS) return;
    var newRow = [], newColorRow = [];
    for (var j = 0; j < colWidths.length; j++) {
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
    if (colWidths.length >= MAX_COLS) return;
    for (var i = 0; i < gridData.length; i++) {
        gridData[i].push({ value: '', type: 'text', align: 'left' });
        cellColors[i].push(null);
    }
    colWidths.push(DEFAULT_COL_WIDTH);
    saveToHistory();
    renderSheet();
}

function deleteRow() {
    if (gridData.length <= 1) return;
    if (confirm("Delete selected row? This action cannot be undone.")) {
        var range = getSelectedRange();
        gridData.splice(range.minRow, 1);
        cellColors.splice(range.minRow, 1);
        rowHeights.splice(range.minRow, 1);
        if (selectedRow >= gridData.length) selectedRow = gridData.length - 1;
        if (selectionEndRow >= gridData.length) selectionEndRow = gridData.length - 1;
        saveToHistory();
        renderSheet();
    }
}

function deleteColumn() {
    if (colWidths.length <= 1) return;
    if (confirm("Delete selected column? This action cannot be undone.")) {
        var range = getSelectedRange();
        for (var i = 0; i < gridData.length; i++) {
            gridData[i].splice(range.minCol, 1);
            cellColors[i].splice(range.minCol, 1);
        }
        colWidths.splice(range.minCol, 1);
        if (selectedCol >= colWidths.length) selectedCol = colWidths.length - 1;
        if (selectionEndCol >= colWidths.length) selectionEndCol = colWidths.length - 1;
        saveToHistory();
        renderSheet();
    }
}

function duplicateRow() {
    var range = getSelectedRange();
    var newRow = JSON.parse(JSON.stringify(gridData[range.minRow]));
    var newColorRow = JSON.parse(JSON.stringify(cellColors[range.minRow]));
    gridData.splice(range.minRow + 1, 0, newRow);
    cellColors.splice(range.minRow + 1, 0, newColorRow);
    rowHeights.splice(range.minRow + 1, 0, rowHeights[range.minRow]);
    saveToHistory();
    renderSheet();
}

function duplicateColumn() {
    var range = getSelectedRange();
    for (var i = 0; i < gridData.length; i++) {
        gridData[i].splice(range.minCol + 1, 0, JSON.parse(JSON.stringify(gridData[i][range.minCol])));
        cellColors[i].splice(range.minCol + 1, 0, cellColors[i][range.minCol] ? JSON.parse(JSON.stringify(cellColors[i][range.minCol])) : null);
    }
    colWidths.splice(range.minCol + 1, 0, colWidths[range.minCol]);
    saveToHistory();
    renderSheet();
}

function resizeRow() {
    if (!validateCellAccess(selectedRow, 0)) return;
    var newH = prompt('Row height (pixels):', rowHeights[selectedRow]);
    if (newH) {
        var parsedHeight = parseInt(newH);
        if (parsedHeight > 0 && parsedHeight < 500) {
            rowHeights[selectedRow] = parsedHeight;
            renderSheet();
            saveToHistory();
        }
    }
}

function resizeColumn() {
    if (!validateCellAccess(0, selectedCol)) return;
    var newW = prompt('Column width (pixels):', colWidths[selectedCol]);
    if (newW) {
        var parsedWidth = parseInt(newW);
        if (parsedWidth > 20 && parsedWidth < 500) {
            colWidths[selectedCol] = parsedWidth;
            renderSheet();
            saveToHistory();
        }
    }
}

function sortColumn(dir) {
    if (selectedCol !== undefined && validateCellAccess(0, selectedCol)) {
        if (merges.length > 0 && !confirm("Sorting will clear all merged cells. Continue?")) return;
        activeSort = { col: selectedCol, dir: dir };
        activeFilter = null;
        if (merges.length > 0) merges = [];
        renderSheet();
        saveToHistory();
    }
}

function filterColumn() {
    var cond = prompt('Filter text (cells containing):', '');
    if (cond !== null && cond !== '') {
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
    if (merges.length > 0) merges = [];
    renderSheet();
    updateStatus();
    saveToHistory();
}

function updateStatus() {
    document.getElementById('filterStatus').innerHTML = activeFilter ? '<span class="filter-badge">Filter: ' + activeFilter.condition + '</span>' : '';
    var range = getSelectedRange();
    var colLetter = String.fromCharCode(65 + (selectedCol % 26));
    if (selectedCol >= 26) colLetter = String.fromCharCode(64 + Math.floor(selectedCol / 26)) + colLetter;
    document.getElementById('cellCoord').innerHTML = 'Cell: ' + colLetter + (selectedRow + 1);
    if (range.minRow !== range.maxRow || range.minCol !== range.maxCol) {
        var count = (range.maxRow - range.minRow + 1) * (range.maxCol - range.minCol + 1);
        document.getElementById('selectionRange').innerHTML = 'Selected: ' + count + ' cells';
    } else {
        document.getElementById('selectionRange').innerHTML = '';
    }
    var cellColor = getCellBgColor(selectedRow, selectedCol);
    var textColor = getCellTextColor(selectedRow, selectedCol);
    var colorInfoText = '';
    if (cellColor) colorInfoText += 'BG: ' + cellColor + ' ';
    if (textColor) colorInfoText += 'Text: ' + textColor;
    document.getElementById('colorInfo').innerHTML = colorInfoText;
    var totalCells = gridData.length * colWidths.length;
    document.getElementById('performanceHint').innerHTML = gridData.length + 'x' + colWidths.length + ' (' + totalCells + ' cells)';
}

function insertIntoSelected(type) {
    var range = getSelectedRange();
    if (!validateCellAccess(range.minRow, range.minCol)) return;
    if (type === 'checkbox') {
        gridData[range.minRow][range.minCol] = { value: false, type: 'checkbox', align: 'left' };
    } else if (type === 'date') {
        gridData[range.minRow][range.minCol] = { value: new Date().toISOString().slice(0, 10), type: 'date', align: 'left' };
    } else if (type === 'number') {
        var val = prompt('Enter a number:', '0');
        if (val !== null) {
            var num = parseFloat(val);
            if (!isNaN(num)) gridData[range.minRow][range.minCol] = { value: num, type: 'number', align: 'left' };
        }
    } else if (type === 'link') {
        var url = prompt('Enter link (URL):', 'https://');
        if (url && isValidText(url) && !/^javascript:/i.test(url) && !/^data:/i.test(url)) {
            gridData[range.minRow][range.minCol] = { value: sanitizeText(url), type: 'link', align: 'left' };
        }
    } else {
        var val = prompt('Enter text:', '');
        if (val !== null && isValidText(val)) {
            gridData[range.minRow][range.minCol] = { value: sanitizeText(val), type: 'text', align: 'left' };
        }
    }
    saveToHistory();
    renderSheet();
}

function searchText() {
    var query = prompt('Search for:', '');
    if (!query) return;
    query = sanitizeText(query);
    var results = [];
    for (var r = 0; r < gridData.length; r++) {
        for (var c = 0; c < colWidths.length; c++) {
            var val = gridData[r][c].value;
            if (val && val.toString().toLowerCase().indexOf(query.toLowerCase()) !== -1) results.push([r, c]);
        }
    }
    if (results.length) {
        var result = results[0];
        selectedRow = result[0]; selectedCol = result[1];
        selectionEndRow = result[0]; selectionEndCol = result[1];
        renderSheet();
    }
}

function toggleFullscreen() { document.body.classList.toggle('fullscreen'); }
function toggleWordWrap() { wordWrapEnabled = !wordWrapEnabled; renderSheet(); document.getElementById('wordWrapBtn').classList.toggle('active', wordWrapEnabled); }
function toggleRowNumbering() { rowNumberingEnabled = !rowNumberingEnabled; renderSheet(); document.getElementById('rowNumberingBtn').classList.toggle('active', rowNumberingEnabled); }

function exportRETB() {
    var exportData = { version: 'RESTUDIO_TABLE_V2', grid: gridData, rowHeights: rowHeights, colWidths: colWidths, merges: merges, cellColors: cellColors };
    var blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'table_' + new Date().toISOString().slice(0, 19) + '.retb';
    a.click();
    URL.revokeObjectURL(blob);
}

function importRETB(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            validateRETBFile(data);
            if (data.grid) gridData = data.grid;
            if (data.rowHeights) rowHeights = data.rowHeights;
            if (data.colWidths) colWidths = data.colWidths;
            if (data.merges) merges = data.merges;
            if (data.cellColors) {
                cellColors = data.cellColors;
            } else {
                cellColors = [];
                for (var i = 0; i < gridData.length; i++) cellColors[i] = new Array(colWidths.length).fill(null);
            }
            while (cellColors.length < gridData.length) cellColors.push(new Array(colWidths.length).fill(null));
            for (var i = 0; i < cellColors.length; i++) {
                while (cellColors[i].length < colWidths.length) cellColors[i].push(null);
            }
            renderSheet();
            saveToHistory();
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function newTable() {
    var hasData = gridData.some(function(row) { return row.some(function(cell) { return cell.value !== '' && cell.value !== null && cell.value !== false; }); });
    if (hasData && !confirm("Create a new table? All current data will be lost.")) return;
    var rows = parseInt(prompt('Number of rows (max ' + MAX_ROWS + '):', DEFAULT_ROWS) || DEFAULT_ROWS);
    var cols = parseInt(prompt('Number of columns (max ' + MAX_COLS + '):', DEFAULT_COLS) || DEFAULT_COLS);
    if (rows > MAX_ROWS) rows = MAX_ROWS;
    if (cols > MAX_COLS) cols = MAX_COLS;
    resetTable(rows, cols);
}

function renderSheet() {
    var table = document.getElementById('spreadsheet');
    table.innerHTML = '';
    var filteredRows = applyFilterAndSort();
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');

    if (rowNumberingEnabled) {
        var th = document.createElement('th');
        th.innerText = '#';
        th.classList.add('row-header');
        th.style.width = '50px';
        headerRow.appendChild(th);
    }
    for (var c = 0; c < colWidths.length; c++) {
        var th = document.createElement('th');
        var colLetter = String.fromCharCode(65 + (c % 26));
        if (c >= 26) colLetter = String.fromCharCode(64 + Math.floor(c / 26)) + colLetter;
        th.innerText = colLetter;
        th.style.width = colWidths[c] + 'px';
        th.setAttribute('data-col', c);
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var idx = 0; idx < filteredRows.length; idx++) {
        var r = filteredRows[idx];
        var tr = document.createElement('tr');
        tr.style.height = rowHeights[r] + 'px';

        if (rowNumberingEnabled) {
            var tdNum = document.createElement('td');
            tdNum.innerText = r + 1;
            tdNum.classList.add('row-header');
            tdNum.style.backgroundColor = '#252525';
            tdNum.style.textAlign = 'center';
            tdNum.style.color = '#f0f0f0';
            tr.appendChild(tdNum);
        }

        for (var c = 0; c < colWidths.length; c++) {
            var merge = isCellMerged(r, c);
            if (merge && !(merge.r === r && merge.c === c)) continue;
            var td = document.createElement('td');
            if (merge) {
                if (merge.rowspan > 1) td.rowSpan = merge.rowspan;
                if (merge.colspan > 1) td.colSpan = merge.colspan;
            }
            td.setAttribute('data-row', r);
            td.setAttribute('data-col', c);
            var cell = gridData[r][c];
            td.style.textAlign = cell.align || 'left';
            if (wordWrapEnabled) td.style.whiteSpace = 'normal';
            else td.style.whiteSpace = 'nowrap';

            var isSelected = (r >= Math.min(selectedRow, selectionEndRow) &&
                              r <= Math.max(selectedRow, selectionEndRow) &&
                              c >= Math.min(selectedCol, selectionEndCol) &&
                              c <= Math.max(selectedCol, selectionEndCol));

            var cellBgColor = getCellBgColor(r, c);
            var cellTextColor = getCellTextColor(r, c);

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
                var chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = cell.value === true || cell.value === 'true';
                chk.addEventListener('change', function(r, c) {
                    return function(e) {
                        e.stopPropagation();
                        updateCellValue(r, c, chk.checked, 'checkbox');
                    };
                }(r, c));
                td.appendChild(chk);
            } else if (cell.type === 'link') {
                td.classList.add('link-cell');
                var link = document.createElement('a');
                link.href = cell.value || '#';
                link.target = '_blank';
                link.innerText = cell.value || 'Link';
                link.onclick = function(e) { e.stopPropagation(); };
                if (cellTextColor) link.style.color = cellTextColor;
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
    var tds = document.querySelectorAll('#spreadsheet tbody td');
    for (var i = 0; i < tds.length; i++) {
        var td = tds[i];
        var row = parseInt(td.getAttribute('data-row'));
        var col = parseInt(td.getAttribute('data-col'));
        if (isNaN(row) || !validateCellAccess(row, col)) continue;
        td.onmousedown = function(r, c) {
            return function(e) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'A') return;
                e.preventDefault();
                selectedRow = r; selectedCol = c;
                selectionEndRow = r; selectionEndCol = c;
                isSelecting = true;
                renderSheet();
                updateStatus();
            };
        }(row, col);
        td.onmouseenter = function(r, c) {
            return function() {
                if (isSelecting && validateCellAccess(r, c)) {
                    selectionEndRow = r; selectionEndCol = c;
                    renderSheet();
                    updateStatus();
                }
            };
        }(row, col);
        td.ondblclick = function(r, c) {
            return function(e) {
                if (gridData[r][c].type === 'checkbox') return;
                var currVal = gridData[r][c].value;
                var newVal = prompt('Edit cell value:', currVal);
                if (newVal !== null && isValidText(newVal)) {
                    updateCellValue(r, c, sanitizeText(newVal), gridData[r][c].type);
                }
            };
        }(row, col);
    }
    document.body.onmouseup = function() { isSelecting = false; updateStatus(); };
    var headers = document.querySelectorAll('#spreadsheet th');
    for (var h = 0; h < headers.length; h++) {
        var th = headers[h];
        var col = parseInt(th.getAttribute('data-col'));
        if (!isNaN(col) && col >= 0 && col < colWidths.length) {
            th.onclick = function(c) {
                return function(e) {
                    e.stopPropagation();
                    selectedRow = 0; selectedCol = c;
                    selectionEndRow = gridData.length - 1; selectionEndCol = c;
                    renderSheet();
                    updateStatus();
                };
            }(col);
        }
    }
}

// ========== KEYBOARD SHORTCUTS (المصلحة) ==========
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // تجاهل إذا كان التركيز على حقل إدخال نصي (لتجنب التعارض مع الكتابة)
        var tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            return;
        }

        // Ctrl+Z - Undo
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
            return;
        }
        // Ctrl+Y - Redo
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redo();
            return;
        }
        // Delete - Delete content
        if (e.key === 'Delete' && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            deleteContent();
            return;
        }
        // Escape - (اختياري)
        if (e.key === 'Escape') {
            // يمكن إضافة أي منطق هنا إذا لزم الأمر
        }
    });
}

// ========== INIT ==========
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
    document.getElementById('sortAscBtn').onclick = function() { sortColumn('asc'); };
    document.getElementById('sortDescBtn').onclick = function() { sortColumn('desc'); };
    document.getElementById('filterBtn').onclick = filterColumn;
    document.getElementById('clearFilterBtn').onclick = clearFilter;
    document.getElementById('mergeCellsBtn').onclick = mergeSelected;
    document.getElementById('unmergeCellsBtn').onclick = unmergeSelected;
    document.getElementById('alignLeftBtn').onclick = function() { setAlignment('left'); };
    document.getElementById('alignCenterBtn').onclick = function() { setAlignment('center'); };
    document.getElementById('alignRightBtn').onclick = function() { setAlignment('right'); };
    document.getElementById('insertTextBtn').onclick = function() { insertIntoSelected('text'); };
    document.getElementById('insertNumberBtn').onclick = function() { insertIntoSelected('number'); };
    document.getElementById('insertCheckboxBtn').onclick = function() { insertIntoSelected('checkbox'); };
    document.getElementById('insertDateBtn').onclick = function() { insertIntoSelected('date'); };
    document.getElementById('insertLinkBtn').onclick = function() { insertIntoSelected('link'); };
    document.getElementById('fullscreenBtn').onclick = toggleFullscreen;
    document.getElementById('exitFullscreenBtn').onclick = toggleFullscreen;
    document.getElementById('searchBtn').onclick = searchText;
    document.getElementById('wordWrapBtn').onclick = toggleWordWrap;
    document.getElementById('rowNumberingBtn').onclick = toggleRowNumbering;
    document.getElementById('rowNumberingBtn').classList.add('active');

    document.getElementById('cellColorPicker').oninput = function() { applyCellColor(this.value); };
    document.getElementById('cellColorPicker').onchange = function() { applyCellColor(this.value); };
    document.getElementById('cellColorBtn').onclick = function() { document.getElementById('cellColorPicker').click(); };

    document.getElementById('textColorPicker').oninput = function() { applyTextColor(this.value); };
    document.getElementById('textColorPicker').onchange = function() { applyTextColor(this.value); };
    document.getElementById('textColorBtn').onclick = function() { document.getElementById('textColorPicker').click(); };

    document.getElementById('clearColorBtn').onclick = clearSelectedColors;

    var importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.retb';
    importInput.style.display = 'none';
    document.body.appendChild(importInput);
    importInput.onchange = function() { if (importInput.files[0]) importRETB(importInput.files[0]); importInput.value = ''; };
    var fakeImportBtn = document.createElement('button');
    fakeImportBtn.className = 'tool-btn';
    fakeImportBtn.innerHTML = '<i class="ti ti-upload"></i> Import .RETB';
    fakeImportBtn.onclick = function() { importInput.click(); };
    document.querySelector('.tool-group:first-child').appendChild(fakeImportBtn);

    // إعداد الاختصارات
    setupKeyboardShortcuts();
}

init();
