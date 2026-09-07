const os = require('os');
const { execSync } = require('child_process');

function setECoreAffinity() {
    if (process.platform === 'darwin') {
        setMacOSAffinity();
    } else if (process.platform === 'win32') {
        setWindowsAffinity();
    }
}

function setMacOSAffinity() {
    try {
        execSync('taskpolicy -b', { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
        console.log('[Affinity] macOS: background QoS activé (E-cores)');
    } catch (err) {
        console.log('[Affinity] macOS: taskpolicy non dispo (' + err.message + ')');
    }
}

function setWindowsAffinity() {
    try {
        const cpus = os.cpus();
        const total = cpus.length;
        const half = Math.ceil(total / 2);
        const mask = (1 << half) - 1;

        const ps = `$p = Get-Process -Id ${process.pid}; ` +
            `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
            `public class K{[DllImport("kernel32.dll")]public static extern bool SetProcessAffinityMask(IntPtr h,IntPtr m);}'; ` +
            `[K]::SetProcessAffinityMask($p.Handle,[IntPtr]${mask})`;

        execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
            timeout: 5000, windowsHide: true
        });
        console.log(`[Affinity] Windows: masque 0x${mask.toString(16)} (cores 0-${half - 1})`);
    } catch (err) {
        console.log('[Affinity] Windows: erreur SetProcessAffinityMask');
    }
}

function setGPUProcessAffinity() {
    if (process.platform !== 'win32') return;
    try {
        const cpus = os.cpus();
        const half = Math.ceil(cpus.length / 2);
        const mask = (1 << half) - 1;

        execSync(`powershell -NoProfile -NonInteractive -Command "` +
            `Get-Process -Name 'Electron GPU' -ErrorAction SilentlyContinue | ForEach-Object {` +
            `  Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
            `    public class A{[DllImport("kernel32.dll")]public static extern bool SetProcessAffinityMask(IntPtr h,IntPtr m);}';` +
            `  [A]::SetProcessAffinityMask($_.Handle,[IntPtr]${mask})` +
            `}"`, { timeout: 5000, windowsHide: true });
    } catch (e) {}
}

module.exports = { setECoreAffinity, setGPUProcessAffinity };
