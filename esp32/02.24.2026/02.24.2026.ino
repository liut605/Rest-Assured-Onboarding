#include <Adafruit_NeoPixel.h>

#define PIN 32 //LED
#define NUMPIXELS 16
#define PRESSURE_PIN 33
#define BUTTON_PIN 14

bool capWasActive = false;
bool btnWasHigh = false;
unsigned long lastCapMs = 0;
unsigned long lastBtnMs = 0;

uint8_t currentPixel = 0;
int lastButtonState = HIGH;
bool speakerActive = false;
uint8_t currentR = 150;
uint8_t currentG = 150;
uint8_t currentB = 200;
uint8_t currentBrightness = 0;

Adafruit_NeoPixel pixels(NUMPIXELS, PIN, NEO_GRB + NEO_KHZ800);

void fadeIn(int delayTime = 5) {
  for (int i = currentBrightness; i <= 255; i++) {
    pixels.setBrightness(i);
    pixels.fill(pixels.Color(150, 150, 200));
    pixels.show();
    delay(delayTime);
  }
  currentBrightness = 255;
  currentR = 150;
  currentG = 150;
  currentB = 200;
}

void fadeOut(int delayTime = 5) {
  for (int i = currentBrightness; i >= 0; i--) {
    pixels.setBrightness(i);
    pixels.fill(pixels.Color(currentR, currentG, currentB));
    pixels.show();
    delay(delayTime);
  }
  currentBrightness = 0;
}

void transitionToColor(uint8_t endR, uint8_t endG, uint8_t endB, int steps = 150, int delayTime = 5) {
  uint8_t startR = currentR;
  uint8_t startG = currentG;
  uint8_t startB = currentB;

  for (int i = 0; i <= steps; i++) {
    float t = (float)i / steps;

    uint8_t r = startR + (endR - startR) * t;
    uint8_t g = startG + (endG - startG) * t;
    uint8_t b = startB + (endB - startB) * t;

    pixels.setBrightness(255);
    pixels.fill(pixels.Color(r, g, b));
    pixels.show();
    delay(delayTime);
  }

  currentR = endR;
  currentG = endG;
  currentB = endB;
  currentBrightness = 255;
}

void awating (int delayTime = 5){
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pixels.begin();
  pixels.clear();
}

void loop() {
  int pressureVal = touchRead(PRESSURE_PIN);
  int buttonState = digitalRead(BUTTON_PIN);
  //Serial.println(pressureVal);
  unsigned long now = millis();
  // ---------- Sensor -> Web events (no direct color change here) ----------
  bool capActive = pressureVal < 1500;
  if (capActive && !capWasActive && (now - lastCapMs >= 200)) {
    Serial.println("CAP_TOUCH");
    lastCapMs = now;
  }
  capWasActive = capActive;
  bool btnHigh = (buttonState == HIGH);
  if (btnHigh && !btnWasHigh && (now - lastBtnMs >= 200)) {
    Serial.println("BUTTON");
    lastBtnMs = now;
  }
  btnWasHigh = btnHigh;


if (Serial.available() > 0) {
  String incoming = Serial.readStringUntil('\n');
  incoming.trim();

  Serial.println("serial available");

  if (incoming == "off") {
    fadeOut();
  } else if (incoming == "on") {
    fadeIn();
  } else if (incoming == "speaker_on") {
    transitionToColor(180, 60, 0, 120, 10);
  } else if (incoming == "diffuser_on") {
    transitionToColor(255, 0, 255, 120, 10);
  }
}
}