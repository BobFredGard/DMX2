# DMX Control

Application de pilotage DMX avec ESP32, interface graphique Electron et fixtures dynamiques.

## Architecture

```
DMX2/
├── electron/          # App Electron (desktop)
│   ├── main.js        # Processus principal (sérial, IPC)
│   ├── preload.js     # Pont entre main et renderer
│   ├── renderer/
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js
│   │   ├── fixtures.js
│   │   ├── coloris.js/css
│   │   └── data/profiles.json
│   └── package.json
│
├── esp32_firmware/     # Firmware ESP32 (PlatformIO)
│   ├── platformio.ini
│   └── src/main.cpp
│
└── README.md
```

## Installation

### App Electron

```bash
cd electron
npm install
npm start
```

### Firmware ESP32

```bash
cd esp32_firmware
# Installer PlatformIO CLI ou utiliser l'extension VS Code
pio run --target upload
```

## Brochage ESP32 → MAX485

| ESP32    | MAX485 |
|----------|--------|
| GPIO 16  | RO     |
| GPIO 17  | DI     |
| GPIO 21  | DE/RE  |
| GND      | GND    |
| 5V/3.3V  | VCC    |

## Profils de fixtures

- Dimmer (1ch)
- Spot RGB (3ch)
- Spot RGBW (4ch)
- Strobe (2ch)
- Lyre 8ch
- Lyre 12ch
- Wash 6ch

Possibilité d'ajouter des fixtures personnalisées avec un nombre de canaux libre.

## Fonctionnalités

- Ajout/suppression de fixtures à la volée
- Coloris picker par fixture
- Contrôle groupe (couleur, intensité, flash)
- Scènes (Ctrl+Click save, Click recall, Shift+Click delete)
- Playlist par chanson
- Animation vague
- Momentanés
- Import/Export JSON
- Communication série USB directe (115200 baud)

## Protocole série

PC → ESP32:
- Paquet complet: `[0xFF][0x00][NB_H][NB_L][CH1..CHn][CHECKSUM]`
- Mise à jour simple: `[0xFE][CH_H][CH_L][VALUE][CHECKSUM]`

ESP32 → PC:
- `[0xFE][STATUS]` (0x00=OK, 0x01=ERROR, 0x02=CONNECTED)
