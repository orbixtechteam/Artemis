// Preload of a plugin window: the only bridge a plugin page gets. Everything is scoped to that window's plugin by the
// main process (it looks the plugin up from the sender), so a page cannot reach another plugin or the app.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('artemis', {
  call: (name, args) => ipcRenderer.invoke('plugin-win:call', String(name || ''), args && typeof args === 'object' ? args : {}),
  connectors: () => ipcRenderer.invoke('plugin-win:connectors'),
  tool: (name, args) => ipcRenderer.invoke('plugin-win:tool', String(name || ''), args && typeof args === 'object' ? args : {}),
  data: {
    get: (key) => ipcRenderer.invoke('plugin-win:data-get', key == null ? null : String(key)),
    set: (key, value) => ipcRenderer.invoke('plugin-win:data-set', String(key), value === undefined ? null : JSON.parse(JSON.stringify(value)))
  },
  info: () => ipcRenderer.invoke('plugin-win:info'),
  openExternal: (url) => ipcRenderer.invoke('plugin-win:open-external', String(url || ''))
});
