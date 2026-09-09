// ============================================
// FIXTURE MANAGEMENT SYSTEM
// ============================================

const FixtureManager = (() => {
    let fixtures = [];
    let profiles = [];
    let groups = [];
    let listeners = [];
    let saveTimeout = null;
    let spotLinkGroups = {};
    let customProfiles = [];

    const STORAGE_KEY = 'dmx2_state';
    const CUSTOM_PROFILES_KEY = 'dmx2_custom_profiles';

    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    }

    async function loadProfiles() {
        try {
            const resp = await fetch('./data/profiles.json');
            const data = await resp.json();
            profiles = data.profiles;
        } catch (e) {
            console.error('Error loading profiles:', e);
            profiles = [];
        }
        try {
            const raw = localStorage.getItem(CUSTOM_PROFILES_KEY);
            if (raw) {
                customProfiles = JSON.parse(raw);
                customProfiles.forEach(cp => {
                    if (!profiles.find(p => p.id === cp.id)) profiles.push(cp);
                });
            }
        } catch (e) {
            console.error('Error loading custom profiles:', e);
        }
    }

    // ============================================
    // FIXTURE MANAGEMENT
    // ============================================

    function getNextAvailableChannel() {
        if (fixtures.length === 0) return 1;
        const sorted = [...fixtures].sort((a, b) => a.startChannel - b.startChannel);
        let next = 1;
        for (const f of sorted) {
            if (f.startChannel > next) return next;
            next = f.startChannel + f.channels;
        }
        return next;
    }

    function isChannelRangeFree(start, count, excludeId = null) {
        for (const f of fixtures) {
            if (f.id === excludeId) continue;
            const fEnd = f.startChannel + f.channels - 1;
            const newEnd = start + count - 1;
            if (start <= fEnd && newEnd >= f.startChannel) return false;
        }
        return true;
    }

    function addFixture(config) {
        const profile = getProfile(config.profileId);
        const fixture = {
            id: config.id || generateId('fix'),
            name: config.name || 'Appareil',
            profileId: config.profileId || 'custom',
            channels: config.channels || 3,
            startChannel: config.startChannel || 1,
            color: config.color || '#ff4444',
            waveEnabled: config.waveEnabled !== undefined ? config.waveEnabled : false,
            momentaryEnabled: config.momentaryEnabled !== undefined ? config.momentaryEnabled : true,
            zoneLinks: config.zoneLinks || { l12: false, l34: false, lall: false },
            reverseWave: config.reverseWave || false,
            flashEnabled: config.flashEnabled || false,
            flashColorMode: config.flashColorMode || 'random',
            flashColor: config.flashColor || '#ffffff',
            channelValues: new Uint8Array(config.channels || 3).fill(0)
        };
        if (profile && profile.controls) {
            profile.controls.forEach(c => {
                if (c.type === 'slider' && (c.name === 'Dimmer' || c.name === 'Master') && c.offset !== undefined) {
                    fixture.channelValues[c.offset] = 255;
                }
            });
        }
        fixtures.push(fixture);
        fixtures.sort((a, b) => a.startChannel - b.startChannel);
        scheduleSave();
        notifyListeners('add', fixture);
        return fixture;
    }

    function removeFixture(id) {
        const idx = fixtures.findIndex(f => f.id === id);
        if (idx === -1) return null;
        const removed = fixtures.splice(idx, 1)[0];
        groups.forEach(g => {
            g.fixtureIds = g.fixtureIds.filter(fid => fid !== id);
        });
        groups = groups.filter(g => g.fixtureIds.length > 0);
        rebuildSpotLinkGroups();
        scheduleSave();
        notifyListeners('remove', removed);
        return removed;
    }

    function getFixtures() { return [...fixtures]; }
    function getFixture(id) { return fixtures.find(f => f.id === id); }
    function getProfiles() { return [...profiles]; }
    function getProfile(profileId) { return profiles.find(p => p.id === profileId); }

    function setChannelValue(fixtureId, channelOffset, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.channelValues[channelOffset] = Math.max(0, Math.min(255, value));
        scheduleSave();
        notifyListeners('valueChange', { fixture, channelOffset, value: fixture.channelValues[channelOffset] });
    }

    function ensureAllFixturesDimmerActive() {
        fixtures.forEach(f => ensureDimmerActive(f));
    }

    function setChannelValuesBulk(fixtureId, values) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        values.forEach((val, idx) => {
            if (idx < fixture.channels) {
                fixture.channelValues[idx] = Math.max(0, Math.min(255, val));
            }
        });
        scheduleSave();
        notifyListeners('valueChange', { fixture, channelOffset: 0, value: fixture.channelValues[0] });
    }

    function getDMXChannels() {
        const maxChannel = fixtures.reduce((max, f) => {
            const end = f.startChannel + f.channels - 1;
            return end > max ? end : max;
        }, 0);
        const channels = new Uint8Array(Math.max(maxChannel, 512)).fill(0);
        for (const f of fixtures) {
            for (let i = 0; i < f.channels; i++) {
                const dmxIdx = f.startChannel + i;
                if (dmxIdx < 512) channels[dmxIdx] = Math.min(255, (f.channelValues[i] || 0));
            }
        }
        return channels;
    }

    // ============================================
    // COLOR HELPERS
    // ============================================

    function getRGBOffsets(fixture) {
        const profile = getProfile(fixture.profileId);
        if (!profile || !profile.controls) return null;
        let r = null, g = null, b = null;
        profile.controls.forEach(c => {
            if (c.type === 'channel') {
                const name = c.name.toLowerCase();
                if (name === 'rouge' || name === 'red') r = c.offset;
                if (name === 'vert' || name === 'green') g = c.offset;
                if (name === 'bleu' || name === 'blue') b = c.offset;
            }
        });
        if (r !== null && g !== null && b !== null) return { r, g, b };
        return null;
    }

    function ensureDimmerActive(fixture) {
        if (!fixture) return;
        const profile = getProfile(fixture.profileId);
        if (!profile || !profile.controls) return;
        profile.controls.forEach(c => {
            if (c.type === 'slider' && (c.name === 'Dimmer' || c.name === 'Master') && c.offset !== undefined) {
                if (fixture.channelValues[c.offset] === 0) {
                    fixture.channelValues[c.offset] = 255;
                }
            }
        });
    }

    function setFixtureColor(fixtureId, r, g, b) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        const offsets = getRGBOffsets(fixture);
        if (!offsets) return;
        ensureDimmerActive(fixture);
        const profile = getProfile(fixture.profileId);
        if (profile && profile.controls) {
            profile.controls.forEach(c => {
                if (c.type === 'slider' && (c.name.toLowerCase() === 'blanc' || c.name.toLowerCase() === 'white') && c.offset !== undefined) {
                    fixture.channelValues[c.offset] = 0;
                }
            });
        }
        fixture.channelValues[offsets.r] = r;
        fixture.channelValues[offsets.g] = g;
        fixture.channelValues[offsets.b] = b;
        scheduleSave();
        notifyListeners('colorChange', { fixture, r, g, b });
    }

    function setWaveEnabled(fixtureId, enabled) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.waveEnabled = enabled;
        scheduleSave();
    }

    function setReverseWave(fixtureId, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.reverseWave = value;
        scheduleSave();
    }

    function setFlashEnabled(fixtureId, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.flashEnabled = value;
        scheduleSave();
    }

    function setFlashColorMode(fixtureId, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.flashColorMode = value;
        scheduleSave();
    }

    function setFlashColor(fixtureId, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.flashColor = value;
        scheduleSave();
    }

    function setMomentaryEnabled(fixtureId, enabled) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.momentaryEnabled = enabled;
        scheduleSave();
    }

    function renameFixture(fixtureId, newName) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return;
        fixture.name = newName;
        scheduleSave();
        notifyListeners('rename', fixture);
    }

    function setZoneLink(fixtureId, link, value) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture || !fixture.zoneLinks) return;
        fixture.zoneLinks[link] = value;
        scheduleSave();
    }

    function getZoneLinks(fixtureId) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        return fixture ? fixture.zoneLinks : null;
    }

    function getFixtureRGB(fixtureId) {
        const fixture = fixtures.find(f => f.id === fixtureId);
        if (!fixture) return null;
        const offsets = getRGBOffsets(fixture);
        if (!offsets) return null;
        return {
            r: fixture.channelValues[offsets.r],
            g: fixture.channelValues[offsets.g],
            b: fixture.channelValues[offsets.b]
        };
    }

    function isRGBFixture(fixture) {
        return getRGBOffsets(fixture) !== null;
    }

    function setAllRGB(r, g, b) {
        fixtures.forEach(f => {
            const profile = getProfile(f.profileId);
            if (profile && profile.hasZonePickers) {
                const zoneCount = Math.floor(f.channels / 3);
                for (let z = 0; z < zoneCount; z++) {
                    f.channelValues[z * 3] = r;
                    f.channelValues[z * 3 + 1] = g;
                    f.channelValues[z * 3 + 2] = b;
                }
                scheduleSave();
                notifyListeners('valueChange', { fixture: f, channelOffset: 0, value: f.channelValues[0] });
            } else if (isRGBFixture(f)) {
                setFixtureColor(f.id, r, g, b);
            }
        });
    }

    // ============================================
    // GROUP MANAGEMENT
    // ============================================

    function addGroup(name, fixtureIds, color) {
        const group = {
            id: generateId('grp'),
            name: name || 'Groupe',
            fixtureIds: fixtureIds || [],
            color: color || '#00b4dc'
        };
        groups.push(group);
        scheduleSave();
        notifyListeners('groupAdd', group);
        return group;
    }

    function removeGroup(id) {
        const idx = groups.findIndex(g => g.id === id);
        if (idx === -1) return null;
        const removed = groups.splice(idx, 1)[0];
        scheduleSave();
        notifyListeners('groupRemove', removed);
        return removed;
    }

    function renameGroup(id, newName) {
        const group = groups.find(g => g.id === id);
        if (!group) return;
        group.name = newName;
        scheduleSave();
        notifyListeners('groupUpdate', group);
    }

    function setGroupFixtures(id, fixtureIds) {
        const group = groups.find(g => g.id === id);
        if (!group) return;
        group.fixtureIds = fixtureIds;
        scheduleSave();
        notifyListeners('groupUpdate', group);
    }

    function addFixtureToGroup(groupId, fixtureId) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        if (!group.fixtureIds.includes(fixtureId)) {
            group.fixtureIds.push(fixtureId);
            scheduleSave();
            notifyListeners('groupUpdate', group);
        }
    }

    function removeFixtureFromGroup(groupId, fixtureId) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        group.fixtureIds = group.fixtureIds.filter(fid => fid !== fixtureId);
        scheduleSave();
        notifyListeners('groupUpdate', group);
    }

    function setGroupColor(groupId, r, g, b) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        group.fixtureIds.forEach(fid => {
            if (isRGBFixture(getFixture(fid))) {
                setFixtureColor(fid, r, g, b);
            }
        });
    }

    function getGroups() { return [...groups]; }
    function getGroup(id) { return groups.find(g => g.id === id); }

    // ============================================
    // SPOT LINK GROUPS
    // ============================================

    function getSpotFixtures() {
        return fixtures.filter(f => {
            const p = getProfile(f.profileId);
            return p && p.hasColorPicker && !p.hasZonePickers;
        }).sort((a, b) => a.startChannel - b.startChannel);
    }

    function getSpotLinkGroup(fixtureId) {
        const spotFixtures = getSpotFixtures();
        const idx = spotFixtures.findIndex(f => f.id === fixtureId);
        if (idx === -1) return null;
        const groupIdx = Math.floor(idx / 4);
        const groupId = 'sg_' + groupIdx;
        if (!spotLinkGroups[groupId]) {
            spotLinkGroups[groupId] = { links: { l12: false, l34: false, lall: false } };
        }
        const groupSize = Math.min(4, spotFixtures.length - groupIdx * 4);
        const indexInGroup = idx % 4;
        const linkPairs = [];
        for (let i = 0; i < groupSize - 1; i++) {
            linkPairs.push({ key: 'l' + (i + 1) + '' + (i + 2), from: i, to: i + 1 });
        }
        return { groupId, links: spotLinkGroups[groupId].links, indexInGroup, groupIndex: groupIdx, groupSize, linkPairs };
    }

    function rebuildSpotLinkGroups() {
        const spotFixtures = getSpotFixtures();
        const groupCount = Math.ceil(spotFixtures.length / 4);
        const newGroups = {};
        for (let g = 0; g < groupCount; g++) {
            const gid = 'sg_' + g;
            newGroups[gid] = spotLinkGroups[gid] || { links: { l12: false, l34: false, lall: false } };
        }
        spotLinkGroups = newGroups;
    }

    function setSpotLink(groupId, linkKey, value) {
        if (!spotLinkGroups[groupId]) {
            spotLinkGroups[groupId] = { links: { l12: false, l34: false, lall: false } };
        }
        spotLinkGroups[groupId].links[linkKey] = value;
        scheduleSave();
    }

    function getSpotLinkState(groupId) {
        if (!spotLinkGroups[groupId]) {
            spotLinkGroups[groupId] = { links: { l12: false, l34: false, lall: false } };
        }
        return spotLinkGroups[groupId].links;
    }

    function addCustomProfile(profile) {
        profiles.push(profile);
        customProfiles.push(profile);
        try {
            localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles));
        } catch (e) {
            console.error('Error saving custom profile:', e);
        }
    }

    function updateCustomProfile(profileId, updates) {
        const idx = profiles.findIndex(p => p.id === profileId);
        if (idx === -1) return false;
        Object.assign(profiles[idx], updates);
        const ci = customProfiles.findIndex(p => p.id === profileId);
        if (ci !== -1) Object.assign(customProfiles[ci], updates);
        try {
            localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles));
        } catch (e) {
            console.error('Error saving custom profile:', e);
        }
        return true;
    }

    function removeCustomProfile(profileId) {
        const ci = customProfiles.findIndex(p => p.id === profileId);
        if (ci === -1) return false;
        customProfiles.splice(ci, 1);
        const pi = profiles.findIndex(p => p.id === profileId);
        if (pi !== -1) profiles.splice(pi, 1);
        try {
            localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(customProfiles));
        } catch (e) {
            console.error('Error saving custom profile:', e);
        }
        return true;
    }

    function isCustomProfile(profileId) {
        return customProfiles.some(p => p.id === profileId);
    }

    function getFixturesUsingProfile(profileId) {
        return fixtures.filter(f => f.profileId === profileId);
    }

    function getGroupFixtures(groupId) {
        const group = groups.find(g => g.id === groupId);
        if (!group) return [];
        return group.fixtureIds.map(fid => fixtures.find(f => f.id === fid)).filter(Boolean);
    }

    function getFixtureGroups(fixtureId) {
        return groups.filter(g => g.fixtureIds.includes(fixtureId));
    }

    // ============================================
    // SLIDER CONTROLS (dynamic from profiles)
    // ============================================

    function getSliderControls() {
        const controlMap = {};
        fixtures.forEach(f => {
            const p = getProfile(f.profileId);
            if (!p || !p.controls) return;
            p.controls.forEach(ctrl => {
                if (ctrl.type !== 'slider') return;
                const key = ctrl.name;
                if (!controlMap[key]) controlMap[key] = [];
                controlMap[key].push({
                    fixtureId: f.id,
                    fixtureName: f.name,
                    offset: ctrl.offset,
                    dmxChannel: f.startChannel + ctrl.offset,
                    min: ctrl.min || 0,
                    max: ctrl.max || 255
                });
            });
        });
        return controlMap;
    }

    // ============================================
    // AUTO-SAVE / RESTORE
    // ============================================

    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(save, 500);
    }

    function save() {
        const state = {
            fixtures: fixtures.map(f => ({
                id: f.id,
                name: f.name,
                profileId: f.profileId,
                channels: f.channels,
                startChannel: f.startChannel,
                color: f.color,
                waveEnabled: f.waveEnabled,
                reverseWave: f.reverseWave || false,
                flashEnabled: f.flashEnabled || false,
                flashColorMode: f.flashColorMode || 'random',
                flashColor: f.flashColor || '#ffffff',
                momentaryEnabled: f.momentaryEnabled !== undefined ? f.momentaryEnabled : true,
                zoneLinks: f.zoneLinks || { l12: false, l34: false, lall: false },
                channelValues: Array.from(f.channelValues)
            })),
            groups: groups.map(g => ({
                id: g.id,
                name: g.name,
                fixtureIds: g.fixtureIds,
                color: g.color
            })),
            spotLinkGroups: spotLinkGroups,
            timestamp: Date.now()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error('Save error:', e);
        }
    }

    function restore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const state = JSON.parse(raw);

            fixtures = [];
            if (state.fixtures) {
                state.fixtures.forEach(f => {
                    fixtures.push({
                        ...f,
                        channelValues: new Uint8Array(f.channelValues)
                    });
                });
            }
            fixtures.sort((a, b) => a.startChannel - b.startChannel);

            groups = [];
            if (state.groups) {
                state.groups.forEach(g => {
                    groups.push({
                        id: g.id,
                        name: g.name,
                        fixtureIds: g.fixtureIds || [],
                        color: g.color || '#00b4dc'
                    });
                });
            }

            spotLinkGroups = state.spotLinkGroups || {};

            notifyListeners('restore', null);
            return fixtures.length > 0;
        } catch (e) {
            console.error('Restore error:', e);
            return false;
        }
    }

    function clearAll() {
        fixtures = [];
        groups = [];
        localStorage.removeItem(STORAGE_KEY);
        notifyListeners('clear', null);
    }

    // ============================================
    // EVENT SYSTEM
    // ============================================

    function onChange(callback) {
        listeners.push(callback);
        return () => { listeners = listeners.filter(l => l !== callback); };
    }

    function notifyListeners(event, data) {
        listeners.forEach(cb => cb(event, data));
    }

    // ============================================
    // INIT
    // ============================================

    async function init() {
        await loadProfiles();
    }

    return {
        init, restore, clearAll,
        addFixture, removeFixture, getFixtures, getFixture,
        getProfiles, getProfile,
        setChannelValue, setChannelValuesBulk, getDMXChannels,
        setFixtureColor, getFixtureRGB, isRGBFixture, setAllRGB, setWaveEnabled, setReverseWave, setMomentaryEnabled, setZoneLink, getZoneLinks,
        setFlashEnabled, setFlashColorMode, setFlashColor,
        renameFixture,
        getNextAvailableChannel, isChannelRangeFree,
        addGroup, removeGroup, renameGroup, setGroupFixtures,
        addFixtureToGroup, removeFixtureFromGroup, setGroupColor,
        getGroups, getGroup, getGroupFixtures, getFixtureGroups,
        getSpotFixtures, getSpotLinkGroup, setSpotLink, getSpotLinkState,
        getSliderControls, addCustomProfile, updateCustomProfile, removeCustomProfile, isCustomProfile, getFixturesUsingProfile,
        ensureDimmerActive,
        onChange
    };
})();
