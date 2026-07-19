// Locates a Chromium-based browser on the system for headless rendering.
// Override with the AGENTFORGE_BROWSER env var (full path to the executable).
import fs from 'node:fs';
import path from 'node:path';

export function findBrowser() {
  if (process.env.AGENTFORGE_BROWSER && fs.existsSync(process.env.AGENTFORGE_BROWSER)) {
    return process.env.AGENTFORGE_BROWSER;
  }

  const candidates = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    candidates.push(
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium',
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  throw new Error(
    'No Chromium-based browser found for headless rendering.\n' +
    'Install Google Chrome or Microsoft Edge, or set the AGENTFORGE_BROWSER ' +
    'environment variable to the full path of a Chromium executable.'
  );
}
