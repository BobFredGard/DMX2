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

## Profils de fixtures intégrés

- Dimmer (1ch)
- Spot RGBW (8ch) — Rouge, Vert, Bleu, Blanc, Dimmer, Flash
- Starville 4 Zones (14ch) — 4 zones RGB + Flash + Dimmer
- Lyre 8ch / 12ch — Pan, Tilt, RGB
- Wash 6ch — Dimmer, RGB, Vitesse, Mode
- Profils personnalisés (nombre de canaux libre)

## Fonctionnalités principales

- **Fixtures dynamiques** : ajout/suppression à la volée, profils personnalisés
- **Color picker** par fixture (zones Starville et single-color pour Spots)
- **Scènes** (32 régulières + 4 momentanées) : Ctrl+Click save sans vague/flash, Ctrl+Shift+Click save avec, Click recall, Shift+Click delete
- **Transition** : temps de fondu réglable par scène (0-30s)
- **Playlist** par chanson (sidebar, 128 songs)
- **Animation vague** (voir détails ci-dessous)
- **Flash musical** (voir détails ci-dessous)
- **Spot linking** : lier les couleurs entre spots
- **Zone linking** : lier les zones Starville (L12, L34, LAll)
- **Contrôle MIDI** complet (voir mapping ci-dessous)
- **Momentanées** : 4 boutons press/relâche
- **Import/Export** JSON (fixtures, scènes, chansons, MIDI)
- **Auto-reconnexion** au dernier port série
- **Sauvegarde auto** de la config toutes les 2s

---

## Animation Vague (Wave)

La vague fait tourner une couleur sinusoïdale sur les fixtures sélectionnées.

### Activation
- Checkbox **"Vague"** dans la card de chaque fixture → active/désactive
- Bouton **"Vague"** dans la toolbar → démarre/arrête la vague globale
- Raccourci clavier : `W` (toggle)

### Paramètres (toolbar vague)
- **Vitesse** (slider) : vitesse de rotation de la vague
- **x2** : doubler la vitesse
- **Couleurs perso** : activer pour choisir couleur début/fin (sinon arc-en-ciel HSV)
- **Étoiles** : flashs blancs aléatoires ponctuels sur les zones
- **Fréquence étoiles** : slider pour densité des étoiles

### Comportement
- **Starville (zone pickers)** : chaque zone = 1 étape de vague (couleur décalée)
- **Spot RGBW / autres** : fixture entière = 1 étape
- **Inversion vague** : checkbox "Inversion" dans card Starville → sens inverse
- **Total zones** : toutes les zones des fixtures `waveEnabled` forment un cycle continu
- **Performance** : 60fps, throttle DMX 2ms, trim trailing zeros

### Raccourcis vague
| Touche | Action |
|--------|--------|
| `W` | Toggle vague |
| `E` | Toggle étoiles |
| `C` | Toggle couleurs perso |

---

## Flash musical

Système de flash rythmique par fixture, synchronisé au tempo (BPM).

### Activation
- Checkbox **"Flash"** dans la card de chaque fixture → active/désactive
- Bouton **"Flash"** dans la toolbar → démarre/arrête le moteur flash
- Raccourci : `F` (toggle)

### Paramètres (toolbar flash)
- **BPM / Tap Tempo** : cliquer sur "Tap" au rythme pour calculer le BPM
- **Subdivision déclencheur** : Ronde, Blanche, Noire, Croche, Double-croche, Triple-croche, Quadruple-croche
- **Subdivision durée** : même liste — combien de temps le flash reste allumé
- **Mode** :
  - `random` : 1-2 unités flashent aléatoirement à chaque déclencheur
  - `sequential` : unités flashent une par une dans l'ordre
  - `group4` : flash par groupes de 4 (Starville zones)
- **Reverse** : inverser l'ordre (sequential/group4)
- **Couleur** : `random` ou `specific` (color picker par fixture)

### Cycle flash (par unité)
1. **Noir** (pré-flash)
2. **Couleur flash** (durée = subdivision durée)
3. **Fade vers noir** (durée = subdivision durée)

### MIDI & Série
- **CC 119** : déclenche un flash ponctuel (oneshot) sur fixtures actives
- **Commande série** : `FLASH` ou `FLASH #RRGGBB` depuis app tierce (WiFi/BT → ESP32)

### Sauvegarde dans les scènes
Chaque scène enregistre : fixtures flashEnabled, BPM, subdivisions déclencheur/durée, mode, reverse, couleur.

---

## Contrôle MIDI

| Message MIDI | Action |
|--------------|--------|
| CC 1-32 | Activer scène 1 à 32 |
| CC 119 | Déclencher flash (oneshot) |
| CC 124-127 | Activer momentanés M1 à M4 |
| Note C1 (24) | Momentané M1 (ON/OFF) |
| Note D1 (26) | Momentané M2 (ON/OFF) |
| Note E1 (28) | Momentané M3 (ON/OFF) |
| Note F1 (30) | Momentané M4 (ON/OFF) |
| Program Change | Charger chanson 0-127 |

---

## Raccourcis clavier (globaux)

| Touche | Action |
|--------|--------|
| `W` | Toggle vague |
| `E` | Toggle étoiles (vague) |
| `C` | Toggle couleurs perso (vague) |
| `F` | Toggle flash |
| `T` | Tap tempo (flash) |
| `H` | Aide (modal) |
| `Espace` | Blackout global |

---

## Scènes

- **32 scènes régulières** : 2 rangées de 16 (1-14 grosses, 15-18 petites style momentané | 19-32 grosses)
- **4 momentanées** : M1-M4 (press = ON, relâche = OFF + retour)
- **Sauvegarde** :
  - `Ctrl+Click` (ou `Cmd+Click` macOS) : save SANS vague/flash
  - `Ctrl+Shift+Click` : save AVEC vague/flash
- **Rappel** : Click simple → fade avec transition, restaure vague/flash si sauvegardés
- **Transition** : 0-30s par scène (input à droite du numéro)

---

## Performance DMX

- Baud rate : 921600 (250kbaud bus DMX, 921600 série USB)
- Paquets optimisés : envoi uniquement des canaux actifs (trim trailing zeros)
  - 36 canaux (2 Starvilles) → paquet de 41 octets → ~0.4ms
  - 14 canaux (1 Starville) → paquet de 19 octets → ~0.2ms
- Envoi à chaque frame (~60fps) sans frame skipping
- Throttle série : 2ms minimum entre envois
- DMX frame time : ~1.6ms pour 36 canaux (~22ms pour 512)
- Buffer ESP32 : 2048 octets

---

## Profils de fixtures (détails)

- **Starville 4 Zones** : zones inversées (Z1 UI = offsets 9-11, Z4 = offsets 0-2). Flash=offset 12, Dimmer=offset 13.
- **Spot RGBW 8ch** : Rouge(0), Vert(1), Bleu(2), Blanc(3 slider), Dimmer(4 slider), Flash(5 slider). Pas d'automatiques.
- **Dimmer** : 1ch, auto-dim forcé à 255 si à 0 lors set color
- **Vague inversée** : par fixture Starville (checkbox "Inversion")
- **Dimmer scènes** : valeur sauvegardée, pas forcé à 255

---

## Protocole série

**PC → ESP32**
- Paquet complet: `[0xFF][0x00][NB_H][NB_L][CH1..CHn][CHECKSUM]`
- Mise à jour simple: `[0xFE][CH_H][CH_L][VALUE][CHECKSUM]`

**ESP32 → PC**
- `[0xFE][STATUS]` (0x00=OK, 0x01=ERROR, 0x02=CONNECTED)

**Commandes reçues** (depuis app tierce via WiFi/BT → ESP32 → série)
- `FLASH` → déclenche un flash sur fixtures actives
- `FLASH #RRGGBB` → flash avec couleur spécifique

---

## macOS : App non signée

L'app n'est pas signée (pas de certificat Developer ID). Après installation :
```bash
xattr -cr /Applications/LumiDMX.app
```

---

## Remerciements

**ESP_DMX**
- https://github.com/someweisguy/esp_dmx