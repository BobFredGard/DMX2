# Prototype Tauri (branche `tauri-prototype`) — n'impacte pas Electron/`main`.

Objectif : mesurer l'effort d'un portage LumiDMX Electron → Tauri.
Périmètre volontairement minimal :
- fenêtre Tauri (UI vanilla, sans npm, via `withGlobalTauri`)
- série : lister / ouvrir / fermer / envoyer une trame `FF 00 NB_H NB_L … CHECKSUM` (cf. `electron/main.js`)
- MIDI entrée : lister / écouter, les Control Change remontent en event `midi-cc` (cf. `handleMIDIMessage`, CC seuls)

## Prérequis
- Rust stable (`cargo --version`) + MSVC + Windows SDK (déjà OK sur ce poste)
- Pas de `npm install` : pas de dépendance JS.

## Vérifier la compilation (sans linker ni WebView)
```powershell
$env:CARGO_TARGET_DIR = "C:\Users\PCCAO\AppData\Local\Temp\opencode\cargo-target"
$env:Path = "C:\Users\PCCAO\.cargo\bin;" + $env:Path
cd tauri-proto\src-tauri
cargo check
```
`CARGO_TARGET_DIR` hors iCloud : évite les verrous de synchro constatés sur ce repo.

## Lancer (nécessite WebView2, présent sur Win10/11)
L'UI est embarquée en direct (`frontendDist`), aucun serveur requis :
```powershell
$env:CARGO_TARGET_DIR = "C:\Users\PCCAO\AppData\Local\Temp\opencode\cargo-target"
$env:Path = "C:\Users\PCCAO\.cargo\bin;" + $env:Path
cd tauri-proto\src-tauri
cargo run
```
Au chargement, l'UI appelle `list_serial_ports` toute seule (preuve du bridge,
tracée `proto: commande … reçue` dans la sortie).

## Fichiers
- `src-tauri/Cargo.toml` : `tauri 2`, `serialport 4`, `midir 0.10`, `serde`
- `src-tauri/src/main.rs` : 7 commandes (`list_serial_ports`, `open_serial`, `close_serial`,
  `send_dmx`, `list_midi_ports`, `start_midi`, `stop_midi`) + event `midi-cc`
- `ui/` : page de test vanilla
