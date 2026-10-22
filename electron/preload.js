// Desktop features for the page. The page only gets these functions, never Node or the file system.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('perch', {
    isApp: true,
    loginX: () => ipcRenderer.invoke('login-x'),
    pickFolder: () => ipcRenderer.invoke('pick-folder'),
    openDownloads: () => ipcRenderer.invoke('open-downloads'),
    openData: () => ipcRenderer.invoke('open-data'),
    info: () => ipcRenderer.invoke('app-info'),
});
