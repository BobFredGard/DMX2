// UI vanilla : utilise le bridge global Tauri (withGlobalTauri: true).
const logEl = document.getElementById('log');
function log(msg) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

const T = window.__TAURI__;
if (!T) {
  document.getElementById('nontauri').style.display = 'block';
  log('ERREUR : bridge Tauri introuvable.');
} else {
  const invoke = T.core.invoke;
  const $ = (id) => document.getElementById(id);

  $('btnPorts').addEventListener('click', async () => {
    const ports = await invoke('list_serial_ports');
    $('selPorts').innerHTML = ports.map((p) => `<option>${p}</option>`).join('');
    log(`ports série : ${ports.join(', ') || '(aucun)'}`);
  });

  $('btnOpen').addEventListener('click', async () => {
    try {
      const msg = await invoke('open_serial', { name: $('selPorts').value, baud: parseInt($('baud').value, 10) });
      log(msg);
    } catch (e) { log(`ERREUR ouverture : ${e}`); }
  });

  $('btnClose').addEventListener('click', async () => {
    await invoke('close_serial');
    log('port série fermé.');
  });

  $('btnDmx').addEventListener('click', async () => {
    const channels = Array.from({ length: 64 }, (_, i) => (i * 4) % 256);
    try {
      await invoke('send_dmx', { channels });
      log('trame DMX 64 canaux envoyée (FF 00 … checksum).');
    } catch (e) { log(`ERREUR envoi : ${e}`); }
  });

  $('btnMidiPorts').addEventListener('click', async () => {
    const ports = await invoke('list_midi_ports');
    $('selMidi').innerHTML = ports.map((p) => `<option>${p}</option>`).join('');
    log(`ports MIDI : ${ports.join(', ') || '(aucun)'}`);
  });

  $('btnMidiStart').addEventListener('click', async () => {
    try {
      const msg = await invoke('start_midi', { portName: $('selMidi').value || null });
      log(msg);
    } catch (e) { log(`ERREUR MIDI : ${e}`); }
  });

  $('btnMidiStop').addEventListener('click', async () => {
    await invoke('stop_midi');
    log('écoute MIDI stoppée.');
  });

  // 1 CC reçu côté Rust -> affiché ici (miroir du handleMIDIMessage, CC seuls)
  T.event.listen('midi-cc', (ev) => {
    const { channel, cc, value } = ev.payload;
    log(`MIDI CC : canal=${channel} cc=${cc} value=${value}`);
  });

  log('proto prêt.');
  // Appel auto au chargement : prouve le round-trip invoke (visible dans la sortie Rust).
  (async () => {
    try {
      const ports = await invoke('list_serial_ports');
      $('selPorts').innerHTML = ports.map((p) => `<option>${p}</option>`).join('');
      log(`ports série (auto) : ${ports.join(', ') || '(aucun)'}`);
    } catch (e) { log(`ERREUR auto-liste : ${e}`); }
  })();
}
