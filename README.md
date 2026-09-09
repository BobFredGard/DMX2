# LumiDMX

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
- Starville 4 Zones (14ch)
- Strobe (2ch)
- Lyre 8ch
- Lyre 12ch
- Wash 6ch
- Profils personnalisés (nombre de canaux libre)

## Fonctionnalités

- Ajout/suppression de fixtures à la volée
- Coloris picker par fixture (zones et single-color)
- Scènes avec transition (Ctrl+Click save, Click recall, Shift+Click delete)
- Playlist par chanson (sidebar)
- Animation vague avec vitesse variable et multiplicateur x2
- Étoiles (flash aléatoire)
- Spot linking (lier les couleurs entre spots)
- Zone linking (lier les zones entre elles)
- Contrôle MIDI
- Momentanés
- Import/Export JSON
- Auto-reconnection au dernier port série

### Flash musical

Système de flash rythmique par fixture, synchronisé au tempo :

- **Toggle par fixture** : checkbox "Flash" dans la card = ON/OFF
- **Tap Tempo** : bouton Tap calcule le BPM
- **Subdivisions musicales** : Ronde, Blanche, Noire, Croche, Double-croche, Triple-croche, Quadruple-croche
  - **Déclencher** : à quelle vitesse le flash se déclenche
  - **Durée** : combien de temps le flash reste actif
- **Couleur** : aléatoire ou choisie par fixture
- **MIDI CC 119** : déclenche un flash ponctuel
- **Commande série** : `FLASH` ou `FLASH #RRGGBB` depuis une app tierce
- **Scènes** : chaque scène enregistre l'état flash (fixtures actives, BPM, subdivisions, couleur)

## Performance DMX

- Baud rate : 921600 (250kbaud bus DMX, 921600 série USB)
- Paquets optimisés : envoi uniquement des canaux actifs (trim des zeros)
  - 36 canaux (2 Starvilles) → paquet de 41 octets → ~0.4ms de transmission
  - 14 canaux (1 Starville) → paquet de 19 octets → ~0.2ms
- Envoi à chaque frame (~60fps) sans frame skipping
- Throttle série : 2ms minimum entre envois
- DMX frame time : ~1.6ms pour 36 canaux (~22ms pour 512)
- Buffer ESP32 : 2048 octets

## Profils de fixtures

- Zones Starville inversées (Z1→offsets 9-11, Z4→offsets 0-2)
- Dimmer réglable dans les scènes (valeur sauvegardée, pas forcé à 255)
- Sliders synchronisés avec les coloris pickers
- Vague inversée par fixture (Starvilles)

## Protocole série

PC → ESP32:
- Paquet complet: `[0xFF][0x00][NB_H][NB_L][CH1..CHn][CHECKSUM]`
- Mise à jour simple: `[0xFE][CH_H][CH_L][VALUE][CHECKSUM]`

ESP32 → PC:
- `[0xFE][STATUS]` (0x00=OK, 0x01=ERROR, 0x02=CONNECTED)

Commandes reçues (depuis app tierce via WiFi/BT → ESP32 → série):
- `FLASH` → déclenche un flash sur fixtures actives
- `FLASH #RRGGBB` → flash avec couleur spécifique

## Remerciements

ESP_DMX
https://github.com/someweisguy/esp_dmx
