import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // DevTools tidak dibuka otomatis.
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
let backendProcess = null;

app.whenReady().then(() => {
  if (app.isPackaged) {
    const backendPath = path.join(process.resourcesPath, 'finapp-backend.exe');
    const dataDir = path.join(app.getPath('userData'), 'PythonBackendData');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log('[Main] Spawning backend from:', backendPath);
    console.log('[Main] FINAPP_DATA_DIR:', dataDir);

    backendProcess = spawn(backendPath, [], {
      env: {
        ...process.env,
        FINAPP_DATA_DIR: dataDir
      }
    });

    backendProcess.stdout.on('data', (data) => console.log(`[Backend]: ${data.toString()}`));
    backendProcess.stderr.on('data', (data) => console.error(`[Backend ERR]: ${data.toString()}`));
  }

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
