/**
 * ESP32 DMX512 Controller
 * 
 * Receives DMX data from PC via USB Serial (115200 baud)
 * and outputs DMX512 via MAX485 transceiver
 * 
 * Protocol PC -> ESP32:
 *   Full packet:   [0xFF][0x00][NB_H][NB_L][CH1..CHn][CHECKSUM]
 *   Single update: [0xFE][CH_H][CH_L][VALUE][CHECKSUM]
 * 
 * Protocol ESP32 -> PC:
 *   [0xFE][STATUS]  (STATUS: 0x00=OK, 0x01=ERROR, 0x02=CONNECTED)
 * 
 * Wiring:
 *   GPIO 16 -> MAX485 RO (Receiver Output)
 *   GPIO 17 -> MAX485 DI (Driver Input)
 *   GPIO 21 -> MAX485 DE/RE (Direction Enable)
 */

#include <Arduino.h>
#include "esp_dmx.h"

// ============================================
// CONFIGURATION
// ============================================

#define DMX_TX_PIN     17   // GPIO connected to MAX485 DI
#define DMX_RX_PIN     16   // GPIO connected to MAX485 RO
#define DMX_DIR_PIN    21   // GPIO connected to MAX485 DE/RE

#define DMX_MAX_CHANNELS 512
#define SERIAL_BAUD       921600

// ============================================
// GLOBAL STATE
// ============================================

dmx_port_t dmxPort = 1;
uint8_t dmxData[DMX_MAX_CHANNELS];
bool dmxConnected = false;
bool ledState = false;

// LED blink for connection status
#define LED_BUILTIN_PIN 2  // Onboard LED (most ESP32 boards)

// ============================================
// SERIAL PROTOCOL PARSING
// ============================================

// State machine for protocol parsing
enum ParseState {
    WAIT_HEADER,
    WAIT_SECOND_BYTE,
    WAIT_NB_H,
    WAIT_NB_L,
    WAIT_SINGLE_CH_H,
    WAIT_SINGLE_CH_L,
    WAIT_SINGLE_VALUE,
    READ_DATA,
    READ_CHECKSUM
};

ParseState parseState = WAIT_HEADER;
uint16_t packetNbChannels = 0;
uint8_t packetChecksum = 0;
uint16_t packetDataIndex = 0;
uint8_t packetData[DMX_MAX_CHANNELS];

void processFullPacket() {
    if (packetNbChannels > 0 && packetNbChannels <= DMX_MAX_CHANNELS) {
        for (uint16_t i = 0; i < packetNbChannels; i++) {
            dmxData[i] = packetData[i];
        }
        dmx_write(dmxPort, dmxData, packetNbChannels);
        dmx_send_num(dmxPort, packetNbChannels);
        
        Serial.write(0xFE);
        Serial.write(0x00);
    } else {
        Serial.write(0xFE);
        Serial.write(0x01);
    }
}

void processSingleUpdate(uint16_t channel, uint8_t value) {
    if (channel >= 1 && channel <= DMX_MAX_CHANNELS) {
        dmxData[channel - 1] = value;
        uint16_t nbChannels = channel;
        dmx_write(dmxPort, dmxData, nbChannels);
        dmx_send_num(dmxPort, nbChannels);
        
        Serial.write(0xFE);
        Serial.write(0x00);
    } else {
        Serial.write(0xFE);
        Serial.write(0x01);
    }
}

void processSerialData() {
    while (Serial.available()) {
        uint8_t byte = Serial.read();
        
        switch (parseState) {
            case WAIT_HEADER:
                if (byte == 0xFF) {
                    parseState = WAIT_SECOND_BYTE;
                    packetChecksum = 0;
                } else if (byte == 0xFE) {
                    parseState = WAIT_SINGLE_CH_H;
                }
                break;
                
            case WAIT_SECOND_BYTE:
                if (byte == 0x00) {
                    parseState = WAIT_NB_H;
                } else {
                    parseState = WAIT_HEADER;
                }
                break;
                
            case WAIT_NB_H:
                packetNbChannels = (uint16_t)byte << 8;
                packetChecksum ^= byte;
                parseState = WAIT_NB_L;
                break;
                
            case WAIT_NB_L:
                packetNbChannels |= byte;
                packetChecksum ^= byte;
                packetDataIndex = 0;
                if (packetNbChannels == 0 || packetNbChannels > DMX_MAX_CHANNELS) {
                    parseState = WAIT_HEADER;
                } else {
                    parseState = READ_DATA;
                }
                break;
                
            case WAIT_SINGLE_CH_H:
                packetNbChannels = (uint16_t)byte << 8;
                packetChecksum = byte;
                parseState = WAIT_SINGLE_CH_L;
                break;
                
            case WAIT_SINGLE_CH_L:
                packetNbChannels |= byte;
                packetChecksum ^= byte;
                parseState = WAIT_SINGLE_VALUE;
                break;
                
            case WAIT_SINGLE_VALUE:
                packetChecksum ^= byte;
                processSingleUpdate(packetNbChannels, byte);
                parseState = WAIT_HEADER;
                break;
                
            case READ_DATA:
                packetData[packetDataIndex++] = byte;
                packetChecksum ^= byte;
                if (packetDataIndex >= packetNbChannels) {
                    parseState = READ_CHECKSUM;
                }
                break;
                
            case READ_CHECKSUM:
                if (byte == packetChecksum) {
                    processFullPacket();
                } else {
                    Serial.write(0xFE);
                    Serial.write(0x01); // Checksum error
                }
                parseState = WAIT_HEADER;
                break;
        }
    }
}

// ============================================
// SETUP
// ============================================

void setup() {
    Serial.setRxBufferSize(2048);
    Serial.setTxBufferSize(2048);
    Serial.begin(SERIAL_BAUD);
    
    // Initialize LED
    pinMode(LED_BUILTIN_PIN, OUTPUT);
    digitalWrite(LED_BUILTIN_PIN, LOW);
    
    // Initialize DMX
    dmx_config_t config = DMX_CONFIG_DEFAULT;
    dmx_driver_install(dmxPort, &config, NULL, 0);
    dmx_set_pin(dmxPort, DMX_TX_PIN, DMX_RX_PIN, DMX_DIR_PIN);
    
    // Zero out DMX data
    memset(dmxData, 0, DMX_MAX_CHANNELS);
    dmx_write(dmxPort, dmxData, DMX_MAX_CHANNELS);
    dmx_send_num(dmxPort, DMX_MAX_CHANNELS);
    
    // Signal ready
    Serial.write(0xFE);
    Serial.write(0x02); // CONNECTED
    
    // Blink LED to indicate ready
    for (int i = 0; i < 3; i++) {
        digitalWrite(LED_BUILTIN_PIN, HIGH);
        delay(100);
        digitalWrite(LED_BUILTIN_PIN, LOW);
        delay(100);
    }
}

// ============================================
// LOOP
// ============================================

void loop() {
    // Process incoming serial data
    processSerialData();
    
    // Blink LED every 500ms to show alive
    static unsigned long lastBlink = 0;
    if (millis() - lastBlink > 500) {
        lastBlink = millis();
        ledState = !ledState;
        digitalWrite(LED_BUILTIN_PIN, ledState ? HIGH : LOW);
    }
    
    // Small delay to prevent watchdog issues
    yield();
}
