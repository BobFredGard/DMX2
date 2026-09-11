const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('serial', {
    listPorts: async () => {
        try { return await ipcRenderer.invoke('serial:list-ports'); }
        catch (e) { console.error('listPorts error:', e); return []; }
    },
    connect: async (portPath, baudRate) => {
        try { return await ipcRenderer.invoke('serial:connect', portPath, baudRate); }
        catch (e) { console.error('connect error:', e); return { success: false, error: e.message }; }
    },
    disconnect: async () => {
        try { return await ipcRenderer.invoke('serial:disconnect'); }
        catch (e) { console.error('disconnect error:', e); return { success: false }; }
    },
    isConnected: async () => {
        try { return await ipcRenderer.invoke('serial:is-connected'); }
        catch (e) { return false; }
    },
    onData: (callback) => ipcRenderer.on('serial:data', (event, data) => callback(data)),
    onConnected: (callback) => ipcRenderer.on('serial:connected', (event, port) => callback(port)),
    onDisconnected: (callback) => ipcRenderer.on('serial:disconnected', () => callback()),
    onError: (callback) => ipcRenderer.on('serial:error', (event, err) => callback(err))
});

contextBridge.exposeInMainWorld('dmx', {
    send: async (channels) => {
        try { return await ipcRenderer.invoke('dmx:send', channels); }
        catch (e) { console.error('dmx:send error:', e); return { success: false, error: e.message }; }
    },
    sendSingle: async (channel, value) => {
        try { return await ipcRenderer.invoke('dmx:send-single', channel, value); }
        catch (e) { console.error('dmx:sendSingle error:', e); return { success: false, error: e.message }; }
    }
});

contextBridge.exposeInMainWorld('electronAPI', {
    onMenu: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
    onBeforeQuit: (callback) => ipcRenderer.on('app:before-quit', (event) => callback()),
    quitConfirmed: (save) => ipcRenderer.send('app:quit-confirmed', save),
    openMidiPdf: async () => {
        try { return await ipcRenderer.invoke('file:open-midi-pdf'); }
        catch (e) { return { success: false, error: e.message }; }
    },
    file: {
        save: async (data) => {
            try { return await ipcRenderer.invoke('file:save', data); }
            catch (e) { return { success: false, error: e.message }; }
        },
        getCurrentPath: async () => {
            try { return await ipcRenderer.invoke('file:get-current-path'); }
            catch (e) { return null; }
        },
        setCurrentPath: async (filePath) => {
            try { return await ipcRenderer.invoke('file:set-current-path', filePath); }
            catch (e) {}
        },
        getLast: async () => {
            try { return await ipcRenderer.invoke('file:get-last'); }
            catch (e) { return null; }
        },
        onLoaded: (callback) => ipcRenderer.on('file:loaded', (event, data) => callback(data)),
        onRequestSave: (callback) => ipcRenderer.on('file:request-save', (event, filePath) => callback(filePath))
    }
});
