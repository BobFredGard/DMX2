const { app, BrowserWindow, ipcMain, session, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

app.commandLine.appendSwitch('enable-features', 'WebMidi');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

const { setECoreAffinity, setGPUProcessAffinity } = require('./cpu-affinity');
setECoreAffinity();

let mainWindow;
let serialPort = null;
let parser = null;
let currentFilePath = null;
let recentFiles = [];

const RECENT_MAX = 10;
const APP_NAME = 'LumiDMX';
const FILE_EXT = 'lum';

function loadRecentFiles() {
    try {
        const stored = localStorage?.getItem?.('dmx2_recent');
        if (stored) recentFiles = JSON.parse(stored);
    } catch (e) {
        const dataPath = path.join(app.getPath('userData'), 'recent.json');
        try { recentFiles = JSON.parse(fs.readFileSync(dataPath, 'utf-8')); } catch (e2) { recentFiles = []; }
    }
}

function saveRecentFiles() {
    const dataPath = path.join(app.getPath('userData'), 'recent.json');
    try { fs.writeFileSync(dataPath, JSON.stringify(recentFiles, null, 2)); } catch (e) {}
}

function addRecentFile(filePath) {
    recentFiles = recentFiles.filter(f => f !== filePath);
    recentFiles.unshift(filePath);
    if (recentFiles.length > RECENT_MAX) recentFiles = recentFiles.slice(0, RECENT_MAX);
    saveRecentFiles();
    updateMenu();
}

function updateMenu() {
    const menuTemplate = buildMenuTemplate();
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

function createWindow() {
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        return true;
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
    });

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        title: APP_NAME,
        backgroundColor: '#050505',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    loadRecentFiles();
    updateMenu();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function buildMenuTemplate() {
    const recentSubmenu = recentFiles.length > 0
        ? recentFiles.map((filePath, i) => ({
            label: `${i + 1}. ${path.basename(filePath)}`,
            click: () => handleOpenFile(filePath)
        }))
        : [{ label: 'Aucun récent', enabled: false }];

    return [
        {
            label: 'Fichier',
            submenu: [
                {
                    label: 'Nouveau',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => { currentFilePath = null; mainWindow.webContents.send('menu:new-set'); mainWindow.title = APP_NAME; }
                },
                { type: 'separator' },
                {
                    label: 'Ouvrir...',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => handleOpenDialog()
                },
                {
                    label: 'Récents',
                    submenu: recentSubmenu
                },
                { type: 'separator' },
                {
                    label: 'Enregistrer',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => handleSave()
                },
                {
                    label: 'Enregistrer sous...',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => handleSaveAs()
                },
                { type: 'separator' },
                {
                    label: 'Imprimer (PDF)...',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => handlePrintPDF()
                },
                { type: 'separator' },
                { label: 'Quitter', role: 'quit' }
            ]
        },
        {
            label: 'Édition',
            submenu: [
                { role: 'undo', label: 'Annuler' },
                { role: 'redo', label: 'Rétablir' },
                { type: 'separator' },
                { role: 'cut', label: 'Couper' },
                { role: 'copy', label: 'Copier' },
                { role: 'paste', label: 'Coller' },
                { role: 'selectAll', label: 'Tout sélectionner' },
                { type: 'separator' },
                {
                    label: 'Copier l\'état',
                    accelerator: 'CmdOrCtrl+Shift+C',
                    click: () => mainWindow.webContents.send('menu:copy')
                },
                {
                    label: 'Coller l\'état',
                    accelerator: 'CmdOrCtrl+Shift+V',
                    click: () => mainWindow.webContents.send('menu:paste')
                }
            ]
        },
        {
            label: 'Options',
            submenu: [
                {
                    label: 'Configurer les ports...',
                    click: () => mainWindow.webContents.send('menu:options')
                },
                {
                    label: 'Gérer les profils...',
                    click: () => mainWindow.webContents.send('menu:profiles')
                }
            ]
        },
        {
            label: 'Affichage',
            submenu: [
                { label: 'Rafraîchir', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: 'Outils de développement', accelerator: 'F12', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: 'Zoom avant', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
                { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
                { label: 'Réinitialiser le zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
                { type: 'separator' },
                { label: 'Plein écran', accelerator: 'F11', role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Aide',
            submenu: [
                {
                    label: 'Raccourcis et aide',
                    accelerator: 'CmdOrCtrl+/',
                    click: () => mainWindow.webContents.send('menu:show-help')
                }
            ]
        }
    ];
}

// ============================================
// SERIAL PORT MANAGEMENT
// ============================================

ipcMain.handle('serial:list-ports', async () => {
    try {
        const ports = await SerialPort.list();
        return ports.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer || '',
            vendorId: p.vendorId || '',
            productId: p.productId || ''
        }));
    } catch (err) {
        console.error('Error listing ports:', err.message);
        return [];
    }
});

ipcMain.handle('serial:connect', async (event, portPath, baudRate = 115200) => {
    try {
        if (serialPort && serialPort.isOpen) {
            serialPort.close();
        }

        serialPort = new SerialPort({
            path: portPath,
            baudRate: baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        });

        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

        parser.on('data', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('serial:data', data.toString());
            }
        });

        serialPort.on('open', () => {
            console.log('Serial port opened:', portPath);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('serial:connected', portPath);
            }
        });

        serialPort.on('close', () => {
            console.log('Serial port closed');
            serialPort = null;
            parser = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('serial:disconnected');
            }
        });

        serialPort.on('error', (err) => {
            console.error('Serial port error:', err.message);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('serial:error', err.message);
            }
        });

        return { success: true };
    } catch (err) {
        console.error('Connection error:', err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('serial:disconnect', async () => {
    disconnectSerial();
    return { success: true };
});

ipcMain.handle('serial:is-connected', async () => {
    return serialPort !== null && serialPort.isOpen;
});

// ============================================
// DMX DATA TRANSMISSION
// ============================================

// Protocol: FF 00 [NB_H] [NB_L] [CH1..CHn] [CHECKSUM]
// Checksum = XOR of all data bytes (NB_H, NB_L, CH1..CHn)
ipcMain.handle('dmx:send', async (event, channels) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        const nb = channels.length;
        const nbH = (nb >> 8) & 0xFF;
        const nbL = nb & 0xFF;

        const packet = Buffer.alloc(4 + nb + 1);
        packet[0] = 0xFF;
        packet[1] = 0x00;
        packet[2] = nbH;
        packet[3] = nbL;

        let checksum = nbH ^ nbL;
        for (let i = 0; i < nb; i++) {
            packet[4 + i] = (channels[i] || 0) & 0xFF;
            checksum ^= (channels[i] || 0) & 0xFF;
        }
        packet[4 + nb] = checksum;

        serialPort.write(packet);
        return { success: true };
    } catch (err) {
        console.error('DMX send error:', err.message);
        return { success: false, error: err.message };
    }
});

// Send single channel update (lighter protocol)
// Protocol: FE [CH_H] [CH_L] [VALUE] [CHECKSUM]
ipcMain.handle('dmx:send-single', async (event, channel, value) => {
    if (!serialPort || !serialPort.isOpen) {
        return { success: false, error: 'Not connected' };
    }

    try {
        const chH = (channel >> 8) & 0xFF;
        const chL = channel & 0xFF;
        const val = value & 0xFF;
        const checksum = chH ^ chL ^ val;

        const packet = Buffer.from([0xFE, chH, chL, val, checksum]);
        serialPort.write(packet);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function disconnectSerial() {
    if (serialPort && serialPort.isOpen) {
        serialPort.close();
    }
    serialPort = null;
    parser = null;
}

// ============================================
// FILE MANAGEMENT
// ============================================

const fileFilters = [
    { name: 'Fichiers LumiDMX', extensions: [FILE_EXT] },
    { name: 'Tous les fichiers', extensions: ['*'] }
];

async function handleOpenDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Ouvrir un fichier',
        filters: fileFilters,
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        handleOpenFile(result.filePaths[0]);
    }
}

function handleOpenFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        currentFilePath = filePath;
        addRecentFile(filePath);
        mainWindow.webContents.send('file:loaded', data);
        updateTitle();
    } catch (err) {
        console.error('Open error:', err);
        dialog.showErrorBox('Erreur', 'Impossible d\'ouvrir le fichier:\n' + err.message);
    }
}

async function handleSave() {
    if (currentFilePath) {
        mainWindow.webContents.send('file:request-save', currentFilePath);
    } else {
        handleSaveAs();
    }
}

async function handleSaveAs() {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Enregistrer sous',
        defaultPath: currentFilePath || path.join(app.getPath('documents'), APP_NAME + '.' + FILE_EXT),
        filters: [{ name: 'Fichiers LumiDMX', extensions: [FILE_EXT] }]
    });
    if (!result.canceled && result.filePath) {
        currentFilePath = result.filePath;
        addRecentFile(result.filePath);
        mainWindow.webContents.send('file:request-save', result.filePath);
        updateTitle();
    }
}

function handlePrintPDF() {
    const defaultName = currentFilePath
        ? path.basename(currentFilePath, '.' + FILE_EXT)
        : APP_NAME;
    dialog.showSaveDialog(mainWindow, {
        title: 'Imprimer en PDF',
        defaultPath: path.join(app.getPath('documents'), defaultName + '.pdf'),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }).then(result => {
        if (!result.canceled && result.filePath) {
            mainWindow.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
            }).then(pdfBuffer => {
                fs.writeFileSync(result.filePath, pdfBuffer);
                dialog.showMessageBox(mainWindow, { type: 'info', title: 'PDF', message: 'PDF enregistré avec succès.' });
            }).catch(err => {
                console.error('PDF error:', err);
            });
        }
    });
}

function updateTitle() {
    const name = currentFilePath ? path.basename(currentFilePath) : APP_NAME;
    mainWindow.setTitle(name + ' - ' + APP_NAME);
}

// ============================================
// IPC FILE HANDLERS
// ============================================

ipcMain.handle('file:save', async (event, data) => {
    if (!currentFilePath) return { success: false };
    try {
        fs.writeFileSync(currentFilePath, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true, path: currentFilePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('file:get-current-path', () => currentFilePath);

ipcMain.handle('file:set-current-path', (event, filePath) => {
    currentFilePath = filePath;
    updateTitle();
});

ipcMain.handle('file:get-last', async () => {
    if (recentFiles.length > 0) {
        try {
            const content = fs.readFileSync(recentFiles[0], 'utf-8');
            currentFilePath = recentFiles[0];
            updateTitle();
            return { data: JSON.parse(content), path: recentFiles[0] };
        } catch (e) {}
    }
    return null;
});

ipcMain.handle('file:open-midi-pdf', async () => {
    const pdfPath = path.join(__dirname, 'renderer', 'data', 'midi-mapping.pdf');
    try {
        const err = await shell.openPath(pdfPath);
        if (err) return { success: false, error: err };
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ============================================
// APP LIFECYCLE
// ============================================

let isQuitting = false;

app.whenReady().then(() => {
    setGPUProcessAffinity();
    createWindow();
});

app.on('before-quit', (e) => {
    if (isQuitting) return;

    if (mainWindow && !mainWindow.isDestroyed()) {
        e.preventDefault();
        isQuitting = true;
        mainWindow.webContents.send('app:before-quit');
    } else {
        app.exit(0);
    }
});

ipcMain.on('app:quit-confirmed', (event, save) => {
    if (save) {
        mainWindow.webContents.send('file:request-save', currentFilePath);
        setTimeout(() => forceQuit(), 500);
    } else {
        forceQuit();
    }
});

function forceQuit() {
    isQuitting = true;
    if (serialPort && serialPort.isOpen) {
        serialPort.close(() => {
            serialPort = null;
            parser = null;
            app.exit(0);
        });
    } else {
        app.exit(0);
    }
}

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
