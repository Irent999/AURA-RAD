const { app, BrowserWindow, utilityProcess } = require("electron");
const path = require("path");

const PORT = 4173;

let mainWindow = null;
let serverProcess = null;

function getAppRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }

  return app.getAppPath();
}

function getServerPath() {
  return path.join(getAppRoot(), ".output", "server", "index.mjs");
}

function startServer() {
  const serverPath = getServerPath();

  console.log("Starting Nitro server:");
  console.log(serverPath);

  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: getAppRoot(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOST: "127.0.0.1",
    },
    stdio: "pipe",
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[Nitro] ${data.toString()}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[Nitro] ${data.toString()}`);
  });

  serverProcess.on("spawn", () => {
    console.log("Nitro process started.");
  });

  serverProcess.on("exit", (code) => {
    console.log(`Nitro process exited with code ${code}`);
  });
}

async function waitForServer(url, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);

      if (response.status < 500) {
        return true;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }

  return false;
}

async function createWindow() {
  console.log("CREATE WINDOW: starting");

  startServer();

  console.log("CREATE WINDOW: waiting for Nitro");

  const serverReady = await waitForServer(`http://127.0.0.1:${PORT}`);

  console.log("CREATE WINDOW: serverReady =", serverReady);

  if (!serverReady) {
    console.error("Nitro server did not start.");
    app.quit();
    return;
  }

  console.log("CREATE WINDOW: creating BrowserWindow");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  console.log("CREATE WINDOW: BrowserWindow created");

  mainWindow.on("closed", () => {
    console.log("CREATE WINDOW: window closed");
    mainWindow = null;
  });

  mainWindow.webContents.on("did-start-loading", () => {
    console.log("WEB: did-start-loading");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("WEB: did-finish-load");
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error("WEB: did-fail-load");
    console.error("errorCode:", errorCode);
    console.error("description:", errorDescription);
    console.error("URL:", validatedURL);
  });

  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.error("WEB: render-process-gone");
    console.error(details);
  });

  console.log("CREATE WINDOW: loading URL");

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  console.log("CREATE WINDOW: loadURL completed");

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error("Failed to start application:");
    console.error(error);

    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
