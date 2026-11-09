// main.cjs — Electron-обёртка AURA-RAD.
// Запускает Nitro-сервер (.output/server/index.mjs) в отдельном процессе и открывает окно на нём.
const { app, BrowserWindow, utilityProcess, shell, dialog } = require("electron");
const path = require("path");
const net = require("net");

let mainWindow = null;
let serverProcess = null;
let port = 4173;

// Только одна копия приложения
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// В упакованном виде .output лежит в resources (extraResources), в разработке — в корне проекта
function getAppRoot() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function getServerPath() {
  return path.join(getAppRoot(), ".output", "server", "index.mjs");
}

// Предпочитаем 4173; если занят — берём свободный порт
function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tryListen = (p) => {
      const srv = net.createServer();
      srv.once("error", () => (p === 0 ? resolve(preferred) : tryListen(0)));
      srv.once("listening", () => {
        const { port: got } = srv.address();
        srv.close(() => resolve(got));
      });
      srv.listen(p, "127.0.0.1");
    };
    tryListen(preferred);
  });
}

function startServer() {
  const serverPath = getServerPath();
  console.log("Starting Nitro server:", serverPath, "port", port);

  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: getAppRoot(),
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOST: "127.0.0.1" },
    stdio: "pipe",
  });
  serverProcess.stdout.on("data", (d) => console.log(`[Nitro] ${d}`));
  serverProcess.stderr.on("data", (d) => console.error(`[Nitro] ${d}`));
  serverProcess.on("exit", (code) => console.log(`Nitro exited with code ${code}`));
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function waitForServer(url, attempts = 150) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // сервер ещё стартует
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function createWindow() {
  port = await findFreePort(port);
  startServer();

  const url = `http://127.0.0.1:${port}`;
  if (!(await waitForServer(url))) {
    dialog.showErrorBox("AURA-RAD", "Не удалось запустить внутренний сервер.\nПроверьте, что папка resources\\.output на месте.");
    stopServer();
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "AURA-RAD",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Внешние ссылки — в системном браузере, а не внутри приложения
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, failedUrl) => {
    console.error("did-fail-load:", code, desc, failedUrl);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("render-process-gone:", details);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(url);
  if (!app.isPackaged) mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error("Failed to start application:", error);
    dialog.showErrorBox("AURA-RAD", String(error && error.message ? error.message : error));
    stopServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stopServer);
