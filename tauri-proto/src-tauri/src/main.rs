#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Prototype Tauri : fenetre + serie (protocole LumiDMX) + ecoute MIDI (1 CC -> event).
// Portage minimal de electron/main.js (dmx:send) et du MIDI renderer (handleMIDIMessage, CC seuls).

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

struct SerialState(Mutex<Option<Box<dyn serialport::SerialPort>>>);
struct MidiState(Mutex<Option<midir::MidiInputConnection<()>>>);

#[derive(Clone, serde::Serialize)]
struct MidiCc {
    channel: u8,
    cc: u8,
    value: u8,
}

// --- Serie ---------------------------------------------------------------

#[tauri::command]
fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

#[tauri::command]
fn open_serial(state: State<SerialState>, name: String, baud: u32) -> Result<String, String> {
    let port = serialport::new(&name, baud)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(port);
    Ok(format!("port {} ouvert @{}", name, baud))
}

#[tauri::command]
fn close_serial(state: State<SerialState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

// Trame LumiDMX : FF 00 NB_H NB_L CH1..CHn CHECKSUM(XOR), cf. electron/main.js (dmx:send)
#[tauri::command]
fn send_dmx(state: State<SerialState>, channels: Vec<u8>) -> Result<(), String> {
    let nb = channels.len();
    let mut packet = Vec::with_capacity(4 + nb + 1);
    packet.push(0xFF);
    packet.push(0x00);
    packet.push(((nb >> 8) & 0xFF) as u8);
    packet.push((nb & 0xFF) as u8);
    let mut checksum = packet[2] ^ packet[3];
    for c in &channels {
        packet.push(*c);
        checksum ^= *c;
    }
    packet.push(checksum);
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let port = guard.as_mut().ok_or("port serie ferme")?;
    use std::io::Write;
    port.write_all(&packet).map_err(|e| e.to_string())
}

// --- MIDI (entree, via midir ; remplace navigator.requestMIDIAccess) ------

#[tauri::command]
fn list_midi_ports() -> Vec<String> {
    match midir::MidiInput::new("LumiDMX-proto") {
        Ok(input) => input
            .ports()
            .iter()
            .filter_map(|p| input.port_name(p).ok())
            .collect(),
        Err(_) => Vec::new(),
    }
}

// Ecoute les Control Change et re-emet vers le frontend : event "midi-cc" {channel, cc, value}
#[tauri::command]
fn start_midi(
    app: AppHandle,
    state: State<MidiState>,
    port_name: Option<String>,
) -> Result<String, String> {
    // Ferme l'ecoute precedente éventuelle
    *state.0.lock().map_err(|e| e.to_string())? = None;

    let input = midir::MidiInput::new("LumiDMX-proto").map_err(|e| e.to_string())?;
    let ports = input.ports();
    let chosen = match &port_name {
        Some(want) => ports
            .iter()
            .find(|p| input.port_name(p).as_deref() == Ok(want.as_str()))
            .ok_or_else(|| format!("port MIDI introuvable : {}", want))?,
        None => ports.first().ok_or("aucun port MIDI")?,
    };
    let label = input.port_name(chosen).unwrap_or_else(|_| "?".to_string());

    let app_cb = app.clone();
    let conn = input
        .connect(
            chosen,
            "lumidmx-listen",
            move |_ts, data: &[u8], _| {
                if data.len() >= 3 && (data[0] & 0xF0) == 0xB0 {
                    let msg = MidiCc {
                        channel: (data[0] & 0x0F) + 1,
                        cc: data[1],
                        value: data[2],
                    };
                    let _ = app_cb.emit("midi-cc", msg);
                }
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    *state.0.lock().map_err(|e| e.to_string())? = Some(conn);
    Ok(format!("ecoute MIDI : {}", label))
}

#[tauri::command]
fn stop_midi(state: State<MidiState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(SerialState(Mutex::new(None)))
        .manage(MidiState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            open_serial,
            close_serial,
            send_dmx,
            list_midi_ports,
            start_midi,
            stop_midi
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement du prototype Tauri");
}
