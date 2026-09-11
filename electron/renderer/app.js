// ============================================
// DMX CONTROL - MAIN APPLICATION
// ============================================

let isAutoUpdating = false;
let spotColorsCopy = null;
let waveRunning = false;
let waveReqId = null;
let waveOffset = 0;
let waveSnapshot = null;
let flashSnapshot = null;
let starActive = {};
let starNextSpawn = 0;
let fadeReqId = null;

// Flash state
let flashRunning = false;
let flashReqId = null;
let flashPreState = null;
let flashStartTime = 0;
let flashTapTimes = [];
let flashBPM = null;
let flashMidiCC = 119;
let flashIntervalId = null;
let playlist = [];
let currentSongIndex = -1;
let lastSendTime = 0;
let sendThrottle = null;
let isDirty = false;

function markDirty() { isDirty = true; }

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    await FixtureManager.init();
    const restored = FixtureManager.restore();

    setupSerialUI();
    setupAddFixtureModal();
    setupProfileEditor();
    setupNavbarButtons();
    setupPlaylistModal();
    setupOptionsModal();
    setupGroupToolbar();
    setupSceneGrid();
    setupMomentaryButtons();
    setupFlash();
    document.getElementById('fixturePanelClose').addEventListener('click', closeFixturePanel);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeFixturePanel();
    });
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('fixturePanel');
        if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !e.target.closest('.card-fixture')) {
            closeFixturePanel();
        }
    });

    FixtureManager.onChange(handleFixtureChange);

    loadPlaylist();
    initColoris();
    setupNativeMenus();

    if (window.electronAPI && window.electronAPI.onBeforeQuit) {
        window.electronAPI.onBeforeQuit(() => {
            if (!isDirty) {
                window.electronAPI.quitConfirmed(false);
                return;
            }
            const answer = confirm('Des modifications non sauvegardées.\nEnregistrer avant de quitter ?');
            if (answer) {
                const data = getCurrentSetData();
                data.playlist = playlist;
                window.electronAPI.file.save(data).then(() => {
                    savePlaylist();
                    window.electronAPI.quitConfirmed(true);
                });
            } else {
                window.electronAPI.quitConfirmed(false);
            }
        });
    }

    const notesInput = document.getElementById('songNotes');
    if (notesInput) {
        notesInput.addEventListener('input', () => {
            if (currentSongIndex >= 0 && playlist[currentSongIndex]) {
                playlist[currentSongIndex].notes = notesInput.value;
                markDirty();
                savePlaylist();
                if (window._autoSave) window._autoSave();
            }
        });
    }

    if (restored) {
        renderAllFixtures();
        renderGroupToolbar();
        updateSlidersVisibility();
        showToast('État restauré');
    }

    setInterval(async () => {
        if (window.serial && window.serial.isConnected) {
            const connected = await window.serial.isConnected();
            if (connected) actuallySendDMX();
        }
    }, 500);

    const lastPort = localStorage.getItem('dmx2_lastPort');
    if (lastPort) {
        console.log('Auto-reconnect to:', lastPort);
        setTimeout(async () => {
            try {
                const connected = await window.serial.isConnected();
                console.log('Already connected:', connected);
                if (!connected) {
                    console.log('Attempting connect to:', lastPort);
                    const result = await window.serial.connect(lastPort, 921600);
                    console.log('Connect result:', result);
                    if (result.success) {
                        showToast('Reconnecté à ' + lastPort);
                    } else {
                        console.log('First attempt failed, retrying in 2s...');
                        setTimeout(async () => {
                            try {
                                const retry = await window.serial.connect(lastPort, 921600);
                                console.log('Retry result:', retry);
                                if (retry.success) showToast('Reconnecté à ' + lastPort);
                            } catch (e) { console.error('Retry error:', e); }
                        }, 2000);
                    }
                }
            } catch (e) { console.error('Auto-reconnect error:', e); }
        }, 1000);
    } else {
        console.log('No last port saved');
    }
});

// ============================================
// COLORIS
// ============================================

function initColoris() {
    setTimeout(() => {
        const waveEl1 = document.querySelector('#waveColorStart');
        const waveEl2 = document.querySelector('#waveColorEnd');
        if (waveEl1) {
            waveEl1.value = '#ff0000';
            waveEl1.addEventListener('input', updateWaveGradient);
            waveEl1.addEventListener('change', updateWaveGradient);
        }
        if (waveEl2) {
            waveEl2.value = '#ff00ff';
            waveEl2.addEventListener('input', updateWaveGradient);
            waveEl2.addEventListener('change', updateWaveGradient);
        }
        updateWaveGradient();
    }, 200);
}

function updateWaveGradient() {
    const c1 = document.getElementById('waveColorStart').value || '#ff0000';
    const c2 = document.getElementById('waveColorEnd').value || '#ff00ff';
    const grad = document.getElementById('waveColorGradient');
    if (grad) grad.style.background = `linear-gradient(to right, ${c1}, ${c2})`;
    const w1 = document.getElementById('waveColorStart');
    const w2 = document.getElementById('waveColorEnd');
    if (w1 && w1.parentNode && w1.parentNode.classList.contains('clr-field')) {
        w1.parentNode.style.color = c1;
    }
    if (w2 && w2.parentNode && w2.parentNode.classList.contains('clr-field')) {
        w2.parentNode.style.color = c2;
    }
}

function reinitColorisInstance(selector) {
    if (!window.Coloris) return;
    const el = document.querySelector(selector);
    if (el) {
        Coloris({ el: el, theme: 'pill', themeMode: 'dark', formatToggle: true, closeButton: false, clearButton: false, flat: true, showInput: true });
    }
}

// ============================================
// SERIAL PORT
// ============================================

function setupSerialUI() {
    const statusDot = document.getElementById('connectionStatus');

    window.serial.onConnected((port) => {
        statusDot.className = 'connection-dot connected';
        statusDot.title = 'Connecté: ' + port;
        const optDot = document.getElementById('optionsConnectionStatus');
        if (optDot) { optDot.className = 'connection-dot connected'; }
        const optBtn = document.getElementById('btnOptionsConnect');
        if (optBtn) optBtn.textContent = 'Déconnecter';
        showToast('Connecté à ' + port);
    });
    window.serial.onDisconnected(() => {
        statusDot.className = 'connection-dot disconnected';
        statusDot.title = 'Déconnecté';
        const optDot = document.getElementById('optionsConnectionStatus');
        if (optDot) { optDot.className = 'connection-dot disconnected'; }
        const optBtn = document.getElementById('btnOptionsConnect');
        if (optBtn) optBtn.textContent = 'Connecter';
    });
    window.serial.onError((err) => showToast('Erreur: ' + err));

    window.serial.onData((data) => {
        const line = data.toString().trim();
        if (line === 'FLASH') {
            const activeIds = FixtureManager.getFixtures().filter(f => f.flashEnabled).map(f => f.id);
            if (activeIds.length > 0) flashTick();
        } else if (line.startsWith('FLASH #')) {
            const hex = line.substring(7).trim();
            const rgb = hexToRgb(hex);
            if (rgb) {
                const activeIds = FixtureManager.getFixtures().filter(f => f.flashEnabled).map(f => f.id);
                activeIds.forEach(id => {
                    const fixture = FixtureManager.getFixture(id);
                    if (!fixture) return;
                    if (!fixture._flashPreState) fixture._flashPreState = new Uint8Array(fixture.channelValues);
                    const profile = FixtureManager.getProfile(fixture.profileId);
                    const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;
                    if (zoneCount > 1) {
                        for (let z = 0; z < zoneCount; z++) {
                            const off = (zoneCount - 1 - z) * 3;
                            FixtureManager.setChannelValue(fixture.id, off, rgb.r);
                            FixtureManager.setChannelValue(fixture.id, off + 1, rgb.g);
                            FixtureManager.setChannelValue(fixture.id, off + 2, rgb.b);
                        }
                    } else if (FixtureManager.isRGBFixture(fixture)) {
                        FixtureManager.setFixtureColor(fixture.id, rgb.r, rgb.g, rgb.b);
                    }
                });
                sendDMXBuffer();
                updateAllFixtureDisplays();
            }
        }
    });
}

async function refreshPorts() {
    const portSelect = document.getElementById('portSelect');
    const ports = await window.serial.listPorts();
    portSelect.innerHTML = '<option value="">-- Port série --</option>';
    ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
        portSelect.appendChild(opt);
    });
}

async function toggleConnection() {
    const btnConnect = document.getElementById('btnConnect');
    const portSelect = document.getElementById('portSelect');
    const statusDot = document.getElementById('connectionStatus');
    const isConnected = await window.serial.isConnected();
    if (isConnected) {
        await window.serial.disconnect();
    } else {
        const portPath = portSelect.value;
        if (!portPath) { showToast('Sélectionnez un port'); return; }
        statusDot.className = 'connection-dot connecting';
        const result = await window.serial.connect(portPath, 921600);
        if (result.success) {
            localStorage.setItem('dmx2_lastPort', portPath);
        } else {
            statusDot.className = 'connection-dot disconnected';
            showToast('Erreur: ' + result.error);
        }
    }
}

function allBlack() {
    FixtureManager.getFixtures().forEach(f => {
        for (let i = 0; i < f.channels; i++) FixtureManager.setChannelValue(f.id, i, 0);
    });
    sendDMXBuffer();
}

function restoreSidebarState() {
    const saved = localStorage.getItem('dmx2_sidebar');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            const sidebar = document.getElementById('playlistSidebar');
            if (s.open) {
                sidebar.classList.add('open');
                if (s.view === 'live') {
                    sidebar.dataset.currentView = 'live';
                    document.getElementById('liveView').style.display = '';
                    document.getElementById('playlistView').style.display = 'none';
                    renderLiveButtons();
                } else {
                    sidebar.dataset.currentView = 'playlist';
                    document.getElementById('liveView').style.display = 'none';
                    document.getElementById('playlistView').style.display = '';
                }
            }
        } catch (e) {}
    }
}

// ============================================
// DMX SEND
// ============================================

let autoSaveTimer = null;
function scheduleAutoSave() {
    if (momentaryActiveIndex >= 0) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { autoSaveCurrentSong(); autoSaveTimer = null; }, 2000);
}

function sendDMXBuffer() {
    const now = Date.now();
    if (now - lastSendTime < 2) {
        if (!sendThrottle) {
            sendThrottle = setTimeout(() => {
                sendThrottle = null;
                lastSendTime = Date.now();
                actuallySendDMX();
            }, 2 - (now - lastSendTime));
        }
        return;
    }
    lastSendTime = now;
    actuallySendDMX();
}

function actuallySendDMX() {
    const channels = FixtureManager.getDMXChannels();
    let lastNonZero = 0;
    for (let i = channels.length - 1; i >= 0; i--) {
        if (channels[i] !== 0) { lastNonZero = i + 1; break; }
    }
    if (lastNonZero === 0) lastNonZero = 1;
    window.dmx.send(Array.from(channels.slice(0, lastNonZero)));
}

// ============================================
// FIXTURE CHANGE HANDLER
// ============================================

function handleFixtureChange(event, data) {
    switch (event) {
        case 'add':
        case 'restore':
        case 'clear':
            markDirty();
            renderAllFixtures();
            renderGroupToolbar();
            updateSlidersVisibility();
            break;
        case 'remove':
            markDirty();
            renderAllFixtures();
            renderGroupToolbar();
            updateSlidersVisibility();
            sendDMXBuffer();
            break;
        case 'valueChange':
            sendDMXBuffer();
            updateSliderValues();
            if (data && data.fixture && data.channelOffset !== undefined) {
                const slider = document.querySelector(`#fixturePanel input[type="range"][data-fixture="${data.fixture.id}"][data-offset="${data.channelOffset}"]`);
                if (slider && !slider.matches(':active')) slider.value = data.value;
            }
            break;
        case 'colorChange':
            sendDMXBuffer();
            updateFixtureColorDisplay(data.fixture);
            if (data && data.fixture) {
                const offsets = FixtureManager.getRGBOffsets(data.fixture);
                if (offsets) {
                    [{ off: offsets.r, v: data.r }, { off: offsets.g, v: data.g }, { off: offsets.b, v: data.b }].forEach(({ off, v }) => {
                        const s = document.querySelector(`#fixturePanel input[type="range"][data-fixture="${data.fixture.id}"][data-offset="${off}"]`);
                        if (s && !s.matches(':active')) s.value = v;
                    });
                }
            }
            break;
        case 'groupAdd':
        case 'groupRemove':
        case 'groupUpdate':
            renderGroupToolbar();
            break;
    }
}

// ============================================
// FIXTURE CARD RENDERING
// ============================================

function updateMomentaryCheckboxes() {
    document.querySelectorAll('.fixture-momentary-cb').forEach(cb => {
        const f = FixtureManager.getFixture(cb.dataset.id);
        if (f) cb.checked = f.momentaryEnabled !== false;
    });
}

function syncWaveButton() {
    const btn = document.getElementById('btnWave');
    const waveToolbar = document.getElementById('waveToolbar');
    if (!btn) return;
    btn.textContent = waveRunning ? 'Stop Vague' : 'Vague';
    btn.classList.toggle('active', waveRunning);
    if (waveToolbar) waveToolbar.style.display = waveRunning ? '' : 'none';
}

function syncFlashButton() {
    const btn = document.getElementById('btnFlash');
    const toolbar = document.getElementById('flashToolbar');
    if (!btn) return;
    const running = toolbar && toolbar.style.display !== 'none';
    btn.textContent = running ? 'Flash Stop' : 'Flash';
    btn.classList.toggle('active', running);
}

function renderAllFixtures() {
    const container = document.getElementById('fixturesContainer');
    container.innerHTML = '';

    const allFixtures = FixtureManager.getFixtures().slice().sort((a, b) => a.startChannel - b.startChannel);
    const spotIds = new Set(FixtureManager.getSpotFixtures().map(f => f.id));

    let spotBuffer = [];

    function flushSpotBuffer() {
        if (spotBuffer.length === 0) return;
        for (let i = 0; i < spotBuffer.length; i += 4) {
            const group = spotBuffer.slice(i, i + 4);
            const globalIdx = FixtureManager.getSpotFixtures().findIndex(f => f.id === group[0].id);
            const groupIdx = Math.floor(globalIdx / 4);
            const groupId = 'sg_' + groupIdx;
            const linkState = FixtureManager.getSpotLinkState(groupId);
            const groupSize = group.length;

            const groupDiv = document.createElement('div');
            groupDiv.className = 'spot-group';

            group.forEach((fixture, idx) => {
                renderFixtureCard(fixture, groupDiv);

                if (idx < groupSize - 1) {
                    const linkDiv = document.createElement('div');
                    linkDiv.className = 'spot-link';
                    const linkCb = document.createElement('input');
                    linkCb.type = 'checkbox';
                    linkCb.className = 'spot-link-cb';

                    const linkKey = 'l' + (idx + 1) + '' + (idx + 2);
                    linkCb.checked = !!linkState[linkKey];
                    linkCb.dataset.groupId = groupId;
                    linkCb.dataset.linkKey = linkKey;
                    linkCb.dataset.fromIdx = idx;
                    linkCb.dataset.toIdx = idx + 1;
                    linkCb.title = 'Lier ' + (idx + 1) + '+' + (idx + 2);

                    linkCb.addEventListener('change', (e) => {
                        const gid = e.target.dataset.groupId;
                        const key = e.target.dataset.linkKey;
                        const checked = e.target.checked;
                        FixtureManager.setSpotLink(gid, key, checked);

                        if (checked) {
                            groupDiv.querySelectorAll('.spot-link-cb').forEach(cb => {
                                if (cb.dataset.linkKey === 'lall') {
                                    cb.checked = false;
                                    FixtureManager.setSpotLink(gid, 'lall', false);
                                }
                            });
                            const fromIdx = parseInt(e.target.dataset.fromIdx);
                            const srcRgb = getFixtureDisplayRgb(group[fromIdx]);
                            if (srcRgb) propagateSpotLinkFromFixture(group, fromIdx, srcRgb);
                        }
                    });

                    linkDiv.appendChild(linkCb);
                    groupDiv.appendChild(linkDiv);
                }
            });

            const allDiv = document.createElement('div');
            allDiv.className = 'spot-link';
            const allCb = document.createElement('input');
            allCb.type = 'checkbox';
            allCb.className = 'spot-link-cb';
            allCb.checked = !!linkState.lall;
            allCb.dataset.groupId = groupId;
            allCb.dataset.linkKey = 'lall';
            allCb.title = 'Lier les ' + groupSize;
            allCb.addEventListener('change', (e) => {
                const gid = e.target.dataset.groupId;
                const checked = e.target.checked;
                FixtureManager.setSpotLink(gid, 'lall', checked);
                if (checked) {
                    groupDiv.querySelectorAll('.spot-link-cb').forEach(cb => {
                        if (cb.dataset.linkKey !== 'lall') {
                            cb.checked = false;
                            FixtureManager.setSpotLink(gid, cb.dataset.linkKey, false);
                        }
                    });
                    const srcRgb = getFixtureDisplayRgb(group[0]);
                    if (srcRgb) propagateSpotLinkFromFixture(group, 0, srcRgb);
                }
            });
            allDiv.appendChild(allCb);
            groupDiv.appendChild(allDiv);

            container.appendChild(groupDiv);
        }
        spotBuffer = [];
    }

    allFixtures.forEach(fixture => {
        if (spotIds.has(fixture.id)) {
            spotBuffer.push(fixture);
        } else {
            flushSpotBuffer();
            renderFixtureCard(fixture);
        }
    });
    flushSpotBuffer();
}

function updateAllFixtureDisplays() {
    FixtureManager.getFixtures().forEach(fixture => {
        const card = document.getElementById('fixture-' + fixture.id);
        if (!card) return;
        const profile = FixtureManager.getProfile(fixture.profileId);

        // Update sliders (in panel)
        if (profile && profile.controls) {
            profile.controls.forEach(ctrl => {
                if (ctrl.type === 'slider') {
                    const slider = document.querySelector(`input[data-fixture="${fixture.id}"][data-offset="${ctrl.offset}"]`);
                    if (slider && !slider.matches(':active')) slider.value = fixture.channelValues[ctrl.offset];
                }
            });
        }

        // Update color displays and card color
        if (profile && profile.hasZonePickers) {
            const zoneCount = Math.floor(fixture.channels / 3);
            let avgR = 0, avgG = 0, avgB = 0;
            for (let z = 0; z < zoneCount; z++) {
                const el = document.getElementById('fixtureZone-' + fixture.id + '-z' + z);
                const off = (zoneCount - 1 - z) * 3;
                const r = fixture.channelValues[off]||0, g = fixture.channelValues[off+1]||0, b = fixture.channelValues[off+2]||0;
                if (el && !el.matches(':focus')) {
                    isAutoUpdating = true;
                    el.value = `rgb(${r}, ${g}, ${b})`;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    isAutoUpdating = false;
                }
                avgR += r; avgG += g; avgB += b;
            }
            if (zoneCount > 0) {
                card.style.setProperty('--fixture-color', `rgb(${Math.round(avgR/zoneCount)}, ${Math.round(avgG/zoneCount)}, ${Math.round(avgB/zoneCount)})`);
            }
        } else if (profile && profile.hasColorPicker) {
            const el = document.getElementById('fixtureColor-' + fixture.id);
            const rgb = FixtureManager.getFixtureRGB(fixture.id);
            if (rgb) {
                if (el && !el.matches(':focus')) {
                    isAutoUpdating = true;
                    el.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    isAutoUpdating = false;
                }
                card.style.setProperty('--fixture-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
            }
        }
    });
}

function renderFixtureCard(fixture, targetContainer) {
    const container = targetContainer || document.getElementById('fixturesContainer');
    const profile = FixtureManager.getProfile(fixture.profileId);
    const card = document.createElement('div');
    card.className = 'card card-fixture';
    card.id = 'fixture-' + fixture.id;
    card.style.setProperty('--fixture-color', fixture.color);

    // Header
    const header = document.createElement('div');
    header.className = 'fixture-header';
    header.innerHTML = `
        <h3>${escapeHtml(fixture.name)}</h3>
        <label class="fixture-wave-toggle" title="Inclure dans la vague">
            <input type="checkbox" class="fixture-wave-cb" data-id="${fixture.id}" ${fixture.waveEnabled ? 'checked' : ''}>
            <span class="fixture-wave-label">Vague</span>
        </label>
        <label class="fixture-wave-toggle" title="Inverser le sens de la vague" style="display:none;">
            <input type="checkbox" class="fixture-reverse-cb" data-id="${fixture.id}" ${fixture.reverseWave ? 'checked' : ''}>
            <span class="fixture-wave-label">Inversion</span>
        </label>
        <label class="fixture-wave-toggle" title="Réagit aux instantanés">
            <input type="checkbox" class="fixture-momentary-cb" data-id="${fixture.id}" ${fixture.momentaryEnabled !== false ? 'checked' : ''}>
            <span class="fixture-wave-label">Inst.</span>
        </label>
        <label class="fixture-wave-toggle" title="Réagit aux flashs">
            <input type="checkbox" class="fixture-flash-cb" data-id="${fixture.id}" ${fixture.flashEnabled ? 'checked' : ''}>
            <span class="fixture-wave-label">Flash</span>
        </label>
        <button class="btn-remove-fixture" data-id="${fixture.id}" title="Supprimer">&times;</button>
    `;
    card.appendChild(header);

    const chInfo = document.createElement('div');
    chInfo.className = 'fixture-channel-info';
    chInfo.textContent = `DMX ${fixture.startChannel} → ${fixture.startChannel + fixture.channels - 1} (${fixture.channels} ch)`;
    card.appendChild(chInfo);

    header.querySelector('.btn-remove-fixture').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Supprimer "' + fixture.name + '" ?')) {
            const removedId = fixture.id;
            FixtureManager.removeFixture(removedId);
            if (currentSongIndex >= 0 && playlist[currentSongIndex] && playlist[currentSongIndex].data) {
                playlist[currentSongIndex].data.fixtures = (playlist[currentSongIndex].data.fixtures || []).filter(f => f.id !== removedId);
            }
            renderAllFixtures();
            renderGroupToolbar();
            sendDMXBuffer();
        }
    });
    header.querySelector('h3').addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const h3 = e.target;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = fixture.name;
        input.className = 'fixture-rename-input';
        input.style.cssText = 'background:var(--input-bg);border:1px solid var(--accent-blue);color:var(--text-color);border-radius:4px;padding:2px 6px;font-size:0.9rem;font-weight:600;width:120px;outline:none;';
        h3.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
            const newName = input.value.trim() || fixture.name;
            FixtureManager.renameFixture(fixture.id, newName);
            renderAllFixtures();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = fixture.name; input.blur(); } });
    });
    header.querySelector('.fixture-wave-cb').addEventListener('change', (e) => {
        e.stopPropagation();
        FixtureManager.setWaveEnabled(fixture.id, e.target.checked);
    });
    const reverseCbEl = header.querySelector('.fixture-reverse-cb');
    if (profile && profile.hasZonePickers) {
        reverseCbEl.closest('label').style.display = '';
    }
    reverseCbEl.addEventListener('change', (e) => {
        e.stopPropagation();
        FixtureManager.setReverseWave(fixture.id, e.target.checked);
    });
    header.querySelector('.fixture-momentary-cb').addEventListener('change', (e) => {
        e.stopPropagation();
        FixtureManager.setMomentaryEnabled(fixture.id, e.target.checked);
    });
    header.querySelector('.fixture-flash-cb').addEventListener('change', (e) => {
        e.stopPropagation();
        FixtureManager.setFlashEnabled(fixture.id, e.target.checked);
        if (isFlashToolbarVisible()) restartFlashEngine();
    });

    // Zone pickers for Stervilles (in card)
    if (profile && profile.hasZonePickers) {
        const zonesContainer = document.createElement('div');
        zonesContainer.className = 'fixture-zones';
        const zoneCount = Math.floor(fixture.channels / 3);
        const zoneLinks = fixture.zoneLinks || { l12: false, l34: false, lall: false };

        for (let z = 0; z < zoneCount; z++) {
            const zoneDiv = document.createElement('div');
            zoneDiv.className = 'fixture-zone';
            const zoneLabel = document.createElement('label');
            zoneLabel.className = 'slider-label';
            zoneLabel.textContent = 'Zone ' + (z + 1);
            const zonePicker = document.createElement('input');
            zonePicker.type = 'text';
            zonePicker.className = 'coloris instance1 fixture-zone-' + fixture.id + '-z' + z;
            zonePicker.id = 'fixtureZone-' + fixture.id + '-z' + z;
            zonePicker.value = 'rgb(0, 0, 0)';
            zoneDiv.appendChild(zoneLabel);
            zoneDiv.appendChild(zonePicker);
            zonesContainer.appendChild(zoneDiv);

            const zoneOffset = (zoneCount - 1 - z) * 3;
            zonePicker.addEventListener('input', (e) => {
                if (isAutoUpdating) return;
                const rgb = parseRGB(e.target.value);
                FixtureManager.setChannelValue(fixture.id, zoneOffset, rgb.r);
                FixtureManager.setChannelValue(fixture.id, zoneOffset + 1, rgb.g);
                FixtureManager.setChannelValue(fixture.id, zoneOffset + 2, rgb.b);
                card.style.setProperty('--fixture-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
                propagateZoneLink(fixture, z, rgb);
            });

            // Add link checkbox between zones
            if (z < zoneCount - 1) {
                const linkDiv = document.createElement('div');
                linkDiv.className = 'fixture-zone-link';
                const linkCb = document.createElement('input');
                linkCb.type = 'checkbox';
                linkCb.className = 'zone-link-cb';
                linkCb.title = z === 0 ? 'Lier Zones 1+2' : z === 1 ? 'Lier les 4 zones' : 'Lier Zones 3+4';
                const linkKey = z === 0 ? 'l12' : z === 1 ? 'lall' : 'l34';
                linkCb.checked = zoneLinks[linkKey];
                linkCb.dataset.linkKey = linkKey;
                linkCb.dataset.fixtureId = fixture.id;
                linkCb.addEventListener('change', (e) => {
                    const fid = e.target.dataset.fixtureId;
                    const key = e.target.dataset.linkKey;
                    const checked = e.target.checked;
                    FixtureManager.setZoneLink(fid, key, checked);
                    const f = FixtureManager.getFixture(fid);
                    if (checked && key === 'lall') {
                        if (f && f.zoneLinks) { f.zoneLinks.l12 = false; f.zoneLinks.l34 = false; }
                        FixtureManager.setZoneLink(fid, 'l12', false);
                        FixtureManager.setZoneLink(fid, 'l34', false);
                        document.querySelectorAll(`.zone-link-cb[data-fixture-id="${fid}"]`).forEach(cb => {
                            if (cb.dataset.linkKey === 'l12' || cb.dataset.linkKey === 'l34') cb.checked = false;
                        });
                        if (f) {
                            const z0 = parseRGB(document.getElementById('fixtureZone-' + fid + '-z0')?.value || 'rgb(0,0,0)');
                            propagateZoneLinkAll(f, z0);
                        }
                    } else if (checked && (key === 'l12' || key === 'l34')) {
                        if (f && f.zoneLinks) f.zoneLinks.lall = false;
                        FixtureManager.setZoneLink(fid, 'lall', false);
                        document.querySelectorAll(`.zone-link-cb[data-fixture-id="${fid}"]`).forEach(cb => {
                            if (cb.dataset.linkKey === 'lall') cb.checked = false;
                        });
                    }
                });
                linkDiv.appendChild(linkCb);
                zonesContainer.appendChild(linkDiv);
            }

            setTimeout(() => reinitColorisInstance('#fixtureZone-' + fixture.id + '-z' + z), 50 + z * 20);
        }
        card.appendChild(zonesContainer);
    }

    // Single color picker (in card)
    if (profile && profile.hasColorPicker && !profile.hasZonePickers) {
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.className = 'coloris instance1 fixture-color-' + fixture.id;
        colorInput.value = 'rgb(0, 0, 0)';
        colorInput.id = 'fixtureColor-' + fixture.id;
        card.appendChild(colorInput);
        colorInput.addEventListener('input', (e) => {
            if (isAutoUpdating) return;
            const rgb = parseRGB(e.target.value);
            FixtureManager.setFixtureColor(fixture.id, rgb.r, rgb.g, rgb.b);
            card.style.setProperty('--fixture-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
            const spotInfo = FixtureManager.getSpotLinkGroup(fixture.id);
            if (spotInfo) {
                const spotFixtures = FixtureManager.getSpotFixtures();
                const groupStart = spotInfo.groupIndex * 4;
                const groupFixtures = spotFixtures.slice(groupStart, groupStart + 4);
                propagateSpotLinkFromFixture(groupFixtures, spotInfo.indexInGroup, rgb);
            }
        });
        setTimeout(() => reinitColorisInstance('.fixture-color-' + fixture.id), 50);
    }

    // Right-click opens slider panel
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openFixturePanel(fixture.id);
    });

    card.title = 'Clic droit = sliders avancés';
    container.appendChild(card);
}

let currentPanelFixtureId = null;

function propagateZoneLink(fixture, sourceZone, rgb) {
    const links = fixture.zoneLinks;
    if (!links) return;
    const isAll = links.lall;
    const isPair12 = links.l12;
    const isPair34 = links.l34;

    if (isAll) {
        for (let z = 0; z < 4; z++) {
            if (z === sourceZone) continue;
            setZoneColor(fixture, z, rgb);
        }
    } else {
        if (sourceZone === 0 && isPair12) setZoneColor(fixture, 1, rgb);
        if (sourceZone === 1 && isPair12) setZoneColor(fixture, 0, rgb);
        if (sourceZone === 2 && isPair34) setZoneColor(fixture, 3, rgb);
        if (sourceZone === 3 && isPair34) setZoneColor(fixture, 2, rgb);
    }
}

function propagateZoneLinkAll(fixture, rgb) {
    for (let z = 0; z < 4; z++) {
        setZoneColor(fixture, z, rgb);
    }
}

function setZoneColor(fixture, zone, rgb) {
    const zoneOffset = zone * 3;
    FixtureManager.setChannelValue(fixture.id, zoneOffset, rgb.r);
    FixtureManager.setChannelValue(fixture.id, zoneOffset + 1, rgb.g);
    FixtureManager.setChannelValue(fixture.id, zoneOffset + 2, rgb.b);
    const el = document.getElementById('fixtureZone-' + fixture.id + '-z' + zone);
    if (el) {
        isAutoUpdating = true;
        el.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        isAutoUpdating = false;
    }
}

// ============================================
// SPOT LINK PROPAGATION
// ============================================

function getFixtureDisplayRgb(fixture) {
    const profile = FixtureManager.getProfile(fixture.profileId);
    if (profile && profile.hasColorPicker && !profile.hasZonePickers) {
        return FixtureManager.getFixtureRGB(fixture.id);
    }
    return null;
}

function propagateSpotLinkFromFixture(groupFixtures, sourceIdx, rgb) {
    const fixture = groupFixtures[sourceIdx];
    const info = FixtureManager.getSpotLinkGroup(fixture.id);
    if (!info) return;

    const links = info.links;
    if (links.lall) {
        groupFixtures.forEach((f, i) => {
            if (i !== sourceIdx) setSpotColorFromRgb(f, rgb);
        });
    } else {
        if (links.l12) {
            if (sourceIdx === 0 && groupFixtures[1]) setSpotColorFromRgb(groupFixtures[1], rgb);
            if (sourceIdx === 1 && groupFixtures[0]) setSpotColorFromRgb(groupFixtures[0], rgb);
        }
        if (links.l23) {
            if (sourceIdx === 1 && groupFixtures[2]) setSpotColorFromRgb(groupFixtures[2], rgb);
            if (sourceIdx === 2 && groupFixtures[1]) setSpotColorFromRgb(groupFixtures[1], rgb);
        }
        if (links.l34) {
            if (sourceIdx === 2 && groupFixtures[3]) setSpotColorFromRgb(groupFixtures[3], rgb);
            if (sourceIdx === 3 && groupFixtures[2]) setSpotColorFromRgb(groupFixtures[2], rgb);
        }
    }
}

function setSpotColorFromRgb(fixture, rgb) {
    FixtureManager.setFixtureColor(fixture.id, rgb.r, rgb.g, rgb.b);
    const card = document.getElementById('fixture-' + fixture.id);
    if (card) {
        card.style.setProperty('--fixture-color', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        const el = document.getElementById('fixtureColor-' + fixture.id);
        if (el) {
            isAutoUpdating = true;
            el.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            isAutoUpdating = false;
        }
    }
}

function openFixturePanel(fixtureId) {
    const fixture = FixtureManager.getFixtures().find(f => f.id === fixtureId);
    if (!fixture) return;
    currentPanelFixtureId = fixtureId;
    const profile = FixtureManager.getProfile(fixture.profileId);
    const panel = document.getElementById('fixturePanel');
    const body = document.getElementById('fixturePanelBody');
    const nameEl = document.getElementById('fixturePanelName');
    const chInfoEl = document.getElementById('fixturePanelChInfo');

    nameEl.textContent = fixture.name;
    chInfoEl.textContent = `DMX ${fixture.startChannel} → ${fixture.startChannel + fixture.channels - 1} (${fixture.channels} ch)`;
    body.innerHTML = '';

    document.querySelectorAll('.card-fixture').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById('fixture-' + fixtureId);
    if (card) card.classList.add('selected');

    // Sliders for ALL channels
    for (let i = 0; i < fixture.channels; i++) {
        const ctrl = (profile && profile.controls) ? profile.controls.find(c => c.offset === i) : null;
        const name = ctrl ? ctrl.name : `Ch ${fixture.startChannel + i}`;
        const sliderDiv = document.createElement('div');
        sliderDiv.style.flex = '0 1 200px';
        sliderDiv.innerHTML = `
            <label class="slider-label">${escapeHtml(name)} <small style="opacity:0.5">(ch${fixture.startChannel + i})</small></label>
            <div style="display:flex;align-items:center;gap:4px">
                <input type="range" min="0" max="255" value="${fixture.channelValues[i] || 0}"
                       data-fixture="${fixture.id}" data-offset="${i}" style="flex:1">
                <button class="slider-zero-btn" data-fixture="${fixture.id}" data-offset="${i}" title="Mettre à 0"
                        style="background:none;border:1px solid rgba(255,255,255,0.2);color:#e0e0e0;border-radius:3px;cursor:pointer;font-size:10px;padding:2px 5px;min-width:20px">0</button>
            </div>
        `;
        body.appendChild(sliderDiv);
        sliderDiv.querySelector('input[type="range"]').addEventListener('input', (e) => {
            FixtureManager.setChannelValue(fixture.id, i, parseInt(e.target.value));
        });
        sliderDiv.querySelector('.slider-zero-btn').addEventListener('click', (e) => {
            FixtureManager.setChannelValue(fixture.id, i, 0);
            const range = sliderDiv.querySelector('input[type="range"]');
            if (range) range.value = 0;
        });
    }

    panel.classList.remove('hidden');
}

function closeFixturePanel() {
    const panel = document.getElementById('fixturePanel');
    panel.classList.add('hidden');
    document.querySelectorAll('.card-fixture').forEach(c => c.classList.remove('selected'));
    currentPanelFixtureId = null;
}

function removeFixtureCard(id) {
    const card = document.getElementById('fixture-' + id);
    if (card) card.remove();
}

function syncCardValues(fixture, card) {
    const profile = FixtureManager.getProfile(fixture.profileId);
    if (profile && profile.controls) {
        profile.controls.forEach(ctrl => {
            const slider = card.querySelector(`input[data-offset="${ctrl.offset}"]`);
            if (slider) slider.value = fixture.channelValues[ctrl.offset];
        });
    }
    if (profile && profile.hasZonePickers) {
        const zoneCount = Math.floor(fixture.channels / 3);
        for (let z = 0; z < zoneCount; z++) {
            const el = document.getElementById('fixtureZone-' + fixture.id + '-z' + z);
            if (el) {
                isAutoUpdating = true;
                el.value = `rgb(${fixture.channelValues[(zoneCount-1-z)*3]||0}, ${fixture.channelValues[(zoneCount-1-z)*3+1]||0}, ${fixture.channelValues[(zoneCount-1-z)*3+2]||0})`;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                isAutoUpdating = false;
            }
        }
    }
    if (profile && profile.hasColorPicker && !profile.hasZonePickers) {
        const el = document.getElementById('fixtureColor-' + fixture.id);
        if (el) {
            const rgb = FixtureManager.getFixtureRGB(fixture.id);
            if (rgb) {
                isAutoUpdating = true;
                el.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                isAutoUpdating = false;
            }
        }
    }
}

function updateFixtureColorDisplay(fixture) {
    const profile = FixtureManager.getProfile(fixture.profileId);
    if (profile && profile.hasZonePickers) {
        const zoneCount = Math.floor(fixture.channels / 3);
        for (let z = 0; z < zoneCount; z++) {
            const el = document.getElementById('fixtureZone-' + fixture.id + '-z' + z);
            if (el) {
                isAutoUpdating = true;
                el.value = `rgb(${fixture.channelValues[(zoneCount-1-z)*3]||0}, ${fixture.channelValues[(zoneCount-1-z)*3+1]||0}, ${fixture.channelValues[(zoneCount-1-z)*3+2]||0})`;
                isAutoUpdating = false;
            }
        }
        return;
    }
    const el = document.getElementById('fixtureColor-' + fixture.id);
    if (!el) return;
    const rgb = FixtureManager.getFixtureRGB(fixture.id);
    if (rgb) { isAutoUpdating = true; el.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`; isAutoUpdating = false; }
}

// ============================================
// ADD FIXTURE MODAL
// ============================================

const CHANNEL_ROLES = [
    { value: 'none', label: '— Non utilisé —' },
    { value: 'rouge', label: 'Rouge' },
    { value: 'vert', label: 'Vert' },
    { value: 'bleu', label: 'Bleu' },
    { value: 'blanc', label: 'Blanc' },
    { value: 'dimmer', label: 'Dimmer' },
    { value: 'flash', label: 'Flash' },
    { value: 'pan', label: 'Pan' },
    { value: 'tilt', label: 'Tilt' },
    { value: 'vitesse', label: 'Vitesse' },
    { value: 'couleur', label: 'Couleur' },
    { value: 'gobo', label: 'Gobo' },
    { value: 'prisme', label: 'Prisme' },
    { value: 'mode', label: 'Mode' }
];

function setupAddFixtureModal() {
    const modal = document.getElementById('addFixtureModal');
    document.getElementById('btnAddFixture').addEventListener('click', openAddFixtureModal);
    document.getElementById('closeAddFixture').addEventListener('click', () => modal.style.display = 'none');
    document.getElementById('btnCancelAddFixture').addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    document.getElementById('fixtureProfile').addEventListener('change', (e) => {
        const profile = FixtureManager.getProfile(e.target.value);
        if (profile) {
            document.getElementById('fixtureChannels').value = profile.channels;
        }
        updateNextAvailable();
    });
    document.getElementById('fixtureChannels').addEventListener('input', () => {
        updateNextAvailable();
    });
    document.getElementById('fixtureStartChannel').addEventListener('input', () => {
        updateNextAvailable();
        if (document.getElementById('fixtureProfile').value === 'custom') {
            const count = parseInt(document.getElementById('fixtureChannels').value) || 0;
            const startCh = parseInt(document.getElementById('fixtureStartChannel').value) || 1;
            document.querySelectorAll('#channelRolesList .ch-dmx').forEach((el, i) => {
                el.textContent = 'DMX ' + (startCh + i);
            });
        }
    });
    document.getElementById('btnConfirmAddFixture').addEventListener('click', addNewFixture);
}

function buildChannelRoles(count) {
    const list = document.getElementById('channelRolesList');
    const startCh = parseInt(document.getElementById('fixtureStartChannel').value) || 1;
    list.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'channel-role-row';
        const num = document.createElement('span');
        num.className = 'ch-num';
        num.textContent = 'Canal ' + (i + 1);
        const dmx = document.createElement('span');
        dmx.className = 'ch-dmx';
        dmx.textContent = 'DMX ' + (startCh + i);
        const sel = document.createElement('select');
        sel.dataset.offset = i;
        CHANNEL_ROLES.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.value;
            opt.textContent = r.label;
            sel.appendChild(opt);
        });
        row.appendChild(num);
        row.appendChild(dmx);
        row.appendChild(sel);
        list.appendChild(row);
    }
}

function getChannelRolesFromUI() {
    const roles = [];
    document.querySelectorAll('#channelRolesList select').forEach(sel => {
        roles.push({ offset: parseInt(sel.dataset.offset), role: sel.value });
    });
    return roles;
}

function buildCustomProfile(name, channelCount, channelRoles) {
    const roleToName = {
        rouge: 'Rouge', vert: 'Vert', bleu: 'Bleu', blanc: 'Blanc',
        dimmer: 'Dimmer', flash: 'Flash', pan: 'Pan', tilt: 'Tilt',
        vitesse: 'Vitesse', couleur: 'Couleur', gobo: 'Gobo',
        prisme: 'Prisme', mode: 'Mode'
    };
    const controls = [];
    let hasColorPicker = false;
    channelRoles.forEach(cr => {
        if (cr.role === 'none') return;
        const isColor = ['rouge', 'vert', 'bleu'].includes(cr.role);
        controls.push({
            name: roleToName[cr.role] || cr.role,
            type: isColor ? 'channel' : 'slider',
            offset: cr.offset,
            min: 0,
            max: 255
        });
        if (isColor) hasColorPicker = true;
    });
    const sortedColors = channelRoles.filter(r => ['rouge', 'vert', 'bleu'].includes(r.role)).sort((a, b) => a.offset - b.offset);
    let rgbGroups = 0;
    let seen = { rouge: false, vert: false, bleu: false };
    sortedColors.forEach(cr => {
        seen[cr.role] = true;
        if (seen.rouge && seen.vert && seen.bleu) {
            rgbGroups++;
            seen = { rouge: false, vert: false, bleu: false };
        }
    });
    const profile = {
        id: 'custom_' + Date.now().toString(36),
        name: name,
        channels: channelCount,
        controls: controls,
        hasColorPicker: rgbGroups <= 1,
        hasZonePickers: rgbGroups >= 2
    };
    FixtureManager.addCustomProfile(profile);
    return profile.id;
}

function openAddFixtureModal() {
    const modal = document.getElementById('addFixtureModal');
    updateAddFixtureProfileDropdown();
    document.getElementById('fixtureName').value = '';
    document.getElementById('fixtureChannels').value = 3;
    document.getElementById('fixtureStartChannel').value = FixtureManager.getNextAvailableChannel();
    document.getElementById('fixtureColor').value = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
    document.getElementById('fixtureQuantity').value = 1;
    document.getElementById('customChannelsGroup').style.display = 'none';
    document.getElementById('customChannelRoles').style.display = 'none';
    const profileSelect = document.getElementById('fixtureProfile');
    if (profileSelect.options.length > 0) {
        const firstProfile = FixtureManager.getProfile(profileSelect.value);
        if (firstProfile) document.getElementById('fixtureChannels').value = firstProfile.channels;
    }
    updateNextAvailable();
    modal.style.display = 'block';
    modal.style.zIndex = '2500';
    if (window.Coloris) try { window.Coloris.close(); } catch(e) {}
    setTimeout(() => {
        const el = document.getElementById('fixtureName');
        el.focus();
        el.select();
        el.click();
    }, 80);
}

function updateNextAvailable() {
    const hint = document.getElementById('nextAvailableChannel');
    const startInput = document.getElementById('fixtureStartChannel');
    const next = FixtureManager.getNextAvailableChannel();
    hint.textContent = `Prochain canal disponible: ${next}`;
    if (parseInt(startInput.value) < next) startInput.value = next;
}

function addNewFixture() {
    markDirty();
    const baseName = document.getElementById('fixtureName').value.trim();
    const profileId = document.getElementById('fixtureProfile').value;
    const channels = parseInt(document.getElementById('fixtureChannels').value);
    const startChannel = parseInt(document.getElementById('fixtureStartChannel').value);
    const color = document.getElementById('fixtureColor').value;
    const quantity = Math.max(1, parseInt(document.getElementById('fixtureQuantity').value) || 1);
    if (!baseName) { showToast('Entrez un nom'); return; }
    if (!profileId) { showToast('Sélectionnez un profil'); return; }
    if (channels < 1 || channels > 512) { showToast('Nombre de canaux invalide'); return; }
    let added = 0;
    let ch = startChannel;
    for (let i = 0; i < quantity; i++) {
        const name = quantity > 1 ? baseName + ' ' + (i + 1) : baseName;
        if (!FixtureManager.isChannelRangeFree(ch, channels)) {
            showToast('Conflit de canaux au canal ' + ch + ' — arrêt à ' + added + '/' + quantity);
            break;
        }
        FixtureManager.addFixture({ name, profileId, channels, startChannel: ch, color });
        ch += channels;
        added++;
    }
    document.getElementById('addFixtureModal').style.display = 'none';
    showToast(added + ' appareil' + (added > 1 ? 's ajoutés' : ' ajouté'));
}

// ============================================
// PROFILE EDITOR
// ============================================

let currentEditProfileId = null;

function setupProfileEditor() {
    document.getElementById('closeProfileEditor').addEventListener('click', () => {
        document.getElementById('profileEditorModal').style.display = 'none';
    });
    document.getElementById('btnNewProfile').addEventListener('click', profileEditorNew);
    document.getElementById('btnSaveProfile').addEventListener('click', profileEditorSave);
    document.getElementById('btnDuplicateProfile').addEventListener('click', profileEditorDuplicate);
    document.getElementById('btnDeleteProfile').addEventListener('click', profileEditorDelete);
    document.getElementById('profileEditorChannels').addEventListener('input', (e) => {
        if (currentEditProfileId && FixtureManager.isCustomProfile(currentEditProfileId)) {
            buildProfileEditorRoles(parseInt(e.target.value) || 3, currentEditProfileId);
        }
    });
}

function openProfileEditor() {
    if (window.Coloris) try { window.Coloris.close(); } catch(e) {}
    document.getElementById('profileEditorModal').style.display = 'block';
    renderProfileEditorList();
    const profiles = FixtureManager.getProfiles();
    if (profiles.length > 0) selectProfileForEdit(profiles[0].id);
}

function renderProfileEditorList() {
    const list = document.getElementById('profileList');
    list.innerHTML = '';
    FixtureManager.getProfiles().forEach(p => {
        const div = document.createElement('div');
        div.className = 'profile-editor-item' + (p.id === currentEditProfileId ? ' selected' : '');
        const isCustom = FixtureManager.isCustomProfile(p.id);
        div.innerHTML = '<span>' + escapeHtml(p.name) + ' <small style="color:var(--text-muted)">' + p.channels + 'ch</small></span>' +
            (isCustom ? '<span class="badge custom">Custom</span>' : '<span class="badge">Built-in</span>');
        div.addEventListener('click', () => selectProfileForEdit(p.id));
        list.appendChild(div);
    });
}

function selectProfileForEdit(profileId) {
    currentEditProfileId = profileId;
    const profile = FixtureManager.getProfile(profileId);
    if (!profile) return;
    const isCustom = FixtureManager.isCustomProfile(profileId);
    document.getElementById('profileEditorName').value = profile.name;
    document.getElementById('profileEditorChannels').value = profile.channels;
    document.getElementById('profileEditorName').disabled = !isCustom;
    document.getElementById('profileEditorChannels').disabled = !isCustom;
    document.getElementById('btnDeleteProfile').style.display = isCustom ? '' : 'none';
    buildProfileEditorRoles(profile.channels, profileId);
    renderProfileEditorList();
}

function buildProfileEditorRoles(count, profileId) {
    const container = document.getElementById('profileEditorRoles');
    const profile = profileId ? FixtureManager.getProfile(profileId) : null;
    const CHANNEL_ROLES = [
        { value: 'none', label: '— Non utilisé —' },
        { value: 'rouge', label: 'Rouge' }, { value: 'vert', label: 'Vert' },
        { value: 'bleu', label: 'Bleu' }, { value: 'blanc', label: 'Blanc' },
        { value: 'dimmer', label: 'Dimmer' }, { value: 'flash', label: 'Flash' },
        { value: 'pan', label: 'Pan' }, { value: 'tilt', label: 'Tilt' },
        { value: 'vitesse', label: 'Vitesse' }, { value: 'couleur', label: 'Couleur' },
        { value: 'gobo', label: 'Gobo' }, { value: 'prisme', label: 'Prisme' },
        { value: 'mode', label: 'Mode' }
    ];
    const nameToRole = { Rouge: 'rouge', Vert: 'vert', Bleu: 'bleu', Blanc: 'blanc', Dimmer: 'dimmer', Flash: 'flash', Pan: 'pan', Tilt: 'tilt', Vitesse: 'vitesse', Couleur: 'couleur', Gobo: 'gobo', Prisme: 'prisme', Mode: 'mode' };

    function resolveRole(ctrlName) {
        if (nameToRole[ctrlName]) return nameToRole[ctrlName];
        const stripped = ctrlName.replace(/^Z\d+\s*/i, '');
        if (nameToRole[stripped]) return nameToRole[stripped];
        for (const [key, val] of Object.entries(nameToRole)) {
            if (ctrlName.toLowerCase().includes(key.toLowerCase())) return val;
        }
        return null;
    }

    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
        const chNum = document.createElement('span');
        chNum.style.cssText = 'min-width:30px;font-size:0.8rem;color:var(--text-muted);';
        chNum.textContent = 'Ch ' + (i + 1);
        const dmx = document.createElement('span');
        dmx.style.cssText = 'min-width:50px;font-size:0.75rem;color:var(--text-muted);';
        dmx.textContent = 'DMX ?';
        const sel = document.createElement('select');
        sel.style.cssText = 'flex:1;background:var(--input-bg);border:1px solid var(--input-border);color:#fff;border-radius:4px;padding:4px;font-size:0.8rem;';
        sel.dataset.offset = i;
        CHANNEL_ROLES.forEach(cr => {
            const opt = document.createElement('option');
            opt.value = cr.value;
            opt.textContent = cr.label;
            sel.appendChild(opt);
        });
        if (profile && profile.controls) {
            const ctrl = profile.controls.find(c => c.offset === i);
            if (ctrl) {
                sel.value = resolveRole(ctrl.name) || 'none';
                dmx.textContent = 'DMX ' + (i + 1);
            }
        }
        sel.addEventListener('change', () => {
            dmx.textContent = sel.value !== 'none' ? 'DMX ' + (i + 1) : 'DMX ?';
        });
        row.appendChild(chNum);
        row.appendChild(dmx);
        row.appendChild(sel);
        container.appendChild(row);
    }
}

function getProfileEditorRoles() {
    const roles = [];
    document.querySelectorAll('#profileEditorRoles select').forEach(sel => {
        roles.push({ offset: parseInt(sel.dataset.offset), role: sel.value });
    });
    return roles;
}

function profileEditorNew() {
    currentEditProfileId = null;
    document.getElementById('profileEditorName').value = '';
    document.getElementById('profileEditorName').disabled = false;
    document.getElementById('profileEditorChannels').value = 8;
    document.getElementById('profileEditorChannels').disabled = false;
    document.getElementById('btnDeleteProfile').style.display = 'none';
    buildProfileEditorRoles(8, null);
    renderProfileEditorList();
    document.getElementById('profileEditorName').focus();
}

function profileEditorSave() {
    const name = document.getElementById('profileEditorName').value.trim();
    const channels = parseInt(document.getElementById('profileEditorChannels').value);
    const roles = getProfileEditorRoles();
    if (!name) { showToast('Entrez un nom'); return; }
    if (channels < 1 || channels > 512) { showToast('Nombre de canaux invalide'); return; }
    const roleToName = { rouge: 'Rouge', vert: 'Vert', bleu: 'Bleu', blanc: 'Blanc', dimmer: 'Dimmer', flash: 'Flash', pan: 'Pan', tilt: 'Tilt', vitesse: 'Vitesse', couleur: 'Couleur', gobo: 'Gobo', prisme: 'Prisme', mode: 'Mode' };

    const sortedColorRoles = roles.filter(r => ['rouge', 'vert', 'bleu'].includes(r.role)).sort((a, b) => a.offset - b.offset);
    let rgbGroups = 0;
    let seen = { rouge: false, vert: false, bleu: false };
    let rgbZoneMap = {};
    sortedColorRoles.forEach(cr => {
        seen[cr.role] = true;
        rgbZoneMap[cr.offset] = rgbGroups;
        if (seen.rouge && seen.vert && seen.bleu) {
            rgbGroups++;
            seen = { rouge: false, vert: false, bleu: false };
        }
    });

    const controls = [];
    roles.forEach(cr => {
        if (cr.role === 'none') return;
        const isColor = ['rouge', 'vert', 'bleu'].includes(cr.role);
        let ctrlName = roleToName[cr.role] || cr.role;
        if (isColor && rgbGroups >= 2 && rgbZoneMap[cr.offset] !== undefined) {
            ctrlName = 'Z' + (rgbZoneMap[cr.offset] + 1) + ' ' + ctrlName;
        }
        controls.push({ name: ctrlName, type: isColor ? 'channel' : 'slider', offset: cr.offset, min: 0, max: 255 });
    });
    const hasZonePickers = rgbGroups >= 2;
    const hasColorPicker = rgbGroups === 1 || (!hasZonePickers && controls.some(c => c.type === 'channel'));

    if (currentEditProfileId && FixtureManager.isCustomProfile(currentEditProfileId)) {
        FixtureManager.updateCustomProfile(currentEditProfileId, { name, channels, controls, hasColorPicker, hasZonePickers });
        showToast('Profil mis à jour : ' + name);
    } else {
        const newProfile = {
            id: 'custom_' + Date.now().toString(36),
            name, channels, controls, hasColorPicker, hasZonePickers
        };
        FixtureManager.addCustomProfile(newProfile);
        currentEditProfileId = newProfile.id;
        showToast('Profil créé : ' + name);
    }
    renderProfileEditorList();
    updateAddFixtureProfileDropdown();
}

function profileEditorDuplicate() {
    const profile = FixtureManager.getProfile(currentEditProfileId);
    if (!profile) return;
    const newProfile = {
        id: 'custom_' + Date.now().toString(36),
        name: profile.name + ' (copie)',
        channels: profile.channels,
        controls: JSON.parse(JSON.stringify(profile.controls)),
        hasColorPicker: profile.hasColorPicker,
        hasZonePickers: profile.hasZonePickers
    };
    FixtureManager.addCustomProfile(newProfile);
    currentEditProfileId = newProfile.id;
    selectProfileForEdit(newProfile.id);
    showToast('Profil dupliqué');
    updateAddFixtureProfileDropdown();
}

function profileEditorDelete() {
    if (!currentEditProfileId || !FixtureManager.isCustomProfile(currentEditProfileId)) return;
    const usingFixtures = FixtureManager.getFixturesUsingProfile(currentEditProfileId);
    if (usingFixtures.length > 0) {
        showToast('Profil utilisé par ' + usingFixtures.length + ' appareil(s) — supprimez-les d\'abord');
        return;
    }
    const profile = FixtureManager.getProfile(currentEditProfileId);
    if (!confirm('Supprimer le profil "' + (profile ? profile.name : '') + '" ?')) return;
    FixtureManager.removeCustomProfile(currentEditProfileId);
    currentEditProfileId = null;
    renderProfileEditorList();
    const profiles = FixtureManager.getProfiles();
    if (profiles.length > 0) selectProfileForEdit(profiles[0].id);
    showToast('Profil supprimé');
    updateAddFixtureProfileDropdown();
}

function updateAddFixtureProfileDropdown() {
    const select = document.getElementById('fixtureProfile');
    if (!select) return;
    select.innerHTML = '';
    FixtureManager.getProfiles().forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        const hasChSuffix = /\(\d+ch\)\s*$/.test(p.name);
        opt.textContent = hasChSuffix ? p.name : p.name + ' (' + p.channels + 'ch)';
        select.appendChild(opt);
    });
}

// ============================================
// NAVBAR BUTTONS
// ============================================

function setupNavbarButtons() {
    document.getElementById('btnSaveCurrentSong').addEventListener('click', saveCurrentSong);
    document.getElementById('btnSaveNewSong').addEventListener('click', saveNewSong);
    document.getElementById('btnWave').addEventListener('click', toggleWave);
    document.getElementById('btnFlash').addEventListener('click', toggleFlash);
    document.getElementById('starEnabled').addEventListener('change', () => {
        document.getElementById('starFreqGroup').style.display = document.getElementById('starEnabled').checked ? '' : 'none';
    });
    document.getElementById('waveColorEnabled').addEventListener('change', () => {
        document.getElementById('waveColorGroup').style.display = document.getElementById('waveColorEnabled').checked ? '' : 'none';
    });
}

function setupNativeMenus() {
    if (!window.electronAPI) return;
    window.electronAPI.onMenu('menu:new-set', handleNewSet);
    window.electronAPI.onMenu('menu:copy', copySpotColors);
    window.electronAPI.onMenu('menu:paste', pasteSpotColors);
    window.electronAPI.onMenu('menu:show-help', () => {
        document.getElementById('helpModal').style.display = 'block';
    });
    window.electronAPI.onMenu('menu:options', () => {
        openOptionsModal();
    });
    window.electronAPI.onMenu('menu:profiles', () => {
        openProfileEditor();
    });

    // Fallback renderer accelerators (si menu principal ne capte pas)
    document.addEventListener('keydown', (e) => {
        const isMod = e.ctrlKey || e.metaKey;
        if (!isMod) return;
        const key = e.key.toLowerCase();
        const active = document.activeElement;
        const isTextInput = active && active.tagName === 'INPUT' && active.type === 'text';
        const hasSelection = isTextInput && active.selectionStart !== active.selectionEnd;
        if (key === 'c' && !e.shiftKey && !hasSelection) {
            e.preventDefault();
            copySpotColors();
        } else if (key === 'v' && !e.shiftKey) {
            // laisser coller texte si input a focus et attente texte, mais notre paste est état DMX
            // on priorise l'état si aucun texte sélectionné à coller n'est attendu
            if (isTextInput && document.activeElement === active && !e.shiftKey) {
                // si input texte a le focus, on ne bloque que si l'utilisateur veut coller un état (pas de texte)
                // on laisse passer si l'input est promptModal (saisie nom) : ne pas interférer
                if (active.id === 'promptInput' || active.id === 'fixtureName') return;
            }
            e.preventDefault();
            pasteSpotColors();
        } else if (key === 'n' && !e.shiftKey) {
            e.preventDefault();
            handleNewSet();
        } else if (key === '/' && isMod) {
            e.preventDefault();
            document.getElementById('helpModal').style.display = 'block';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const key = e.key.toLowerCase();
        switch (key) {
            case 'w': e.preventDefault(); toggleWave(); break;
            case 'e': e.preventDefault(); document.getElementById('starEnabled').click(); break;
            case 'c': e.preventDefault(); document.getElementById('waveColorEnabled').click(); break;
            case 'f': e.preventDefault(); toggleFlash(); break;
            case 't': e.preventDefault(); handleTapTempo(); break;
            case 'h': e.preventDefault(); document.getElementById('helpModal').style.display = 'block'; break;
            case ' ': e.preventDefault(); allBlack(); break;
        }
    });

    // File operations
    window.electronAPI.file.onLoaded((data) => {
        if (data && data.fixtures) {
            loadSetData(data);
            if (data.playlist) {
                playlist = data.playlist;
                savePlaylist();
            }
            renderPlaylist();
            restoreSidebarState();
            if (playlist.length > 0) {
                liveLoadSong(0);
            } else {
                allBlack();
            }
            showToast('Fichier chargé');
        }
    });
    window.electronAPI.file.onRequestSave((filePath) => {
        const data = getCurrentSetData();
        data.playlist = playlist;
        window.electronAPI.file.save(data).then(result => {
            if (result.success) showToast('Enregistré: ' + filePath.split(/[/\\]/).pop());
            else showToast('Erreur: ' + result.error);
        });
    });

    let autoSaveTimer = null;
    window._autoSave = function() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            window.electronAPI.file.getCurrentPath().then(result => {
                if (result && result.path) {
                    const data = getCurrentSetData();
                    data.playlist = playlist;
                    window.electronAPI.file.save(data).then(() => { isDirty = false; });
                }
            });
        }, 3000);
    };

    // Load last file on startup
    window.electronAPI.file.getLast().then(result => {
        if (result && result.data && result.data.fixtures) {
            loadSetData(result.data);
            if (result.data.playlist) {
                playlist = result.data.playlist;
                savePlaylist();
            }
            renderPlaylist();
            restoreSidebarState();
            if (playlist.length > 0) {
                liveLoadSong(0);
            } else {
                allBlack();
            }
        } else {
            allBlack();
        }
    });
    document.getElementById('closeHelp').addEventListener('click', () => {
        document.getElementById('helpModal').style.display = 'none';
    });
    const btnMidiPdf = document.getElementById('btnMidiPdf');
    if (btnMidiPdf) btnMidiPdf.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.openMidiPdf) window.electronAPI.openMidiPdf();
    });
    document.getElementById('helpModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('helpModal')) {
            document.getElementById('helpModal').style.display = 'none';
        }
    });
}

function handleNewSet() {
    if (!confirm('Créer un nouveau set ? Toutes les données actuelles seront effacées.')) return;
    FixtureManager.clearAll();
    localStorage.removeItem('dmx2_scenes_v3');
    localStorage.removeItem('dmx2_scenes_v2');
    localStorage.removeItem('dmx2_playlist');
    for (let i = 0; i < SCENE_REGULAR_COUNT; i++) scenes[i] = null;
    for (let i = 0; i < SCENE_MOMENTARY_COUNT; i++) momentanes[i] = null;
    playlist = [];
    currentSongIndex = -1;
    updateCurrentSongDisplay();
    renderAllFixtures();
    renderGroupToolbar();
    updateSlidersVisibility();
    restoreAllSceneButtons();
    renderPlaylist();
    renderLiveButtons();
    updateLiveDisplay();
    allBlack();
    if (window.electronAPI) window.electronAPI.file.setCurrentPath(null);
    showToast('Nouveau set créé');
}

function copySpotColors() {
    // Copie l'état complet des couleurs (RGB + zones) pour collage sur scène
    spotColorsCopy = FixtureManager.getFixtures().map(f => ({
        id: f.id,
        values: Array.from(f.channelValues)
    }));
    showToast('État copié (' + spotColorsCopy.length + ' appareils)');
}

function pasteSpotColors() {
    if (!spotColorsCopy || spotColorsCopy.length === 0) { showToast('Rien à coller'); return; }
    spotColorsCopy.forEach(entry => {
        const fixture = FixtureManager.getFixture(entry.id);
        if (!fixture) return;
        entry.values.forEach((val, idx) => {
            if (idx < fixture.channels) FixtureManager.setChannelValue(fixture.id, idx, val);
        });
    });
    // refresh visuels et DMX après collage
    updateAllFixtureDisplays();
    renderGroupToolbar();
    updateSlidersVisibility();
    sendDMXBuffer();
    showToast('État collé - sauvegarde-le sur une scène');
}

// ============================================
// GROUP TOOLBAR
// ============================================

function setupGroupToolbar() {
    // Init the "All" color picker
    const allPicker = document.getElementById('groupColorAll');
    if (allPicker) {
        Coloris({ el: allPicker, theme: 'pill', themeMode: 'dark', formatToggle: true, closeButton: false, clearButton: false, flat: true, showInput: true });
        allPicker.addEventListener('input', (e) => {
            if (isAutoUpdating) return;
            const rgb = parseRGB(e.target.value);
            FixtureManager.setAllRGB(rgb.r, rgb.g, rgb.b);
            updateAllFixtureDisplays();
            sendDMXBuffer();
        });
    }
}

function renderGroupToolbar() {
    const container = document.getElementById('groupToolbarItems');
    container.innerHTML = '';
    FixtureManager.getGroups().forEach((group, idx) => {
        const item = document.createElement('div');
        item.className = 'group-toolbar-item';
        const label = document.createElement('label');
        label.className = 'group-toolbar-label';
        label.textContent = group.name;
        const picker = document.createElement('input');
        picker.type = 'text';
        picker.className = 'coloris instance1 group-color-pick';
        picker.id = 'groupPick-' + group.id;
        picker.value = group.color || '#00b4dc';
        item.appendChild(label);
        item.appendChild(picker);
        container.appendChild(item);
        picker.addEventListener('input', (e) => {
            if (isAutoUpdating) return;
            const rgb = parseRGB(e.target.value);
            FixtureManager.setGroupColor(group.id, rgb.r, rgb.g, rgb.b);
        });
        setTimeout(() => reinitColorisInstance('#groupPick-' + group.id), 50 + idx * 20);
    });
}

// ============================================
// MANAGE GROUPS MODAL
// ============================================


// ============================================
// SCENES (10 regular + 4 momentanés)
// ============================================

const SCENE_REGULAR_COUNT = 32;
const SCENE_MOMENTARY_COUNT = 4;
const SCENE_STORAGE_KEY = 'dmx2_scenes_v3';

const scenes = new Array(SCENE_REGULAR_COUNT).fill(null);
const momentanes = new Array(SCENE_MOMENTARY_COUNT).fill(null);

let momentaryPreState = null;
let momentaryActiveIndex = -1;
let momentaryFadeId = null;

function setupSceneGrid() {
    const sceneAll = document.getElementById('sceneAll');
    sceneAll.innerHTML = '';

    function createSceneBtn(i) {
        const btn = document.createElement('button');
        btn.className = 'btn-scene btn-scene-regular';
        btn.id = 'scene-regular-' + i;
        btn.dataset.index = i;
        const numSpan = document.createElement('span');
        numSpan.className = 'scene-btn-num';
        numSpan.textContent = (i + 1).toString();
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'scene-btn-trans';
        input.id = 'scene-trans-' + i;
        input.min = '0';
        input.max = '30';
        input.step = '0.1';
        input.value = '2';
        input.title = 'Transition (s)';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (scenes[i]) scenes[i].transition = isNaN(v) ? 2 : Math.max(0, Math.min(30, v));
            saveScenes();
        });
        btn.appendChild(numSpan);
        btn.appendChild(input);
        btn.addEventListener('click', (e) => handleSceneClick(e, i));
        return btn;
    }

    function createSmallSceneBtn(i) {
        const btn = document.createElement('button');
        btn.className = 'btn-scene btn-scene-small';
        btn.id = 'scene-regular-' + i;
        btn.dataset.index = i;
        const numSpan = document.createElement('span');
        numSpan.className = 'scene-btn-num';
        numSpan.textContent = (i + 1).toString();
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'scene-btn-trans';
        input.id = 'scene-trans-' + i;
        input.min = '0';
        input.max = '30';
        input.step = '0.1';
        input.value = '2';
        input.title = 'Transition (s)';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('change', () => {
            const v = parseFloat(input.value);
            if (scenes[i]) scenes[i].transition = isNaN(v) ? 2 : Math.max(0, Math.min(30, v));
            saveScenes();
        });
        btn.appendChild(numSpan);
        btn.appendChild(input);
        btn.addEventListener('click', (e) => handleSceneClick(e, i));
        return btn;
    }

    function createMomentaryBtn(i) {
        const btn = document.createElement('button');
        btn.className = 'btn-scene btn-scene-momentane';
        btn.id = 'scene-momentane-' + i;
        btn.dataset.index = i;
        const numSpan = document.createElement('span');
        numSpan.className = 'scene-btn-num';
        numSpan.textContent = 'M' + (i + 1);
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'scene-btn-trans';
        input.id = 'momentane-trans-' + i;
        input.min = '0';
        input.max = '30';
        input.step = '0.05';
        input.value = '0.15';
        input.title = 'Retour (s)';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.appendChild(numSpan);
        btn.appendChild(input);
        btn.addEventListener('click', (e) => handleSceneClick(e, i, true));
        btn.addEventListener('mousedown', (e) => handleMomentaneDown(e, i));
        btn.addEventListener('mouseup', (e) => handleMomentaneUp(e, i));
        btn.addEventListener('mouseleave', (e) => {
            if (momentaryActiveIndex === i) handleMomentaneUp(e, i);
        });
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); handleMomentaneDown(e, i); }, { passive: false });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); handleMomentaneUp(e, i); });
        return btn;
    }

    const row1 = document.createElement('div');
    row1.className = 'scene-row';
    for (let i = 0; i < 14; i++) row1.appendChild(createSceneBtn(i));
    const sep1 = document.createElement('div');
    sep1.className = 'scene-separator';
    row1.appendChild(sep1);
    for (let i = 14; i < 18; i++) row1.appendChild(createSmallSceneBtn(i));
    sceneAll.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'scene-row';
    for (let i = 18; i < 32; i++) row2.appendChild(createSceneBtn(i));
    const sep2 = document.createElement('div');
    sep2.className = 'scene-separator';
    row2.appendChild(sep2);
    for (let i = 0; i < SCENE_MOMENTARY_COUNT; i++) row2.appendChild(createMomentaryBtn(i));
    sceneAll.appendChild(row2);

    document.addEventListener('mouseup', () => {
        if (momentaryActiveIndex >= 0) handleMomentaneUp({}, momentaryActiveIndex);
    });

    loadScenes();
    restoreAllSceneButtons();
    setupMIDI();
}

function handleSceneClick(e, index, isMomentary) {
    const btn = e.target.closest('.btn-scene');

    if (isMomentary) {
        if (e.ctrlKey || e.metaKey) { saveMomentary(index); return; }
        if (e.shiftKey) { deleteMomentary(index); return; }
        return;
    }

    const scene = scenes[index];

    if ((e.ctrlKey || e.metaKey) && e.shiftKey) { saveScene(index); return; }
    if (e.ctrlKey || e.metaKey) { saveScene(index, true); return; }
    if (e.shiftKey) { deleteScene(index); return; }

    if (!scene) { showToast('Scène vide'); return; }

    document.querySelectorAll('.btn-scene-regular, .btn-scene-small').forEach(b => b.classList.remove('selected'));
    if (btn) btn.classList.add('selected');
    restoreSceneState(scene);
    const transInput = document.getElementById('scene-trans-' + index);
    const duration = transInput ? (parseFloat(transInput.value) * 1000 || 2000) : (scene.transition ? scene.transition * 1000 : 2000);
    startSceneFade(scene.values, duration, !!scene.waveRunning, !!scene.flashRunning);
    showToast('Scène ' + (index + 1));
}


function restoreSceneState(scene) {
    if (scene.zoneLinks) {
        Object.entries(scene.zoneLinks).forEach(([fid, links]) => {
            const f = FixtureManager.getFixture(fid);
            if (f) {
                f.zoneLinks = { ...links };
                FixtureManager.setZoneLink(fid, 'l12', links.l12);
                FixtureManager.setZoneLink(fid, 'l34', links.l34);
                FixtureManager.setZoneLink(fid, 'lall', links.lall);
            }
        });
        document.querySelectorAll('.zone-link-cb').forEach(cb => {
            const fid = cb.dataset.fixtureId;
            const key = cb.dataset.linkKey;
            if (fid && key && scene.zoneLinks[fid]) {
                cb.checked = scene.zoneLinks[fid][key] || false;
            }
        });
    }
    if (scene.spotLinks) {
        Object.entries(scene.spotLinks).forEach(([gid, links]) => {
            FixtureManager.setSpotLink(gid, 'l12', links.l12);
            FixtureManager.setSpotLink(gid, 'l34', links.l34);
            FixtureManager.setSpotLink(gid, 'lall', links.lall);
        });
        document.querySelectorAll('.spot-link-cb').forEach(cb => {
            const gid = cb.dataset.groupId;
            const key = cb.dataset.linkKey;
            if (gid && key && scene.spotLinks[gid]) {
                cb.checked = scene.spotLinks[gid][key] || false;
            }
        });
    }
    if (scene.waveStates) {
        Object.entries(scene.waveStates).forEach(([fid, active]) => {
            FixtureManager.setWaveEnabled(fid, active);
        });
        document.querySelectorAll('.fixture-wave-cb').forEach(cb => {
            const fid = cb.dataset.id;
            if (fid && scene.waveStates[fid] !== undefined) cb.checked = scene.waveStates[fid];
        });
    }
    if (scene.waveSpeed !== undefined) document.getElementById('waveSpeed').value = scene.waveSpeed;
    if (scene.waveSpeedX2 !== undefined) document.getElementById('waveSpeedX2').checked = scene.waveSpeedX2;
    if (scene.starEnabled !== undefined) {
        document.getElementById('starEnabled').checked = scene.starEnabled;
        document.getElementById('starFreqGroup').style.display = scene.starEnabled ? '' : 'none';
    }
    if (scene.starFreq !== undefined) document.getElementById('starFreq').value = scene.starFreq;
    if (scene.waveColorStart !== undefined) document.getElementById('waveColorStart').value = scene.waveColorStart;
    if (scene.waveColorEnd !== undefined) document.getElementById('waveColorEnd').value = scene.waveColorEnd;
    if (scene.waveColorEnabled !== undefined) {
        document.getElementById('waveColorEnabled').checked = scene.waveColorEnabled;
        document.getElementById('waveColorGroup').style.display = scene.waveColorEnabled ? '' : 'none';
    }

    if (scene.flashTrigger !== undefined) document.getElementById('flashTrigger').value = scene.flashTrigger;
    if (scene.flashDuration !== undefined) document.getElementById('flashDuration').value = scene.flashDuration;
    if (scene.flashColorMode !== undefined) {
        document.getElementById('flashColorMode').value = scene.flashColorMode;
        document.getElementById('flashColorGroup').style.display = scene.flashColorMode === 'specific' ? '' : 'none';
    }
    if (scene.flashMode !== undefined) {
        document.getElementById('flashMode').value = scene.flashMode;
        document.getElementById('flashReverseGroup').style.display = scene.flashMode !== 'random' ? '' : 'none';
    }
    if (scene.flashReverse !== undefined) document.getElementById('flashReverse').checked = scene.flashReverse;
    if (scene.flashBPM !== undefined) {
        flashBPM = scene.flashBPM;
        document.getElementById('flashBPM').textContent = flashBPM || '---';
    }
    if (scene.flashStates) {
        Object.entries(scene.flashStates).forEach(([fid, active]) => {
            const f = FixtureManager.getFixture(fid);
            if (f) f.flashEnabled = active;
        });
        updateFlashFixturesList();
        document.querySelectorAll('.fixture-flash-cb').forEach(cb => {
            const fid = cb.dataset.id;
            if (fid && scene.flashStates[fid] !== undefined) cb.checked = scene.flashStates[fid];
        });
    }

    if (scene.waveRunning) {
        if (waveRunning) toggleWave();
        waveRunning = true;
        waveOffset = 0;
        waveSnapshot = FixtureManager.getFixtures().map(f => ({ id: f.id, channelValues: new Uint8Array(f.channelValues) }));
        document.getElementById('btnWave').textContent = 'Stop Vague';
        document.getElementById('btnWave').classList.add('active');
        document.getElementById('waveToolbar').style.display = '';
        syncWaveButton();
        runWave();
    }
    if (scene.flashRunning) {
        if (isFlashToolbarVisible()) stopFlashEngine();
        flashSnapshot = FixtureManager.getFixtures().map(f => ({ id: f.id, channelValues: new Uint8Array(f.channelValues) }));
        FixtureManager.getFixtures().filter(f => f.flashEnabled).forEach(f => {
            const profile = FixtureManager.getProfile(f.profileId);
            const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(f.channels / 3) : 0;
            if (zoneCount > 1) {
                for (let z = 0; z < zoneCount; z++) {
                    const off = (zoneCount - 1 - z) * 3;
                    FixtureManager.setChannelValue(f.id, off, 0);
                    FixtureManager.setChannelValue(f.id, off + 1, 0);
                    FixtureManager.setChannelValue(f.id, off + 2, 0);
                }
            } else if (FixtureManager.isRGBFixture(f)) {
                FixtureManager.setFixtureColor(f.id, 0, 0, 0);
            }
        });
        sendDMXBuffer();
        updateAllFixtureDisplays();
        document.getElementById('flashToolbar').style.display = '';
        syncFlashButton();
        startFlashEngine();
    }
}

function restoreSceneChannels(scene) {
    if (scene.fixtureChannels) {
        Object.entries(scene.fixtureChannels).forEach(([fid, vals]) => {
            const f = FixtureManager.getFixture(fid);
            if (f) {
                vals.forEach((v, i) => { if (i < f.channels) f.channelValues[i] = v; });
            }
        });
        sendDMXBuffer();
        if (currentPanelFixtureId) openFixturePanel(currentPanelFixtureId);
    }
}

function captureSceneData() {
    const channels = FixtureManager.getDMXChannels();
    const values = Array.from(channels);
    const waveStates = {};
    FixtureManager.getFixtures().forEach(f => { waveStates[f.id] = f.waveEnabled; });
    const zoneLinks = {};
    FixtureManager.getFixtures().forEach(f => { if (f.zoneLinks) zoneLinks[f.id] = { ...f.zoneLinks }; });
    const spotLinks = {};
    const spotFixtures = FixtureManager.getSpotFixtures();
    const groupCount = Math.ceil(spotFixtures.length / 4);
    for (let g = 0; g < groupCount; g++) {
        const gid = 'sg_' + g;
        spotLinks[gid] = FixtureManager.getSpotLinkState(gid);
    }
    return {
        values, waveStates, zoneLinks, spotLinks,
        waveRunning,
        waveSpeed: parseInt(document.getElementById('waveSpeed').value) || 64,
        waveSpeedX2: document.getElementById('waveSpeedX2').checked,
        starEnabled: document.getElementById('starEnabled').checked,
        starFreq: parseInt(document.getElementById('starFreq').value) || 64,
        waveColorStart: document.getElementById('waveColorStart').value,
        waveColorEnd: document.getElementById('waveColorEnd').value,
        waveColorEnabled: document.getElementById('waveColorEnabled').checked,
        flashRunning: document.getElementById('flashToolbar').style.display !== 'none',
        flashStates: FixtureManager.getFixtures().reduce((acc, f) => { acc[f.id] = f.flashEnabled || false; return acc; }, {}),
        flashTrigger: document.getElementById('flashTrigger').value,
        flashDuration: document.getElementById('flashDuration').value,
        flashColorMode: document.getElementById('flashColorMode').value,
        flashMode: document.getElementById('flashMode').value,
        flashReverse: document.getElementById('flashReverse').checked,
        flashBPM: flashBPM,
        fixtureChannels: FixtureManager.getFixtures().reduce((acc, f) => {
            acc[f.id] = Array.from(f.channelValues);
            return acc;
        }, {}),
        ts: Date.now()
    };
}

function captureMomentaryData() {
    const values = new Array(512).fill(0);
    FixtureManager.getFixtures().forEach(f => {
        if (f.momentaryEnabled === false) return;
        f.channelValues.forEach((v, i) => {
            if (i < 512 && f.startChannel + i < 512) {
                values[f.startChannel + i] = v;
            }
        });
    });
    return { values, ts: Date.now() };
}

function saveScene(index, forceOff) {
    markDirty();
    const data = captureSceneData();
    if (forceOff) {
        data.waveRunning = false;
        data.flashRunning = false;
    }
    const existing = scenes[index];
    data.transition = existing ? existing.transition : 2;
    scenes[index] = data;
    saveScenes();
    autoSaveCurrentSong();
    if (window._autoSave) window._autoSave();
    const btn = document.getElementById('scene-regular-' + index);
    if (btn) { btn.classList.add('saved'); btn.style.color = '#00ff00'; setTimeout(() => { btn.style.color = ''; }, 500); }
    showToast('Scène ' + (index + 1) + ' sauvegardée' + (forceOff ? ' [sans vague/flash]' : ''));
}

function saveMomentary(index) {
    markDirty();
    momentanes[index] = captureMomentaryData();
    saveScenes();
    autoSaveCurrentSong();
    if (window._autoSave) window._autoSave();
    const btn = document.getElementById('scene-momentane-' + index);
    if (btn) { btn.classList.add('saved'); btn.style.color = '#00ff00'; setTimeout(() => { btn.style.color = ''; }, 500); }
    showToast('Momentané ' + (index + 1) + ' sauvegardé');
}

function deleteScene(index) {
    markDirty();
    scenes[index] = null;
    saveScenes();
    autoSaveCurrentSong();
    if (window._autoSave) window._autoSave();
    const btn = document.getElementById('scene-regular-' + index);
    if (btn) { btn.classList.remove('saved', 'selected'); btn.style.color = '#ff0000'; setTimeout(() => { btn.style.color = ''; }, 500); }
    showToast('Scène ' + (index + 1) + ' supprimée');
}

function deleteMomentary(index) {
    markDirty();
    momentanes[index] = null;
    saveScenes();
    autoSaveCurrentSong();
    if (window._autoSave) window._autoSave();
    const btn = document.getElementById('scene-momentane-' + index);
    if (btn) { btn.classList.remove('saved'); btn.style.color = '#ff0000'; setTimeout(() => { btn.style.color = ''; }, 500); }
    showToast('Momentané ' + (index + 1) + ' supprimé');
}

function saveScenes() {
    const data = { scenes: scenes.map(s => s ? { ...s } : null), momentanes: momentanes.map(s => s ? { ...s } : null) };
    localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(data));
}

function loadScenes() {
    const raw = localStorage.getItem(SCENE_STORAGE_KEY);
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data.scenes) data.scenes.forEach((s, i) => { if (i < SCENE_REGULAR_COUNT) scenes[i] = s; });
        if (data.momentanes) data.momentanes.forEach((s, i) => { if (i < SCENE_MOMENTARY_COUNT) momentanes[i] = s; });
    } catch (e) { console.error('Error loading scenes:', e); }
}

function restoreAllSceneButtons() {
    for (let i = 0; i < SCENE_REGULAR_COUNT; i++) {
        const btn = document.getElementById('scene-regular-' + i);
        const transInput = document.getElementById('scene-trans-' + i);
        if (btn) {
            if (scenes[i]) {
                btn.classList.add('saved');
                if (transInput && scenes[i].transition !== undefined) transInput.value = scenes[i].transition;
            } else {
                btn.classList.remove('saved', 'selected');
            }
        }
    }
    for (let i = 0; i < SCENE_MOMENTARY_COUNT; i++) {
        const btn = document.getElementById('scene-momentane-' + i);
        if (btn) {
            if (momentanes[i]) btn.classList.add('saved');
            else btn.classList.remove('saved');
        }
    }
}

function autoSelectFirstScene(duration) {
    for (let i = 0; i < SCENE_REGULAR_COUNT; i++) {
        if (scenes[i]) {
            document.querySelectorAll('.btn-scene-regular, .btn-scene-small').forEach(b => b.classList.remove('selected'));
            const btn = document.getElementById('scene-regular-' + i);
            if (btn) {
                btn.classList.add('selected');
                const d = duration !== undefined ? duration : (scenes[i].transition ? scenes[i].transition * 1000 : 2000);
                startSceneFade(scenes[i].values, d);
            }
            break;
        }
    }
}

function launchSceneOne() {
    const scene = scenes[0];
    if (scene) {
        document.querySelectorAll('.btn-scene-regular, .btn-scene-small').forEach(b => b.classList.remove('selected'));
        const btn = document.getElementById('scene-regular-0');
        if (btn) btn.classList.add('selected');
        restoreSceneState(scene);
        const d = scene.transition ? scene.transition * 1000 : 2000;
        startSceneFade(scene.values, d);
        showToast('Scène 1');
    } else {
        showToast('Scène 1 vide');
    }
}

function launchSceneOneFromSetData(setData, durationMs) {
    let scene = setData?.scenes?.[0];
    if (!scene && setData?.scenes && typeof setData.scenes === 'object' && setData.scenes.lente) {
        scene = setData.scenes.lente.scenes?.[0];
    }
    if (!scene) { showToast('Scène 1 vide'); return; }
    document.querySelectorAll('.btn-scene-regular, .btn-scene-small').forEach(b => b.classList.remove('selected'));
    const btn = document.getElementById('scene-regular-0');
    if (btn) btn.classList.add('selected');
    restoreSceneState(scene);
    startSceneFade(scene.values, durationMs !== undefined ? durationMs : (scene.transition ? scene.transition * 1000 : 2000));
    showToast('Scène 1');
}

// ============================================
// MOMENTANÉ (press/release logic)
// ============================================

function handleMomentaneDown(e, index) {
    const scene = momentanes[index];
    if (!scene) return;
    if (momentaryFadeId) { cancelAnimationFrame(momentaryFadeId); momentaryFadeId = null; }
    momentaryPreState = {};
    FixtureManager.getFixtures().forEach(f => {
        if (f.momentaryEnabled !== false) {
            momentaryPreState[f.id] = Array.from(f.channelValues);
        }
    });
    momentaryActiveIndex = index;
    const btn = document.getElementById('scene-momentane-' + index);
    if (btn) btn.classList.add('active-press');
    applySceneValues(scene.values, true);
    showToast('Momentané ' + (index + 1));
}

function handleMomentaneUp(e, index) {
    if (momentaryActiveIndex !== index) return;
    if (!momentaryPreState) return;
    momentaryActiveIndex = -1;
    const btn = document.getElementById('scene-momentane-' + index);
    if (btn) btn.classList.remove('active-press');
    const preState = momentaryPreState;
    momentaryPreState = null;
    const transInput = document.getElementById('momentane-trans-' + index);
    const duration = transInput ? (parseFloat(transInput.value) * 1000 || 150) : 150;
    const startTime = performance.now();
    const startValues = {};
    Object.keys(preState).forEach(fid => {
        const f = FixtureManager.getFixture(fid);
        if (f) startValues[fid] = Array.from(f.channelValues);
    });
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        Object.keys(preState).forEach(fid => {
            const sv = startValues[fid];
            const tv = preState[fid];
            if (sv && tv) {
                const interpolated = sv.map((v, i) => Math.round(v + ((tv[i] || 0) - v) * ease));
                FixtureManager.setChannelValuesBulk(fid, interpolated);
            }
        });
        sendDMXBuffer();
        if (progress < 1) {
            momentaryFadeId = requestAnimationFrame(step);
        } else {
            momentaryFadeId = null;
            updateAllFixtureDisplays();
        }
    }
    momentaryFadeId = requestAnimationFrame(step);
}

// ============================================
// MIDI INPUT (CC 0-119, Channel configurable)
// ============================================

let midiAccess = null;
let midiChannel = 7;

function getMidiSettings() {
    try {
        const stored = localStorage.getItem('dmx2_midi_settings');
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    return { selectedPorts: [], channel: 7 };
}

function saveMidiSettings(settings) {
    localStorage.setItem('dmx2_midi_settings', JSON.stringify(settings));
}

function connectMidiInputs() {
    if (!midiAccess) return;
    const settings = getMidiSettings();
    midiChannel = settings.channel || 7;
    midiAccess.inputs.forEach(input => {
        if (settings.selectedPorts.length === 0 || settings.selectedPorts.includes(input.id)) {
            input.onmidimessage = handleMIDIMessage;
        } else {
            input.onmidimessage = null;
        }
    });
    updateMidiStatusDot();
}

async function setupMIDI() {
    if (!navigator.requestMIDIAccess) {
        console.log('Web MIDI not supported');
        return;
    }
    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: true });
        connectMidiInputs();
        midiAccess.onstatechange = () => {
            connectMidiInputs();
            updateMidiStatusDot();
        };
        updateMidiStatusDot();
        console.log('MIDI initialized, inputs:', midiAccess.inputs.size);
        midiAccess.inputs.forEach(input => {
            console.log('  Input:', input.name, input.id, input.manufacturer);
        });
    } catch (err) {
        console.log('MIDI access denied:', err);
        document.getElementById('midiStatus').className = 'connection-dot disconnected';
        document.getElementById('midiStatus').title = 'MIDI refusé';
    }
}

let midiFlashTimeout = null;
function flashMidiDot() {
    const dot = document.getElementById('midiStatus');
    dot.className = 'connection-dot connected';
    clearTimeout(midiFlashTimeout);
    midiFlashTimeout = setTimeout(() => { dot.className = 'connection-dot receiving'; }, 150);
}

function updateMidiStatusDot() {
    const dot = document.getElementById('midiStatus');
    if (!midiAccess) { dot.className = 'connection-dot disconnected'; dot.title = 'MIDI indisponible'; return; }
    const count = midiAccess.inputs.size;
    if (count > 0) {
        dot.className = 'connection-dot connected';
        dot.title = 'MIDI connecté (' + count + ' entrée' + (count > 1 ? 's' : '') + ')';
    } else {
        dot.className = 'connection-dot disconnected';
        dot.title = 'MIDI déconnecté';
    }
}

function renderMidiPortList() {
    const container = document.getElementById('midiPortList');
    if (!midiAccess) { container.innerHTML = '<div class="midi-no-port">MIDI non disponible</div>'; return; }
    const settings = getMidiSettings();
    const inputs = Array.from(midiAccess.inputs.values());
    if (inputs.length === 0) { container.innerHTML = '<div class="midi-no-port">Aucun port détecté</div>'; return; }
    container.innerHTML = '';
    inputs.forEach(input => {
        const div = document.createElement('div');
        div.className = 'midi-port-item' + (settings.selectedPorts.length === 0 || settings.selectedPorts.includes(input.id) ? ' selected' : '');
        div.innerHTML = `
            <input type="checkbox" id="midi-${input.id}" ${settings.selectedPorts.length === 0 || settings.selectedPorts.includes(input.id) ? 'checked' : ''}>
            <label for="midi-${input.id}">${escapeHtml(input.name)}</label>
            <span class="midi-port-manufacturer">${escapeHtml(input.manufacturer || '')}</span>`;
        div.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
            }
            div.classList.toggle('selected', div.querySelector('input').checked);
        });
        container.appendChild(div);
    });
}

// ============================================
// MIDI → TOOLBARS VAGUE / FLASH (CC 101-103, 110-118, 120-122)
// Cases à cocher : value >= 64 → ON, sinon OFF (déterministe, pas de toggle)
// Listes : valeur 0-127 mappée sur les options du select
// Sliders 0-127 (vitesse, scintillement) : valeur CC directe
// Couleurs presets (8 × 16 valeurs) : idx = floor(value / 16)
// ============================================

function setToolbarCheckbox(id, on) {
    const el = document.getElementById(id);
    if (!el || el.checked === on) return;
    el.checked = on;
    el.dispatchEvent(new Event('change'));
}

function setFlashSelect(id, value) {
    const el = document.getElementById(id);
    if (!el || el.value === value) return;
    el.value = value;
    el.dispatchEvent(new Event('change'));
}

// Palette presets partagée (CC 101/102/103) : 8 couleurs × 16 valeurs CC
const MIDI_COLOR_PRESETS = [
    '#ff0000', // Rouge (0-15)
    '#ff8000', // Orange (16-31)
    '#ffff00', // Jaune (32-47)
    '#00ff00', // Vert (48-63)
    '#00ffff', // Cyan (64-79)
    '#0000ff', // Bleu (80-95)
    '#ff00ff', // Magenta (96-111)
    '#ffffff'  // Blanc (112-127)
];

function midiValueToPreset(value) {
    return MIDI_COLOR_PRESETS[Math.min(7, Math.floor(value / 16))];
}

function setToolbarColor(id, hex) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = hex;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function handleToolbarCC(cc, value) {
    const on = value >= 64;
    switch (cc) {
        case 110: // Vague ON/OFF (moteur)
            if (on !== !!waveRunning) toggleWave();
            return true;
        case 111: // x2
            setToolbarCheckbox('waveSpeedX2', on);
            return true;
        case 112: // Étoiles
            setToolbarCheckbox('starEnabled', on);
            return true;
        case 113: // Plage (couleurs perso)
            setToolbarCheckbox('waveColorEnabled', on);
            return true;
        case 114: // Flash ON/OFF (moteur)
            if (on !== isFlashToolbarVisible()) toggleFlash();
            return true;
        case 115: // Inverser
            setToolbarCheckbox('flashReverse', on);
            return true;
        case 116: // Déclencher (7 subdivisions)
        case 117: { // Durée (7 subdivisions)
            const id = cc === 116 ? 'flashTrigger' : 'flashDuration';
            const sel = document.getElementById(id);
            if (!sel) return true;
            const idx = Math.round((value / 127) * (sel.options.length - 1));
            setFlashSelect(id, sel.options[idx].value);
            return true;
        }
        case 118: { // Mode (3 options : random / sequential / group4)
            const modes = ['random', 'sequential', 'group4'];
            const idx = value < 43 ? 0 : (value < 86 ? 1 : 2);
            setFlashSelect('flashMode', modes[idx]);
            return true;
        }
        case 120: // Couleur flash (random / specific)
            setFlashSelect('flashColorMode', on ? 'specific' : 'random');
            return true;
        case 101: // Plage début (preset) + active Plage
            setToolbarColor('waveColorStart', midiValueToPreset(value));
            setToolbarCheckbox('waveColorEnabled', true);
            return true;
        case 102: // Plage fin (preset) + active Plage
            setToolbarColor('waveColorEnd', midiValueToPreset(value));
            setToolbarCheckbox('waveColorEnabled', true);
            return true;
        case 103: // Couleur flash (preset) + bascule en Choisie
            setToolbarColor('flashColor', midiValueToPreset(value));
            setFlashSelect('flashColorMode', 'specific');
            return true;
        case 121: // Vitesse vague (slider 0-127 : mapping CC direct, relu à chaque frame)
        case 122: { // Scintillement étoiles (slider 0-127 : mapping CC direct)
            const id = cc === 121 ? 'waveSpeed' : 'starFreq';
            const el = document.getElementById(id);
            if (el) el.value = Math.max(0, Math.min(127, value));
            return true;
        }
        default:
            return false;
    }
}

function handleMIDIMessage(msg) {
    flashMidiDot();
    const [status, cc, value] = msg.data;
    const command = status & 0xF0;
    const channel = (status & 0x0F) + 1;

    // Program Change → charger chanson
    if (command === 0xC0 && channel === midiChannel) {
        const index = cc;
        if (playlist[index]) {
            currentSongIndex = index;
            updateCurrentSongDisplay();
            liveLoadSong(index);
        }
        return;
    }

    // Note ON/OFF → momentanés (C1=24, D1=26, E1=28, F1=30)
    const momentaryNotes = [24, 26, 28, 30];
    if ((command === 0x90 || command === 0x80) && channel === midiChannel) {
        const noteIdx = momentaryNotes.indexOf(cc);
        if (noteIdx >= 0) {
            const velocity = msg.data[2];
            if (command === 0x90 && velocity > 0) {
                const scene = momentanes[noteIdx];
                if (!scene) return;
                if (momentaryFadeId) { cancelAnimationFrame(momentaryFadeId); momentaryFadeId = null; }
                if (!momentaryPreState) {
                    momentaryPreState = Array.from(FixtureManager.getDMXChannels());
                }
                momentaryActiveIndex = noteIdx;
                const btn = document.getElementById('scene-momentane-' + noteIdx);
                if (btn) btn.classList.add('active-press');
                restoreSceneState(scene);
                applySceneValues(scene.values);
            } else {
                handleMomentaneUp({ target: document.getElementById('scene-momentane-' + noteIdx) }, noteIdx);
            }
            return;
        }
    }

    // Control Change → scènes / toolbars vague+flash
    if (command !== 0xB0 || channel !== midiChannel) return;
    if (cc < 0 || cc > 127) return;

    if (cc === flashMidiCC) {
        if (value >= 64) triggerFlashFromMIDI();
        return;
    }

    // CC 101-103, 110-122 → presets, cases, listes et sliders des bandeaux vague/flash
    if (handleToolbarCC(cc, value)) return;

    let mode, sceneIndex;
    if (cc >= 1 && cc <= 32) {
        mode = 'regular';
        sceneIndex = cc - 1;
    } else if (cc >= 124 && cc <= 127) {
        mode = 'momentane';
        sceneIndex = cc - 124;
    } else {
        return;
    }

    if (mode === 'momentane') {
        if (value >= 127) {
            const scene = momentanes[sceneIndex];
            if (!scene) return;
            if (momentaryFadeId) { cancelAnimationFrame(momentaryFadeId); momentaryFadeId = null; }
            if (!momentaryPreState) {
                momentaryPreState = Array.from(FixtureManager.getDMXChannels());
            }
            momentaryActiveIndex = sceneIndex;
            const btn = document.getElementById('scene-momentane-' + sceneIndex);
            if (btn) btn.classList.add('active-press');
            restoreSceneState(scene);
            applySceneValues(scene.values);
        } else if (value === 0) {
            handleMomentaneUp({ target: document.getElementById('scene-momentane-' + sceneIndex) }, sceneIndex);
        }
    } else {
        if (value > 0) {
            const scene = scenes[sceneIndex];
            if (!scene) return;
            document.querySelectorAll('.btn-scene-regular, .btn-scene-small').forEach(b => b.classList.remove('selected'));
            const btn = document.getElementById('scene-regular-' + sceneIndex);
            if (btn) btn.classList.add('selected');
            restoreSceneState(scene);
            const transInput = document.getElementById('scene-trans-' + sceneIndex);
            const duration = transInput ? (parseFloat(transInput.value) * 1000 || 2000) : (scene.transition ? scene.transition * 1000 : 2000);
            startSceneFade(scene.values, duration, !!scene.waveRunning, !!scene.flashRunning);
        }
    }
}

function startSceneFade(targetValues, duration, skipWaveStop, skipFlashStop) {
    if (fadeReqId) cancelAnimationFrame(fadeReqId);
    if (!skipWaveStop && waveRunning) toggleWave();
    if (!skipFlashStop && isFlashToolbarVisible()) stopFlashEngine();

    if (duration === 0) {
        applySceneValues(targetValues);
        return;
    }

    const fixtures = FixtureManager.getFixtures();
    const startValues = fixtures.map(f => new Uint8Array(f.channelValues));
    const startTime = performance.now();
    let lastRender = 0;

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        if (currentTime - lastRender > 30 || progress === 1) {
            lastRender = currentTime;

            fixtures.forEach((fixture, fi) => {
                if ((fixture.flashEnabled && isFlashToolbarVisible()) || (fixture.waveEnabled && waveRunning)) return;
                const profile = FixtureManager.getProfile(fixture.profileId);

                if (profile && profile.hasZonePickers) {
                    const zoneCount = Math.floor(fixture.channels / 3);
        for (let z = 0; z < zoneCount; z++) {
                        const off = (zoneCount - 1 - z) * 3;
                        const baseTarget = fixture.startChannel + off;
                        for (let c = 0; c < 3; c++) {
                            const tv = targetValues[baseTarget + c] || 0;
                            const sv = startValues[fi][off + c] || 0;
                            FixtureManager.setChannelValue(fixture.id, off + c, Math.round(sv + (tv - sv) * ease));
                        }
                    }
                    for (let ch = zoneCount * 3; ch < fixture.channels; ch++) {
                        const tv = targetValues[fixture.startChannel + ch] || 0;
                        const sv = startValues[fi][ch] || 0;
                        FixtureManager.setChannelValue(fixture.id, ch, Math.round(sv + (tv - sv) * ease));
                    }
                } else if (profile && profile.hasColorPicker) {
                    const offsets = getRGBChannelOffsets(fixture);
                    if (offsets) {
                        const tr = targetValues[fixture.startChannel + offsets.r] || 0;
                        const tg = targetValues[fixture.startChannel + offsets.g] || 0;
                        const tb = targetValues[fixture.startChannel + offsets.b] || 0;
                        const sr = startValues[fi][offsets.r] || 0;
                        const sg = startValues[fi][offsets.g] || 0;
                        const sb = startValues[fi][offsets.b] || 0;
                        FixtureManager.setFixtureColor(fixture.id,
                            Math.round(sr + (tr - sr) * ease),
                            Math.round(sg + (tg - sg) * ease),
                            Math.round(sb + (tb - sb) * ease));
                    }
                } else {
                    for (let ch = 0; ch < fixture.channels; ch++) {
                        const tv = targetValues[fixture.startChannel + ch] || 0;
                        const sv = startValues[fi][ch] || 0;
                        FixtureManager.setChannelValue(fixture.id, ch, Math.round(sv + (tv - sv) * ease));
                    }
                }
            });

            updateAllFixtureDisplays();
            sendDMXBuffer();
        }

        if (progress < 1) {
            fadeReqId = requestAnimationFrame(step);
        } else {
            fadeReqId = null;
            updateAllFixtureDisplays();
            sendDMXBuffer();
            syncWaveButton();
        }
    }
    fadeReqId = requestAnimationFrame(step);
}

function applySceneValues(targetValues, momentaryOnly) {
    FixtureManager.getFixtures().forEach(fixture => {
        if (momentaryOnly && fixture.momentaryEnabled === false) return;
        const profile = FixtureManager.getProfile(fixture.profileId);
        if (profile && profile.hasZonePickers) {
            const zoneCount = Math.floor(fixture.channels / 3);
            for (let z = 0; z < zoneCount; z++) {
                const off = (zoneCount - 1 - z) * 3;
                const base = fixture.startChannel + off;
                for (let c = 0; c < 3; c++) {
                    FixtureManager.setChannelValue(fixture.id, off + c, targetValues[base + c] || 0);
                }
            }
            for (let ch = zoneCount * 3; ch < fixture.channels; ch++) {
                FixtureManager.setChannelValue(fixture.id, ch, targetValues[fixture.startChannel + ch] || 0);
            }
        } else if (profile && profile.hasColorPicker) {
            const offsets = getRGBChannelOffsets(fixture);
            if (offsets) {
                FixtureManager.setFixtureColor(fixture.id,
                    targetValues[fixture.startChannel + offsets.r] || 0,
                    targetValues[fixture.startChannel + offsets.g] || 0,
                    targetValues[fixture.startChannel + offsets.b] || 0);
            }
        } else {
            for (let ch = 0; ch < fixture.channels; ch++) {
                FixtureManager.setChannelValue(fixture.id, ch, targetValues[fixture.startChannel + ch] || 0);
            }
        }
    });
    updateAllFixtureDisplays();
    sendDMXBuffer();
}

function getRGBChannelOffsets(fixture) {
    const profile = FixtureManager.getProfile(fixture.profileId);
    if (!profile || !profile.controls) return null;
    let r = null, g = null, b = null;
    profile.controls.forEach(c => {
        if (c.type === 'channel') {
            const n = c.name.toLowerCase();
            if (n === 'rouge' || n === 'red') r = c.offset;
            if (n === 'vert' || n === 'green') g = c.offset;
            if (n === 'bleu' || n === 'blue') b = c.offset;
        }
    });
    if (r !== null && g !== null && b !== null) return { r, g, b };
    return null;
}

// ============================================
// SLIDERS (dynamic from fixture profiles)
// ============================================

let sliderElements = {};
let sliderControlEntries = [];

const HIDDEN_SLIDER_CONTROLS = ['Blanc', 'Dimmer', 'Flash', 'Strobe'];

function renderSliders() {
    const grid = document.getElementById('slidersGrid');
    grid.innerHTML = '';
    sliderElements = {};

    const controls = FixtureManager.getSliderControls();
    const controlNames = Object.keys(controls).filter(n => !HIDDEN_SLIDER_CONTROLS.includes(n));
    sliderControlEntries = controlNames.flatMap(n => controls[n]);

    controlNames.forEach(name => {
        const entries = controls[name];
        const card = document.createElement('div');
        card.className = 'slider-group-card';

        const title = document.createElement('h5');
        title.textContent = name.toUpperCase();
        card.appendChild(title);

        if (entries.length === 1) {
            const e = entries[0];
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'slider-dmx';
            slider.min = e.min;
            slider.max = e.max;
            slider.value = getSliderValue(e);
            slider.dataset.fixtureId = e.fixtureId;
            slider.dataset.offset = e.offset;
            slider.addEventListener('input', (ev) => {
                const val = parseInt(ev.target.value);
                FixtureManager.setChannelValue(e.fixtureId, e.offset, val);
            });
            card.appendChild(slider);
            sliderElements[e.fixtureId + '_' + e.offset] = slider;
        } else {
            const container = document.createElement('div');
            container.className = 'blanc-sliders';
            entries.forEach(e => {
                const item = document.createElement('div');
                item.className = 'blanc-slider-item';
                const label = document.createElement('label');
                label.textContent = e.fixtureName;
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 'slider-dmx';
                slider.min = e.min;
                slider.max = e.max;
                slider.value = getSliderValue(e);
                slider.dataset.fixtureId = e.fixtureId;
                slider.dataset.offset = e.offset;
                slider.addEventListener('input', (ev) => {
                    const val = parseInt(ev.target.value);
                    FixtureManager.setChannelValue(e.fixtureId, e.offset, val);
                });
                item.appendChild(label);
                item.appendChild(slider);
                container.appendChild(item);
                sliderElements[e.fixtureId + '_' + e.offset] = slider;
            });
            card.appendChild(container);
        }

        grid.appendChild(card);
    });
}

function getSliderValue(entry) {
    const fixture = FixtureManager.getFixture(entry.fixtureId);
    return fixture ? fixture.channelValues[entry.offset] : 0;
}

function updateSliderValues() {
    sliderControlEntries.forEach(entry => {
        const key = entry.fixtureId + '_' + entry.offset;
        const slider = sliderElements[key];
        if (slider && !slider.matches(':active')) {
            slider.value = getSliderValue(entry);
        }
    });
}

function updateSlidersVisibility() {
    const section = document.getElementById('slidersSection');
    const hasControls = Object.keys(FixtureManager.getSliderControls()).length > 0;
    section.style.display = hasControls ? '' : 'none';
    if (hasControls) renderSliders();
}

// ============================================
// WAVE
// ============================================

function toggleWave() {
    const btn = document.getElementById('btnWave');
    const waveToolbar = document.getElementById('waveToolbar');
    if (waveRunning) {
        waveRunning = false;
        if (waveReqId) cancelAnimationFrame(waveReqId);
        starActive = {};
        starNextSpawn = 0;
        btn.textContent = 'Vague';
        btn.classList.remove('active');
        waveToolbar.style.display = 'none';
        if (waveSnapshot) {
            waveSnapshot.forEach(sf => {
                const fixture = FixtureManager.getFixture(sf.id);
                if (fixture) sf.channelValues.forEach((val, idx) => fixture.channelValues[idx] = val);
            });
            updateAllFixtureDisplays();
            sendDMXBuffer();
            waveSnapshot = null;
        }
    } else {
        const flashToolbar = document.getElementById('flashToolbar');
        if (flashIntervalId || (flashToolbar && flashToolbar.style.display !== 'none')) {
            stopFlashEngine();
            if (flashSnapshot) {
                const durationBeats = parseFloat(document.getElementById('flashDuration').value) || 0.5;
                const bpm = flashBPM || 120;
                const durationMs = (durationBeats / bpm) * 60000;
                const snap = flashSnapshot;
                flashSnapshot = null;
                setTimeout(() => {
                    snap.forEach(sf => {
                        const fixture = FixtureManager.getFixture(sf.id);
                        if (fixture) sf.channelValues.forEach((val, idx) => fixture.channelValues[idx] = val);
                    });
                    updateAllFixtureDisplays();
                    sendDMXBuffer();
                }, durationMs + 50);
            }
        }
        waveRunning = true;
        waveOffset = 0;
        waveSnapshot = FixtureManager.getFixtures().map(f => ({ id: f.id, channelValues: new Uint8Array(f.channelValues) }));
        btn.textContent = 'Stop Vague';
        btn.classList.add('active');
        waveToolbar.style.display = '';
        runWave();
    }
}

let waveFrameCount = 0;
function runWave() {
    if (!waveRunning) return;

    try {
        waveFrameCount++;

        const starsOn = document.getElementById('starEnabled').checked;
        const useCustomRange = document.getElementById('waveColorEnabled').checked;
        const colorStartHex = document.getElementById('waveColorStart').value;
        const colorEndHex = document.getElementById('waveColorEnd').value;

        const speedInput = document.getElementById('waveSpeed');
        const baseSpeed = speedInput ? speedInput.value * 0.00005 : 0.0005;
        const speedX2 = document.getElementById('waveSpeedX2').checked ? 2 : 1;
        const speed = (useCustomRange ? baseSpeed * 4 : baseSpeed) * speedX2;
        waveOffset += speed;

        let startRgb = null, endRgb = null;
        if (useCustomRange) {
            startRgb = hexToRgb(colorStartHex);
            endRgb = hexToRgb(colorEndHex);
        }

        const now = performance.now();

        if (starsOn) {
            const waveFixtures = FixtureManager.getFixtures().filter(f => f.waveEnabled);
            if (now > starNextSpawn && waveFixtures.length > 0) {
                const fixture = waveFixtures[Math.floor(Math.random() * waveFixtures.length)];
                const profile = FixtureManager.getProfile(fixture.profileId);
                const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 1;
                const zone = Math.floor(Math.random() * zoneCount);
                const key = fixture.id + '_z' + zone;
                if (!starActive[key]) {
                    starActive[key] = {
                        start: now,
                        duration: 10 + Math.random() * 40,
                        intensity: 0.4 + Math.random() * 0.6
                    };
                }
                starNextSpawn = now + 500 + (1 - (document.getElementById('starFreq').value / 127)) * 8000;
            }
        }

        const waveFixtures = FixtureManager.getFixtures().filter(f => f.waveEnabled);
        let globalZoneIdx = 0;
        const totalZones = waveFixtures.reduce((sum, f) => {
            const p = FixtureManager.getProfile(f.profileId);
            return sum + ((p && p.hasZonePickers) ? Math.floor(f.channels / 3) : 1);
        }, 0);

        waveFixtures.forEach((fixture) => {
            const profile = FixtureManager.getProfile(fixture.profileId);
            const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 1;

            for (let z = 0; z < zoneCount; z++) {
                const zMapped = fixture.reverseWave ? (zoneCount - 1 - z) : z;
                let r, g, b;

                if (useCustomRange && startRgb && endRgb && totalZones > 0) {
                    const sinVal = Math.sin(waveOffset + (globalZoneIdx / totalZones) * Math.PI * 2);
                    const t = (sinVal + 1) / 2;
                    r = Math.round(startRgb.r + (endRgb.r - startRgb.r) * t);
                    g = Math.round(startRgb.g + (endRgb.g - startRgb.g) * t);
                    b = Math.round(startRgb.b + (endRgb.b - startRgb.b) * t);
                } else {
                    const hue = (waveOffset * 60 + globalZoneIdx * 25) % 360;
                    [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
                }

                if (starsOn) {
                    const key = fixture.id + '_z' + z;
                    const star = starActive[key];
                    if (star) {
                        const elapsed = now - star.start;
                        if (elapsed >= star.duration) {
                            delete starActive[key];
                        } else {
                            const w = star.intensity;
                            r = Math.round(r + (255 - r) * w);
                            g = Math.round(g + (255 - g) * w);
                            b = Math.round(b + (255 - b) * w);
                        }
                    }
                }

                if (zoneCount > 1) {
                    const off = (zoneCount - 1 - zMapped) * 3;
                    FixtureManager.setChannelValue(fixture.id, off, r);
                    FixtureManager.setChannelValue(fixture.id, off + 1, g);
                    FixtureManager.setChannelValue(fixture.id, off + 2, b);
                } else {
                    FixtureManager.applyColorToFixture(fixture.id, r, g, b);
                }

                globalZoneIdx++;
            }
        });

        sendDMXBuffer();
        updateAllFixtureDisplays();
    } catch (e) {
        console.error('Wave error:', e);
    }

    waveReqId = requestAnimationFrame(runWave);
}

// ============================================
// FLASH
// ============================================

function flashOnFixture(fixtureId) {
    const fixture = FixtureManager.getFixture(fixtureId);
    if (!fixture) return;

    const colorMode = document.getElementById('flashColorMode').value;
    const profile = FixtureManager.getProfile(fixture.profileId);
    const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;

    let r, g, b;
    if (colorMode === 'specific') {
        const rgb = hexToRgb(fixture.flashColor || '#ffffff');
        r = rgb ? rgb.r : 255; g = rgb ? rgb.g : 255; b = rgb ? rgb.b : 255;
    } else {
        r = Math.floor(Math.random() * 256);
        g = Math.floor(Math.random() * 256);
        b = Math.floor(Math.random() * 256);
    }

    if (zoneCount > 1) {
        for (let z = 0; z < zoneCount; z++) {
            const off = (zoneCount - 1 - z) * 3;
            FixtureManager.setChannelValue(fixture.id, off, r);
            FixtureManager.setChannelValue(fixture.id, off + 1, g);
            FixtureManager.setChannelValue(fixture.id, off + 2, b);
        }
    } else {
        FixtureManager.applyColorToFixture(fixture.id, r, g, b);
    }
}

function flashOffFixture(fixtureId) {
    const fixture = FixtureManager.getFixture(fixtureId);
    if (!fixture) return;
    const profile = FixtureManager.getProfile(fixture.profileId);
    const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;
    if (zoneCount > 1) {
        for (let z = 0; z < zoneCount; z++) {
            const off = (zoneCount - 1 - z) * 3;
            FixtureManager.setChannelValue(fixture.id, off, 0);
            FixtureManager.setChannelValue(fixture.id, off + 1, 0);
            FixtureManager.setChannelValue(fixture.id, off + 2, 0);
        }
    } else {
        FixtureManager.applyColorToFixture(fixture.id, 0, 0, 0);
    }
    fixture._flashPreState = null;
}

function flashFadeToBlack(fixtureId, progress) {
    const fixture = FixtureManager.getFixture(fixtureId);
    if (!fixture || !fixture._flashPeakColor) return;
    const r = Math.round(fixture._flashPeakColor.r * (1 - progress));
    const g = Math.round(fixture._flashPeakColor.g * (1 - progress));
    const b = Math.round(fixture._flashPeakColor.b * (1 - progress));
    const profile = FixtureManager.getProfile(fixture.profileId);
    const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;
    if (zoneCount > 1) {
        for (let z = 0; z < zoneCount; z++) {
            const off = (zoneCount - 1 - z) * 3;
            FixtureManager.setChannelValue(fixture.id, off, r);
            FixtureManager.setChannelValue(fixture.id, off + 1, g);
            FixtureManager.setChannelValue(fixture.id, off + 2, b);
        }
    } else {
        FixtureManager.applyColorToFixture(fixture.id, r, g, b);
    }
}

function flashTick() {
    const activeIds = FixtureManager.getFixtures().filter(f => f.flashEnabled).map(f => f.id);
    if (activeIds.length === 0) return;

    const durationBeats = parseFloat(document.getElementById('flashDuration').value) || 0.5;
    const bpm = flashBPM || 120;
    const durationMs = (durationBeats / bpm) * 60000;
    const halfMs = durationMs / 2;
    const mode = document.getElementById('flashMode').value;
    const reverse = document.getElementById('flashReverse').checked;

    if (mode === 'random') {
        const units = [];
        activeIds.forEach(id => {
            const fixture = FixtureManager.getFixture(id);
            if (!fixture) return;
            const profile = FixtureManager.getProfile(fixture.profileId);
            const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;
            if (zoneCount > 1) {
                for (let z = 0; z < zoneCount; z++) units.push({ fixtureId: id, zone: z, zoneCount });
            } else {
                units.push({ fixtureId: id, zone: -1, zoneCount: 0 });
            }
        });
        if (units.length === 0) return;
        const count = units.length >= 2 ? Math.floor(Math.random() * 2) + 1 : 1;
        const shuffled = units.sort(() => Math.random() - 0.5);
        shuffled.slice(0, count).forEach(u => flashUnit(u, halfMs));
    } else {
        if (!flashTick._idx) flashTick._idx = 0;
        const allUnits = [];
        activeIds.forEach(id => {
            const fixture = FixtureManager.getFixture(id);
            if (!fixture) return;
            const profile = FixtureManager.getProfile(fixture.profileId);
            const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(fixture.channels / 3) : 0;
            if (mode === 'group4' && zoneCount > 1) {
                allUnits.push({ fixtureId: id, zones: Array.from({length: zoneCount}, (_, i) => i), zoneCount, groupMode: true });
            } else if (zoneCount > 1) {
                for (let z = 0; z < zoneCount; z++) allUnits.push({ fixtureId: id, zone: z, zoneCount });
            } else {
                allUnits.push({ fixtureId: id, zone: -1, zoneCount: 0 });
            }
        });
        if (allUnits.length === 0) return;
        const ordered = reverse ? [...allUnits].reverse() : allUnits;
        const unit = ordered[flashTick._idx % ordered.length];
        flashTick._idx = (flashTick._idx + 1) % ordered.length;
        if (unit.groupMode) {
            unit.zones.forEach(z => flashUnit({ fixtureId: unit.fixtureId, zone: z, zoneCount: unit.zoneCount }, halfMs));
        } else {
            flashUnit(unit, halfMs);
        }
    }

    sendDMXBuffer();
    updateAllFixtureDisplays();
}

function flashUnit(unit, halfMs) {
    const fixture = FixtureManager.getFixture(unit.fixtureId);
    if (!fixture) return;
    const unitKey = unit.zone >= 0 ? `z${unit.zone}` : 'main';
    if (!fixture._flashGens) fixture._flashGens = {};
    fixture._flashGens[unitKey] = (fixture._flashGens[unitKey] || 0) + 1;
    const gen = fixture._flashGens[unitKey];
    const colorMode = document.getElementById('flashColorMode').value;
    let r, g, b;
    if (colorMode === 'specific') {
        const hex = document.getElementById('flashColor').value || '#ffffff';
        const rgb = hexToRgb(hex);
        r = rgb ? rgb.r : 255; g = rgb ? rgb.g : 255; b = rgb ? rgb.b : 255;
    } else {
        r = Math.floor(Math.random() * 256);
        g = Math.floor(Math.random() * 256);
        b = Math.floor(Math.random() * 256);
    }
    if (unit.zone >= 0) {
        const off = (unit.zoneCount - 1 - unit.zone) * 3;
        FixtureManager.setChannelValue(fixture.id, off, r);
        FixtureManager.setChannelValue(fixture.id, off + 1, g);
        FixtureManager.setChannelValue(fixture.id, off + 2, b);
    } else {
        FixtureManager.applyColorToFixture(fixture.id, r, g, b);
    }
    setTimeout(() => {
        if (gen !== fixture._flashGens[unitKey]) return;
        const fadeStart = performance.now();
        function fadeStep(now) {
            if (gen !== fixture._flashGens[unitKey]) return;
            const elapsed = now - fadeStart;
            const progress = Math.min(elapsed / halfMs, 1);
            const fr = Math.round(r * (1 - progress));
            const fg = Math.round(g * (1 - progress));
            const fb = Math.round(b * (1 - progress));
            if (unit.zone >= 0) {
                const off = (unit.zoneCount - 1 - unit.zone) * 3;
                FixtureManager.setChannelValue(fixture.id, off, fr);
                FixtureManager.setChannelValue(fixture.id, off + 1, fg);
                FixtureManager.setChannelValue(fixture.id, off + 2, fb);
            } else if (FixtureManager.isRGBFixture(fixture)) {
                FixtureManager.setFixtureColor(fixture.id, fr, fg, fb);
            }
            sendDMXBuffer();
            updateAllFixtureDisplays();
            if (progress < 1) requestAnimationFrame(fadeStep);
        }
        requestAnimationFrame(fadeStep);
    }, halfMs);
}

function startFlashEngine() {
    if (flashIntervalId) return;
    flashTick._idx = 0;
    const bpm = flashBPM || 120;
    const triggerBeats = parseFloat(document.getElementById('flashTrigger').value) || 1;
    const intervalMs = (triggerBeats / bpm) * 60000;
    flashTick();
    flashIntervalId = setInterval(flashTick, intervalMs);
}

function stopFlashEngine() {
    if (flashIntervalId) { clearInterval(flashIntervalId); flashIntervalId = null; }
    document.getElementById('flashToolbar').style.display = 'none';
    syncFlashButton();
}

function toggleFlash() {
    const toolbar = document.getElementById('flashToolbar');
    const running = toolbar.style.display !== 'none';
    if (running) {
        stopFlashEngine();
        if (flashSnapshot) {
            const durationBeats = parseFloat(document.getElementById('flashDuration').value) || 0.5;
            const bpm = flashBPM || 120;
            const durationMs = (durationBeats / bpm) * 60000;
            const snap = flashSnapshot;
            flashSnapshot = null;
            setTimeout(() => {
                snap.forEach(sf => {
                    const fixture = FixtureManager.getFixture(sf.id);
                    if (fixture) sf.channelValues.forEach((val, idx) => fixture.channelValues[idx] = val);
                });
                updateAllFixtureDisplays();
                sendDMXBuffer();
            }, durationMs + 50);
        }
    } else {
        if (waveRunning) toggleWave();
        flashSnapshot = FixtureManager.getFixtures().map(f => ({ id: f.id, channelValues: new Uint8Array(f.channelValues) }));
        FixtureManager.getFixtures().filter(f => f.flashEnabled).forEach(f => {
            const profile = FixtureManager.getProfile(f.profileId);
            const zoneCount = (profile && profile.hasZonePickers) ? Math.floor(f.channels / 3) : 0;
            if (zoneCount > 1) {
                for (let z = 0; z < zoneCount; z++) {
                    const off = (zoneCount - 1 - z) * 3;
                    FixtureManager.setChannelValue(f.id, off, 0);
                    FixtureManager.setChannelValue(f.id, off + 1, 0);
                    FixtureManager.setChannelValue(f.id, off + 2, 0);
                }
            } else if (FixtureManager.isRGBFixture(f)) {
                FixtureManager.setFixtureColor(f.id, 0, 0, 0);
            }
        });
        sendDMXBuffer();
        updateAllFixtureDisplays();
        toolbar.style.display = '';
        syncFlashButton();
        startFlashEngine();
    }
}

function isFlashToolbarVisible() {
    return document.getElementById('flashToolbar').style.display !== 'none';
}

function restartFlashEngine() {
    if (flashIntervalId) { clearInterval(flashIntervalId); flashIntervalId = null; }
    if (isFlashToolbarVisible()) startFlashEngine();
}

function handleTapTempo() {
    const now = performance.now();
    flashTapTimes.push(now);
    if (flashTapTimes.length > 8) flashTapTimes.shift();
    if (flashTapTimes.length >= 2) {
        const intervals = [];
        for (let i = 1; i < flashTapTimes.length; i++) {
            intervals.push(flashTapTimes[i] - flashTapTimes[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        flashBPM = Math.round(60000 / avgInterval);
        flashBPM = Math.max(30, Math.min(300, flashBPM));
        document.getElementById('flashBPM').textContent = flashBPM;
    }
    if (flashTapTimes.length >= 2) {
        const lastInterval = flashTapTimes[flashTapTimes.length - 1] - flashTapTimes[flashTapTimes.length - 2];
        if (lastInterval > 2000) flashTapTimes = [now];
    }
    restartFlashEngine();
}

function setupFlash() {
    const btnTap = document.getElementById('btnTapTempo');
    const colorMode = document.getElementById('flashColorMode');
    const colorGroup = document.getElementById('flashColorGroup');
    const triggerSel = document.getElementById('flashTrigger');
    const durationSel = document.getElementById('flashDuration');
    const flashMode = document.getElementById('flashMode');
    const flashReverse = document.getElementById('flashReverse');
    const flashReverseGroup = document.getElementById('flashReverseGroup');
    const flashToolbar = document.getElementById('flashToolbar');

    btnTap.addEventListener('click', () => {
        btnTap.classList.add('active');
        setTimeout(() => btnTap.classList.remove('active'), 100);
        handleTapTempo();
    });

    colorMode.addEventListener('change', () => {
        colorGroup.style.display = colorMode.value === 'specific' ? '' : 'none';
    });

    triggerSel.addEventListener('change', restartFlashEngine);
    durationSel.addEventListener('change', restartFlashEngine);
    flashMode.addEventListener('change', () => {
        flashReverseGroup.style.display = flashMode.value !== 'random' ? '' : 'none';
        restartFlashEngine();
    });
    flashReverse.addEventListener('change', restartFlashEngine);

    FixtureManager.onChange(() => updateFlashFixturesList());
    updateFlashFixturesList();
}

function updateFlashFixturesList() {
}

function triggerFlashFromMIDI() {
    const activeIds = FixtureManager.getFixtures().filter(f => f.flashEnabled).map(f => f.id);
    if (activeIds.length === 0) return;
    flashTick();
}

function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    hex = hex.trim();
    let r, g, b;
    const rgbMatch = hex.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3]);
    } else if (hex.startsWith('#') && hex.length >= 7) {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    } else {
        return null;
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { r, g, b };
}

function hexToHue(hex) {
    if (!hex || typeof hex !== 'string') return null;
    hex = hex.trim();
    let r, g, b;
    const rgbMatch = hex.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]) / 255;
        g = parseInt(rgbMatch[2]) / 255;
        b = parseInt(rgbMatch[3]) / 255;
    } else if (hex.startsWith('#') && hex.length >= 7) {
        r = parseInt(hex.slice(1, 3), 16) / 255;
        g = parseInt(hex.slice(3, 5), 16) / 255;
        b = parseInt(hex.slice(5, 7), 16) / 255;
    } else {
        return null;
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    return h;
}

function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q-p)*6*t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q-p)*(2/3-t)*6;
            return p;
        };
        const q = l < 0.5 ? l*(1+s) : l+s-l*s;
        const p = 2*l-q;
        r = hue2rgb(p, q, h+1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h-1/3);
    }
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

// ============================================
// MOMENTARY BUTTONS (legacy - removed)
// ============================================

function setupMomentaryButtons() {}

function setupOptionsModal() {
    const modal = document.getElementById('optionsModal');
    document.getElementById('btnOptionsRefreshPorts').addEventListener('click', renderOptionsPortList);

    document.getElementById('btnOptionsConnect').addEventListener('click', async () => {
        const portSelect = document.getElementById('optionsPortSelect');
        const statusDot = document.getElementById('optionsConnectionStatus');
        const btnConnect = document.getElementById('btnOptionsConnect');
        const isConnected = await window.serial.isConnected();
        if (isConnected) {
            await window.serial.disconnect();
        } else {
            const portPath = portSelect.value;
            if (!portPath) { showToast('Sélectionnez un port'); return; }
            statusDot.className = 'connection-dot connecting';
        const result = await window.serial.connect(portPath, 921600);
            if (result.success) {
                localStorage.setItem('dmx2_lastPort', portPath);
            } else {
                statusDot.className = 'connection-dot disconnected';
                showToast('Erreur: ' + result.error);
            }
        }
    });

    document.getElementById('closeOptions').addEventListener('click', () => modal.style.display = 'none');
    document.getElementById('btnCancelOptions').addEventListener('click', () => modal.style.display = 'none');
    document.getElementById('btnRefreshMidi').addEventListener('click', () => renderMidiPortList());

    document.getElementById('btnSaveOptions').addEventListener('click', () => {
        const checked = document.querySelectorAll('#midiPortList input[type="checkbox"]');
        const selectedPorts = [];
        checked.forEach(cb => {
            if (cb.checked) selectedPorts.push(cb.id.replace('midi-', ''));
        });
        const channel = parseInt(document.getElementById('midiChannelSelect').value) + 1;
        saveMidiSettings({ selectedPorts, channel });
        connectMidiInputs();
        modal.style.display = 'none';
        showToast('Options sauvegardées');
    });
}

async function renderOptionsPortList() {
    const portSelect = document.getElementById('optionsPortSelect');
    const ports = await window.serial.listPorts();
    const currentVal = portSelect.value;
    portSelect.innerHTML = '<option value="">-- Choisir un port --</option>';
    ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.path + (p.manufacturer ? ' (' + p.manufacturer + ')' : '');
        portSelect.appendChild(opt);
    });
    if (currentVal) portSelect.value = currentVal;
    const statusDot = document.getElementById('optionsConnectionStatus');
    const isConnected = await window.serial.isConnected();
    statusDot.className = 'connection-dot ' + (isConnected ? 'connected' : 'disconnected');
    document.getElementById('btnOptionsConnect').textContent = isConnected ? 'Déconnecter' : 'Connecter';
}

async function openOptionsModal() {
    await renderOptionsPortList();
    renderMidiPortList();
    const settings = getMidiSettings();
    document.getElementById('midiChannelSelect').value = (settings.channel || 7) - 1;
    document.getElementById('optionsModal').style.display = 'block';
}

function renderMomentaryButtons() {}

// ============================================
// PLAYLIST
// ============================================

function setupPlaylistModal() {
    function saveSidebarState(open, view) {
        localStorage.setItem('dmx2_sidebar', JSON.stringify({ open, view }));
    }

    function openSidebar(view) {
        const sidebar = document.getElementById('playlistSidebar');
        const isOpen = document.body.classList.contains('sidebar-open');
        const currentView = sidebar.dataset.currentView;

        if (isOpen && currentView === view) {
            document.body.classList.remove('sidebar-open');
            saveSidebarState(false, view);
            return;
        }

        document.body.classList.add('sidebar-open');
        sidebar.dataset.currentView = view;
        document.getElementById('sidebarTitle').textContent = view === 'live' ? 'LIVE' : 'Playlist';

        document.getElementById('liveView').style.display = view === 'live' ? 'flex' : 'none';
        document.getElementById('playlistView').style.display = view === 'playlist' ? 'flex' : 'none';

        loadPlaylist();
        if (view === 'playlist') renderPlaylist();
        if (view === 'live') { renderLiveButtons(); updateLiveDisplay(); }
        saveSidebarState(true, view);
    }

    document.getElementById('btnPlaylist').addEventListener('click', () => openSidebar('playlist'));
    document.getElementById('btnLive').addEventListener('click', () => openSidebar('live'));
    document.getElementById('closePlaylistSidebar').addEventListener('click', () => {
        document.body.classList.remove('sidebar-open');
        saveSidebarState(false, null);
    });

    // Restore sidebar state
    try {
        const stored = JSON.parse(localStorage.getItem('dmx2_sidebar'));
        if (stored && stored.open && stored.view) {
            openSidebar(stored.view);
        }
    } catch (e) {}
    const importInput = document.getElementById('playlistFileInput');
    if (importInput) importInput.addEventListener('change', importPlaylist);
    document.getElementById('playlistItems').addEventListener('click', (e) => {
        const t = e.target; const idx = parseInt(t.dataset.index);
        if (t.classList.contains('btn-load')) loadSongFromPlaylist(idx);
        else if (t.classList.contains('btn-save')) overwriteSongInPlaylist(idx);
        else if (t.classList.contains('btn-rename')) renameSongInPlaylist(idx);
        else if (t.classList.contains('btn-delete')) deleteSongFromPlaylist(idx);
    });

    // Context menu duplicate / delete
    let ctxIndex = -1;
    const ctxMenu = document.getElementById('playlistContextMenu');
    document.getElementById('playlistItems').addEventListener('contextmenu', (e) => {
        const li = e.target.closest('li');
        if (!li || !li.dataset.index) return;
        e.preventDefault();
        ctxIndex = parseInt(li.dataset.index);
        ctxMenu.style.left = e.pageX + 'px';
        ctxMenu.style.top = e.pageY + 'px';
        ctxMenu.style.display = 'block';
    });
    document.getElementById('ctxDuplicate').addEventListener('click', () => {
        ctxMenu.style.display = 'none';
        if (ctxIndex >= 0) duplicateSongInPlaylist(ctxIndex);
    });
    document.getElementById('ctxDelete').addEventListener('click', () => {
        ctxMenu.style.display = 'none';
        if (ctxIndex >= 0) deleteSongFromPlaylist(ctxIndex);
    });
    document.addEventListener('click', (e) => {
        if (ctxMenu && !ctxMenu.contains(e.target)) ctxMenu.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ctxMenu) ctxMenu.style.display = 'none';
    });
}

function loadPlaylist() {
    const stored = localStorage.getItem('dmx2_playlist');
    if (stored) { try { playlist = JSON.parse(stored); } catch (e) { playlist = []; } }
}

function savePlaylist() { localStorage.setItem('dmx2_playlist', JSON.stringify(playlist)); }

function getCurrentSetData() {
    const data = {
        fixtures: FixtureManager.getFixtures().map(f => ({
            id: f.id,
            name: f.name,
            profileId: f.profileId,
            channels: f.channels,
            startChannel: f.startChannel,
            color: f.color,
            channelValues: Array.from(f.channelValues),
            zoneLinks: f.zoneLinks ? { ...f.zoneLinks } : { l12: false, l34: false, lall: false },
            waveEnabled: f.waveEnabled,
            reverseWave: f.reverseWave || false,
            flashEnabled: f.flashEnabled || false,
            flashColorMode: f.flashColorMode || 'random',
            flashColor: f.flashColor || '#ffffff',
            momentaryEnabled: f.momentaryEnabled !== false
        })),
        scenes: JSON.parse(JSON.stringify(scenes)),
        momentanes: JSON.parse(JSON.stringify(momentanes)),
        sliders: {},
        spotLinks: {},
        groupColors: {},
        waveRunning: waveRunning,
        waveSpeed: parseInt(document.getElementById('waveSpeed').value) || 64,
        waveSpeedX2: document.getElementById('waveSpeedX2').checked,
        flashRunning: document.getElementById('flashToolbar').style.display !== 'none',
        flashTrigger: document.getElementById('flashTrigger').value,
        flashDuration: document.getElementById('flashDuration').value,
        flashColorMode: document.getElementById('flashColorMode').value,
        flashMode: document.getElementById('flashMode').value,
        flashReverse: document.getElementById('flashReverse').checked,
        flashBPM: flashBPM,
        flashStates: FixtureManager.getFixtures().reduce((acc, f) => { acc[f.id] = f.flashEnabled || false; return acc; }, {}),
        timestamp: Date.now()
    };

    sliderControlEntries.forEach(entry => {
        const key = entry.fixtureId + '_' + entry.offset;
        const slider = sliderElements[key];
        if (slider) data.sliders[key] = parseInt(slider.value) || 0;
    });

    const spotFixtures = FixtureManager.getSpotFixtures();
    const groupCount = Math.ceil(spotFixtures.length / 4);
    for (let g = 0; g < groupCount; g++) {
        const gid = 'sg_' + g;
        data.spotLinks[gid] = FixtureManager.getSpotLinkState(gid);
    }

    FixtureManager.getGroups().forEach(g => {
        data.groupColors[g.id] = g.color;
    });

    data.groups = FixtureManager.getGroups().map(g => ({
        name: g.name, fixtureIds: [...g.fixtureIds], color: g.color
    }));

    data.waveSpeed = parseInt(document.getElementById('waveSpeed').value) || 64;
    data.starEnabled = document.getElementById('starEnabled').checked;
    data.starFreq = parseInt(document.getElementById('starFreq').value) || 64;
    data.waveColorStart = document.getElementById('waveColorStart').value;
    data.waveColorEnd = document.getElementById('waveColorEnd').value;
    data.waveColorEnabled = document.getElementById('waveColorEnabled').checked;

    return data;
}

function loadSetData(setData) {
    if (!setData || !setData.fixtures) return;

    if (setData.fixtures) {
        setData.fixtures.forEach(sf => {
            let fixture = FixtureManager.getFixture(sf.id);
            if (!fixture && sf.name && sf.profileId) {
                FixtureManager.addFixture({
                    id: sf.id, name: sf.name, profileId: sf.profileId,
                    channels: sf.channels, startChannel: sf.startChannel, color: sf.color
                });
                fixture = FixtureManager.getFixture(sf.id);
            }
            if (fixture) {
                sf.channelValues.forEach((val, idx) => {
                    if (idx < fixture.channels) fixture.channelValues[idx] = val;
                });
                if (sf.zoneLinks) {
                    fixture.zoneLinks = { ...sf.zoneLinks };
                    FixtureManager.setZoneLink(sf.id, 'l12', sf.zoneLinks.l12);
                    FixtureManager.setZoneLink(sf.id, 'l34', sf.zoneLinks.l34);
                    FixtureManager.setZoneLink(sf.id, 'lall', sf.zoneLinks.lall);
                }
                if (sf.waveEnabled !== undefined) {
                    FixtureManager.setWaveEnabled(sf.id, sf.waveEnabled);
                }
                if (sf.reverseWave !== undefined) {
                    FixtureManager.setReverseWave(sf.id, sf.reverseWave);
                }
                if (sf.flashEnabled !== undefined) {
                    FixtureManager.setFlashEnabled(sf.id, sf.flashEnabled);
                }
                if (sf.flashColorMode !== undefined) {
                    FixtureManager.setFlashColorMode(sf.id, sf.flashColorMode);
                }
                if (sf.flashColor !== undefined) {
                    FixtureManager.setFlashColor(sf.id, sf.flashColor);
                }
                if (sf.momentaryEnabled !== undefined) {
                    FixtureManager.setMomentaryEnabled(sf.id, sf.momentaryEnabled);
                }
            }
        });
    }

    if (setData.scenes && Array.isArray(setData.scenes)) {
        setData.scenes.forEach((s, i) => { if (i < SCENE_REGULAR_COUNT) scenes[i] = s; });
    } else if (setData.scenes && typeof setData.scenes === 'object' && setData.scenes.lente && setData.scenes.lente.scenes) {
        Object.entries(setData.scenes.lente.scenes).forEach(([k, v]) => {
            const idx = parseInt(k);
            if (idx < SCENE_REGULAR_COUNT) scenes[idx] = v;
        });
    }
    if (setData.momentanes && Array.isArray(setData.momentanes)) {
        setData.momentanes.forEach((s, i) => { if (i < SCENE_MOMENTARY_COUNT) momentanes[i] = s; });
    } else if (setData.scenes && typeof setData.scenes === 'object' && setData.scenes.momentane && setData.scenes.momentane.scenes) {
        Object.entries(setData.scenes.momentane.scenes).forEach(([k, v]) => {
            const idx = parseInt(k);
            if (idx < SCENE_MOMENTARY_COUNT) momentanes[idx] = v;
        });
    }
    if (setData.scenes || setData.momentanes) {
        saveScenes();
        restoreAllSceneButtons();
    }

    if (setData.sliders) {
        Object.entries(setData.sliders).forEach(([key, val]) => {
            const slider = sliderElements[key];
            if (slider) slider.value = val;
            const [fixtureId, offset] = key.split('_');
            const f = FixtureManager.getFixture(fixtureId);
            if (f) FixtureManager.setChannelValue(fixtureId, parseInt(offset), val);
        });
    }

    if (setData.spotLinks) {
        Object.entries(setData.spotLinks).forEach(([gid, links]) => {
            FixtureManager.setSpotLink(gid, 'l12', links.l12);
            FixtureManager.setSpotLink(gid, 'l34', links.l34);
            FixtureManager.setSpotLink(gid, 'lall', links.lall);
        });
    }

    if (setData.groups) {
        setData.groups.forEach(g => {
            if (g.name && g.fixtureIds && g.fixtureIds.length > 0) {
                FixtureManager.addGroup(g.name, g.fixtureIds, g.color);
            }
        });
    }

    if (setData.waveRunning !== undefined) {
        if (setData.waveRunning && !waveRunning) toggleWave();
        else if (!setData.waveRunning && waveRunning) toggleWave();
    }
    syncWaveButton();

    if (setData.waveSpeed !== undefined) {
        document.getElementById('waveSpeed').value = setData.waveSpeed;
    }
    if (setData.waveSpeedX2 !== undefined) {
        document.getElementById('waveSpeedX2').checked = setData.waveSpeedX2;
    }
    if (setData.flashRunning !== undefined) {
        const flashVisible = document.getElementById('flashToolbar').style.display !== 'none';
        if (setData.flashRunning && !flashVisible) toggleFlash();
        else if (!setData.flashRunning && flashVisible) toggleFlash();
    }
    if (setData.starEnabled !== undefined) {
        document.getElementById('starEnabled').checked = setData.starEnabled;
        document.getElementById('starFreqGroup').style.display = setData.starEnabled ? '' : 'none';
    }
    if (setData.starFreq !== undefined) {
        document.getElementById('starFreq').value = setData.starFreq;
    }
    if (setData.waveColorStart !== undefined) {
        document.getElementById('waveColorStart').value = setData.waveColorStart;
    }
    if (setData.waveColorEnd !== undefined) {
        document.getElementById('waveColorEnd').value = setData.waveColorEnd;
    }
    if (setData.waveColorEnabled !== undefined) {
        document.getElementById('waveColorEnabled').checked = setData.waveColorEnabled;
        document.getElementById('waveColorGroup').style.display = setData.waveColorEnabled ? '' : 'none';
    }

    if (setData.flashTrigger !== undefined) document.getElementById('flashTrigger').value = setData.flashTrigger;
    if (setData.flashDuration !== undefined) document.getElementById('flashDuration').value = setData.flashDuration;
    if (setData.flashColorMode !== undefined) {
        document.getElementById('flashColorMode').value = setData.flashColorMode;
        document.getElementById('flashColorGroup').style.display = setData.flashColorMode === 'specific' ? '' : 'none';
    }
    if (setData.flashMode !== undefined) {
        document.getElementById('flashMode').value = setData.flashMode;
        document.getElementById('flashReverseGroup').style.display = setData.flashMode !== 'random' ? '' : 'none';
    }
    if (setData.flashReverse !== undefined) document.getElementById('flashReverse').checked = setData.flashReverse;
    if (setData.flashBPM !== undefined) {
        flashBPM = setData.flashBPM;
        document.getElementById('flashBPM').textContent = flashBPM || '---';
    }
    if (setData.flashStates) {
        stopFlashEngine();
        Object.entries(setData.flashStates).forEach(([fid, active]) => {
            const f = FixtureManager.getFixture(fid);
            if (f) f.flashEnabled = active;
        });
        updateFlashFixturesList();
        document.querySelectorAll('.fixture-flash-cb').forEach(cb => {
            const fid = cb.dataset.id;
            if (fid && setData.flashStates[fid] !== undefined) cb.checked = setData.flashStates[fid];
        });
        if (isFlashToolbarVisible()) restartFlashEngine();
    }

    renderAllFixtures();
    updateSlidersVisibility();
    sendDMXBuffer();
}

// ============================================
// LIVE MODE (sidebar)
// ============================================

let liveTransitionId = null;

function renderLiveButtons() {
    const container = document.getElementById('liveButtons');
    container.innerHTML = '';
    playlist.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'live-btn' + (index === currentSongIndex ? ' active' : '');
        const transition = typeof song.transition === 'number' ? song.transition : 1;

        const numSpan = document.createElement('span');
        numSpan.className = 'live-btn-num';
        numSpan.textContent = index + 1;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'live-btn-name';
        nameSpan.textContent = song.name || 'Sans nom';
        const sn = (song.name || '').toLowerCase().replace(/[\s_-]/g, '');
        if (sn === 'blackout') nameSpan.classList.add('live-name-blackout');
        else if (sn === 'white' || sn === 'lumières' || sn === 'lumieres') nameSpan.classList.add('live-name-white');

        const transInput = document.createElement('input');
        transInput.type = 'number';
        transInput.className = 'live-btn-trans';
        transInput.min = '0';
        transInput.max = '30';
        transInput.step = '0.1';
        transInput.value = transition;
        transInput.title = 'Transition (s)';

        numSpan.addEventListener('click', () => liveLoadSong(index));
        nameSpan.addEventListener('click', () => liveLoadSong(index));
        transInput.addEventListener('click', (e) => e.stopPropagation());
        transInput.addEventListener('mousedown', (e) => e.stopPropagation());
        transInput.addEventListener('change', () => {
            const v = parseFloat(transInput.value);
            playlist[index].transition = isNaN(v) ? 1 : Math.max(0, Math.min(30, v));
            savePlaylist();
            if (window._autoSave) window._autoSave();
        });

        row.appendChild(numSpan);
        row.appendChild(nameSpan);
        row.appendChild(transInput);
        container.appendChild(row);
    });
}

function getSongTransitionSec(index) {
    const song = playlist[index];
    if (song && typeof song.transition === 'number') return Math.max(0, Math.min(10, song.transition));
    return 1;
}

function updateLiveDisplay() {
    const el = document.getElementById('liveCurrentSong');
    if (currentSongIndex >= 0 && playlist[currentSongIndex]) {
        el.textContent = playlist[currentSongIndex].name;
    } else {
        el.textContent = 'Aucune chanson';
    }
    document.querySelectorAll('.live-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === currentSongIndex);
    });
}

function applySongEndState(setData) {
    if (setData.fixtures) {
        setData.fixtures.forEach(sf => {
            const fixture = FixtureManager.getFixture(sf.id);
            if (fixture && sf.zoneLinks) {
                fixture.zoneLinks = { ...sf.zoneLinks };
            }
            if (fixture && sf.waveEnabled !== undefined) {
                FixtureManager.setWaveEnabled(sf.id, sf.waveEnabled);
            }
            if (fixture && sf.reverseWave !== undefined) {
                FixtureManager.setReverseWave(sf.id, sf.reverseWave);
            }
        });
    }
    if (setData.waveRunning !== undefined) {
        if (setData.waveRunning && !waveRunning) toggleWave();
        else if (!setData.waveRunning && waveRunning) toggleWave();
    }
    syncWaveButton();
}

function liveLoadSong(index) {
    if (!playlist[index]) return;
    if (liveTransitionId) { cancelAnimationFrame(liveTransitionId); liveTransitionId = null; }

    currentSongIndex = index;
    updateLiveDisplay();
    updateCurrentSongDisplay();

    const setData = playlist[index].data;
    if (!setData || !setData.fixtures) return;

    // Sync fixtures du nouveau morceau avant lancement scène 1 (évite inversion ancien morceau)
    if (setData.fixtures) {
        let needsRender = false;
        setData.fixtures.forEach(sf => {
            let f = FixtureManager.getFixture(sf.id);
            if (!f && sf.name && sf.profileId) {
                FixtureManager.addFixture({ id: sf.id, name: sf.name, profileId: sf.profileId, channels: sf.channels, startChannel: sf.startChannel, color: sf.color });
                f = FixtureManager.getFixture(sf.id);
                needsRender = true;
            }
            if (f && sf.momentaryEnabled !== undefined) {
                FixtureManager.setMomentaryEnabled(sf.id, sf.momentaryEnabled);
            }
            if (f && sf.flashEnabled !== undefined) {
                FixtureManager.setFlashEnabled(sf.id, sf.flashEnabled);
            }
            if (f && sf.flashColorMode !== undefined) {
                FixtureManager.setFlashColorMode(sf.id, sf.flashColorMode);
            }
            if (f && sf.flashColor !== undefined) {
                FixtureManager.setFlashColor(sf.id, sf.flashColor);
            }
        });
        if (needsRender) { renderAllFixtures(); updateSlidersVisibility(); }
        else { updateMomentaryCheckboxes(); }
    }

    if (setData.spotLinks) {
        Object.entries(setData.spotLinks).forEach(([gid, links]) => {
            FixtureManager.setSpotLink(gid, 'l12', links.l12);
            FixtureManager.setSpotLink(gid, 'l34', links.l34);
            FixtureManager.setSpotLink(gid, 'lall', links.lall);
        });
    }

    if (setData.waveSpeed !== undefined) {
        document.getElementById('waveSpeed').value = setData.waveSpeed;
    }
    if (setData.waveSpeedX2 !== undefined) {
        document.getElementById('waveSpeedX2').checked = setData.waveSpeedX2;
    }
    if (setData.flashRunning !== undefined) {
        const flashVisible = document.getElementById('flashToolbar').style.display !== 'none';
        if (setData.flashRunning && !flashVisible) toggleFlash();
        else if (!setData.flashRunning && flashVisible) toggleFlash();
    }
    if (setData.starEnabled !== undefined) {
        document.getElementById('starEnabled').checked = setData.starEnabled;
        document.getElementById('starFreqGroup').style.display = setData.starEnabled ? '' : 'none';
    }
    if (setData.starFreq !== undefined) {
        document.getElementById('starFreq').value = setData.starFreq;
    }
    if (setData.waveColorStart !== undefined) {
        document.getElementById('waveColorStart').value = setData.waveColorStart;
    }
    if (setData.waveColorEnd !== undefined) {
        document.getElementById('waveColorEnd').value = setData.waveColorEnd;
    }
    if (setData.waveColorEnabled !== undefined) {
        document.getElementById('waveColorEnabled').checked = setData.waveColorEnabled;
        document.getElementById('waveColorGroup').style.display = setData.waveColorEnabled ? '' : 'none';
    }

    if (setData.flashTrigger !== undefined) document.getElementById('flashTrigger').value = setData.flashTrigger;
    if (setData.flashDuration !== undefined) document.getElementById('flashDuration').value = setData.flashDuration;
    if (setData.flashColorMode !== undefined) {
        document.getElementById('flashColorMode').value = setData.flashColorMode;
        document.getElementById('flashColorGroup').style.display = setData.flashColorMode === 'specific' ? '' : 'none';
    }
    if (setData.flashMode !== undefined) {
        document.getElementById('flashMode').value = setData.flashMode;
        document.getElementById('flashReverseGroup').style.display = setData.flashMode !== 'random' ? '' : 'none';
    }
    if (setData.flashReverse !== undefined) document.getElementById('flashReverse').checked = setData.flashReverse;
    if (setData.flashBPM !== undefined) {
        flashBPM = setData.flashBPM;
        document.getElementById('flashBPM').textContent = flashBPM || '---';
    }
    if (setData.flashStates) {
        stopFlashEngine();
        Object.entries(setData.flashStates).forEach(([fid, active]) => {
            const f = FixtureManager.getFixture(fid);
            if (f) f.flashEnabled = active;
        });
        updateFlashFixturesList();
        document.querySelectorAll('.fixture-flash-cb').forEach(cb => {
            const fid = cb.dataset.id;
            if (fid && setData.flashStates[fid] !== undefined) cb.checked = setData.flashStates[fid];
        });
        if (isFlashToolbarVisible()) restartFlashEngine();
    }

    if (setData.scenes && Array.isArray(setData.scenes)) {
        setData.scenes.forEach((s, i) => { if (i < SCENE_REGULAR_COUNT) scenes[i] = s; });
    } else if (setData.scenes && typeof setData.scenes === 'object') {
        // Migration ancien format: lente.scenes[0..9] → scenes[0..9]
        if (setData.scenes.lente && setData.scenes.lente.scenes) {
            Object.entries(setData.scenes.lente.scenes).forEach(([k, v]) => {
                const idx = parseInt(k);
                if (idx < SCENE_REGULAR_COUNT) scenes[idx] = v;
            });
        }
    }
    if (setData.momentanes && Array.isArray(setData.momentanes)) {
        setData.momentanes.forEach((s, i) => { if (i < SCENE_MOMENTARY_COUNT) momentanes[i] = s; });
    } else if (setData.scenes && typeof setData.scenes === 'object' && setData.scenes.momentane) {
        Object.entries(setData.scenes.momentane.scenes).forEach(([k, v]) => {
            const idx = parseInt(k);
            if (idx < SCENE_MOMENTARY_COUNT) momentanes[idx] = v;
        });
    }
    if (setData.scenes || setData.momentanes) {
        saveScenes();
        restoreAllSceneButtons();
    }

    const hasSceneOne = !!(setData.scenes && Array.isArray(setData.scenes) && setData.scenes[0])
        || !!(setData.scenes && typeof setData.scenes === 'object' && setData.scenes.lente && setData.scenes.lente.scenes && setData.scenes.lente.scenes[0]);
    const songTransitionMs = getSongTransitionSec(index) * 1000;

    if (hasSceneOne) {
        applySongEndState(setData);
        launchSceneOneFromSetData(setData, songTransitionMs);
    } else {
        const duration = songTransitionMs;
        const startValues = Array.from(FixtureManager.getDMXChannels());
        const targetValues = new Uint8Array(512).fill(0);
        setData.fixtures.forEach(sf => {
            const fixture = FixtureManager.getFixture(sf.id);
            if (fixture) {
                const base = fixture.startChannel;
                sf.channelValues.forEach((val, idx) => {
                    if (base + idx < 512) targetValues[base + idx] = val;
                });
            }
        });
        const startTime = performance.now();
        function step(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const current = startValues.map((sv, i) => Math.round(sv + ((targetValues[i] || 0) - sv) * ease));
            applySceneValues(current);
            if (progress < 1) {
                liveTransitionId = requestAnimationFrame(step);
            } else {
                liveTransitionId = null;
                applySongEndState(setData);
            }
        }
        liveTransitionId = requestAnimationFrame(step);
    }
    showToast('→ ' + playlist[index].name);
}

function renderPlaylist() {
    const list = document.getElementById('playlistItems');
    list.innerHTML = '';
    playlist.forEach((song, index) => {
        const li = document.createElement('li');
        li.draggable = true; li.dataset.index = index;
        li.innerHTML = `
            <div class="playlist-item-top">
                <span class="playlist-item-number">${index + 1}</span>
                <span class="playlist-item-name">${escapeHtml(song.name || 'Sans nom')}</span>
            </div>
            <div class="playlist-item-actions">
                <button class="btn-rename" data-index="${index}">Renommer</button>
                <button class="btn-save" data-index="${index}">Sauvegarder</button>
                <button class="btn-load" data-index="${index}">Charger</button>
                <button class="btn-delete" data-index="${index}">X</button>
            </div>`;
        list.appendChild(li);
    });
    setupDragAndDrop();
    const sidebar = document.getElementById('playlistSidebar');
    if (sidebar.dataset.currentView === 'live') {
        renderLiveButtons();
        updateLiveDisplay();
    }
}

function setupDragAndDrop() {
    const list = document.getElementById('playlistItems');
    let draggedItem = null;
    list.querySelectorAll('li').forEach(li => {
        li.addEventListener('dragstart', (e) => { draggedItem = li; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        li.addEventListener('dragend', () => { li.classList.remove('dragging'); draggedItem = null; });
        li.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedItem) return;
            const from = parseInt(draggedItem.dataset.index);
            const to = parseInt(li.dataset.index);
            if (from !== to) { const item = playlist.splice(from, 1)[0]; playlist.splice(to, 0, item); savePlaylist(); renderPlaylist(); renderLiveButtons(); }
        });
    });
}

function updateCurrentSongDisplay() {
    const display = document.getElementById('currentSongDisplay');
    const notesInput = document.getElementById('songNotes');
    display.textContent = (currentSongIndex >= 0 && playlist[currentSongIndex]) ? '♪ ' + playlist[currentSongIndex].name : '';
    if (notesInput) {
        notesInput.value = (currentSongIndex >= 0 && playlist[currentSongIndex] && playlist[currentSongIndex].notes) ? playlist[currentSongIndex].notes : '';
        notesInput.placeholder = (currentSongIndex >= 0) ? 'Notes...' : 'Notes... (sélectionnez une chanson)';
    }
}

async function saveCurrentToPlaylist() {
    const name = await customPrompt('Nom de la chanson :');
    if (!name || !name.trim()) return;
    try {
        const data = getCurrentSetData();
        playlist.push({ name: name.trim(), data, timestamp: Date.now(), transition: 1 });
        savePlaylist();
        renderPlaylist();
        renderLiveButtons();
        showToast('Chanson ajoutée : ' + name.trim());
    } catch (e) {
        console.error('Erreur sauvegarde:', e);
        showToast('Erreur de sauvegarde');
    }
}

function autoSaveCurrentSong() {
    if (currentSongIndex >= 0 && playlist[currentSongIndex]) {
        playlist[currentSongIndex].data = getCurrentSetData();
        playlist[currentSongIndex].timestamp = Date.now();
        savePlaylist();
        if (window._autoSave) window._autoSave();
    }
}

function loadSongFromPlaylist(index) {
    if (!playlist[index]) return;
    if (confirm('Charger "' + playlist[index].name + '" ?')) {
        currentSongIndex = index;
        updateCurrentSongDisplay();
        loadSetData(playlist[index].data);
        // changement de chanson -> lance scène 1 (global 1)
        setTimeout(() => launchSceneOne(), 100);
    }
}

function deleteSongFromPlaylist(index) {
    if (!playlist[index]) return;
    if (confirm('Supprimer "' + playlist[index].name + '" ?')) {
        playlist.splice(index, 1);
        if (currentSongIndex === index) { currentSongIndex = -1; updateCurrentSongDisplay(); }
        else if (currentSongIndex > index) { currentSongIndex--; updateCurrentSongDisplay(); }
        savePlaylist(); renderPlaylist(); renderLiveButtons();
    }
}

function duplicateSongInPlaylist(index) {
    if (!playlist[index]) return;
    const copy = JSON.parse(JSON.stringify(playlist[index]));
    copy.name = playlist[index].name + ' (copie)';
    copy.timestamp = Date.now();
    playlist.splice(index + 1, 0, copy);
    savePlaylist(); renderPlaylist(); renderLiveButtons();
    showToast('Dupliqué : ' + copy.name);
}

async function renameSongInPlaylist(index) {
    const newName = await customPrompt('Nouveau nom :', playlist[index].name);
    if (newName && newName.trim()) { playlist[index].name = newName.trim(); savePlaylist(); renderPlaylist(); }
}

function overwriteSongInPlaylist(index) {
    if (!confirm('Écraser "' + playlist[index].name + '" ?')) return;
    playlist[index].data = getCurrentSetData();
    playlist[index].timestamp = Date.now();
    savePlaylist(); renderPlaylist();
}

async function saveCurrentSong() {
    try {
        const setData = getCurrentSetData();
        if (currentSongIndex >= 0 && playlist[currentSongIndex]) {
            if (confirm('Écraser "' + playlist[currentSongIndex].name + '" ?')) {
                playlist[currentSongIndex].data = setData;
                playlist[currentSongIndex].timestamp = Date.now();
                savePlaylist();
                showToast('Chanson sauvegardée');
            }
        } else {
            const name = await customPrompt('Nom de la chanson :');
            if (!name || !name.trim()) return;
            playlist.push({ name: name.trim(), data: setData, timestamp: Date.now(), transition: 1 });
                currentSongIndex = playlist.length - 1;
                updateCurrentSongDisplay();
                renderPlaylist();
                renderLiveButtons();
                savePlaylist();
                showToast('Nouvelle chanson ajoutée');
        }
    } catch (e) {
        console.error('Erreur sauvegarde:', e);
        showToast('Erreur de sauvegarde');
    }
}

async function saveNewSong() {
    try {
        const name = await customPrompt('Nom de la chanson :');
        if (!name || !name.trim()) return;
        const data = getCurrentSetData();
        playlist.push({ name: name.trim(), data, timestamp: Date.now(), transition: 1 });
        currentSongIndex = playlist.length - 1;
        updateCurrentSongDisplay();
        renderPlaylist();
        renderLiveButtons();
        savePlaylist();
        showToast('Nouvelle chanson ajoutée : ' + name.trim());
    } catch (e) {
        console.error('Erreur sauvegarde:', e);
        showToast('Erreur de sauvegarde');
    }
}

function exportPlaylist() {
    if (playlist.length === 0) { showToast('Playlist vide'); return; }
    const blob = new Blob([JSON.stringify(playlist, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dmx_playlist.json'; a.click();
    URL.revokeObjectURL(url);
}

function importPlaylist(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const imported = JSON.parse(event.target.result);
            if (Array.isArray(imported)) { playlist = imported; savePlaylist(); renderPlaylist(); renderLiveButtons(); showToast('Playlist importée: ' + playlist.length + ' chansons'); }
            else showToast('Format invalide');
        } catch (err) { showToast('Erreur d\'import'); }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// ============================================
// UTILITIES
// ============================================

function parseRGB(value) {
    if (!value) return { r: 0, g: 0, b: 0 };
    if (value.startsWith('rgb')) {
        const parts = value.replace(/[rgb()]/g, '').split(',').map(s => parseInt(s.trim()));
        return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
    }
    if (value.startsWith('#')) {
        const hex = value.slice(1);
        return {
            r: parseInt(hex.slice(0, 2), 16) || 0,
            g: parseInt(hex.slice(2, 4), 16) || 0,
            b: parseInt(hex.slice(4, 6), 16) || 0
        };
    }
    return { r: 0, g: 0, b: 0 };
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function customPrompt(title, defaultValue) {
    return new Promise((resolve) => {
        const modal = document.getElementById('promptModal');
        const input = document.getElementById('promptInput');
        document.getElementById('promptTitle').textContent = title;
        input.value = defaultValue || '';
        modal.style.display = 'block';
        modal.style.zIndex = '2500';
        if (window.Coloris) try { window.Coloris.close(); } catch(e) {}
        // avoid duplicate listeners if prompt re-entered quickly
        const okBtn = document.getElementById('promptOk');
        const cancelBtn = document.getElementById('promptCancel');
        // close on click outside
        const onOutside = (e) => { if (e.target === modal) { cleanup(); resolve(null); } };
        setTimeout(() => document.addEventListener('click', onOutside), 0);
        setTimeout(() => {
            input.removeAttribute('readonly');
            input.focus();
            input.select();
            input.click();
        }, 80);
        const cleanup = () => {
            modal.style.display = 'none';
            input.removeEventListener('keydown', onKey);
            document.removeEventListener('click', onOutside);
            okBtn.onclick = null;
            cancelBtn.onclick = null;
        };
        function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); cleanup(); resolve(input.value.trim()); }
            if (e.key === 'Escape') { e.preventDefault(); cleanup(); resolve(null); }
        }
        input.addEventListener('keydown', onKey);
        okBtn.onclick = () => { cleanup(); resolve(input.value.trim()); };
        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        // prevent mousedown inside modal from bubbling to Coloris close handler
        const stop = (e) => e.stopPropagation();
        input.addEventListener('mousedown', stop, { once: true });
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.className = 'toast hidden'; }, 2000);
}
