const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const origin = 'motionlab://app';
const uiDirectory = path.resolve(__dirname, '../dist');
const assetTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'";

protocol.registerSchemesAsPrivileged([
  { scheme: 'motionlab', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.whenReady().then(() => {
    protocol.handle('motionlab', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      const file = path.resolve(uiDirectory, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      const relative = path.relative(uiDirectory, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', policy);
      const contentType = assetTypes[path.extname(file)];
      if (contentType) headers.set('Content-Type', contentType);
      return new Response(response.body, { status: response.status, headers });
    });

    const isLocal = (url) => typeof url === 'string' && (url === origin || url.startsWith(origin + '/'));
    session.defaultSession.setPermissionCheckHandler((contents, permission, source, details) =>
      permission === 'media' && isLocal(contents?.getURL()) && isLocal(source) && details.mediaType === 'video');
    session.defaultSession.setPermissionRequestHandler((contents, permission, respond, details) =>
      respond(permission === 'media' && isLocal(contents?.getURL()) && isLocal(details.requestingUrl) &&
        details.isMainFrame && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video'));

    Menu.setApplicationMenu(null);
    nativeTheme.themeSource = 'light';
    const window = new BrowserWindow({
      width: 1460, height: 900, minWidth: 840, minHeight: 620, show: false,
      backgroundColor: '#F4F5F7', icon: path.join(__dirname, 'icon.ico'), title: 'BME3201 Motion Lab',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    ipcMain.handle('motionlab:export-pdf', async (_event, payload) => {
      const html = typeof payload?.html === 'string' ? payload.html : '';
      const rawName = typeof payload?.defaultName === 'string' ? payload.defaultName : 'MotionLab_Report.pdf';
      const safeName = rawName.replace(/[<>:"/\\|?*]+/g, '_');
      if (!html) return { ok: false, error: 'Empty report content' };

      const saveRes = await dialog.showSaveDialog(window, {
        defaultPath: safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (saveRes.canceled || !saveRes.filePath) return { ok: false, canceled: true };

      const tmpHtml = path.join(os.tmpdir(), `motionlab-report-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
      let printWin = null;
      try {
        await fs.writeFile(tmpHtml, html, 'utf8');
        printWin = new BrowserWindow({
          show: false,
          width: 794,
          height: 1123,
          backgroundColor: '#FFFFFF',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        await printWin.loadFile(tmpHtml);
        const pdf = await printWin.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
        });
        await fs.writeFile(saveRes.filePath, pdf);
        return { ok: true, filePath: saveRes.filePath };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        if (printWin && !printWin.isDestroyed()) printWin.destroy();
        await fs.unlink(tmpHtml).catch(() => undefined);
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!isLocal(url)) event.preventDefault();
    });
    window.once('ready-to-show', () => window.show());
    window.loadURL(origin + '/');
  });

  app.on('window-all-closed', () => app.quit());
}




