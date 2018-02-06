// in RENDERER: webview.send()
// in WEBVIEW: ipcRenderer.on()
export const R2_EVENT_READIUMCSS = "R2_EVENT_READIUMCSS";

// in RENDERER: webview.send()
// in WEBVIEW: ipcRenderer.on()
export const R2_EVENT_SCROLLTO = "R2_EVENT_SCROLLTO";

// in RENDERER: webview.send()
// in WEBVIEW: ipcRenderer.on()
export const R2_EVENT_PAGE_TURN = "R2_EVENT_PAGE_TURN";

// in WEBVIEW: ipcRenderer.sendToHost()
// in RENDERER: webview.addEventListener("ipc-message")
export const R2_EVENT_PAGE_TURN_RES = "R2_EVENT_PAGE_TURN_RES";

// in WEBVIEW: ipcRenderer.sendToHost()
// in RENDERER: webview.addEventListener("ipc-message")
export const R2_EVENT_READING_LOCATION = "R2_EVENT_READING_LOCATION";

// in MAIN: browserWindow.webContents.send(()
// in RENDERER: ipcRenderer.on()
// in WEBVIEW: ipcRenderer.sendToHost()
// in RENDERER: webview.addEventListener("ipc-message")
export const R2_EVENT_LINK = "R2_EVENT_LINK";

// in WEBVIEW: ipcRenderer.sendToHost()
// in RENDERER: webview.addEventListener("ipc-message")
export const R2_EVENT_WEBVIEW_READY = "R2_EVENT_WEBVIEW_READY";
