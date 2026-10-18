#pragma once
// Ojos, luces y sonidos del robi.ino del equipo.
#include "Config.h"
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#if USAR_SH1106
#include <Adafruit_SH110X.h>
using ControladorOLED = Adafruit_SH1106G;
#else
#include <Adafruit_SSD1306.h>
using ControladorOLED = Adafruit_SSD1306;
#endif
#include <FluxGarage_RoboEyes.h>

class VidaRobot {
 public:
  enum class Emocion : uint8_t { Neutral, Feliz, Triste, Enojado, Curioso, Dormido };
  bool iniciar() {
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, LOW);
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, BUZZER_ACTIVO_EN_ALTO ? LOW : HIGH);
    if (!ledcAttachChannel(PIN_LED, 5000, 8, CANAL_LED)) return false;
    ledcWrite(PIN_LED, 0);
    if (BUZZER_PASIVO) {
      if (!ledcAttachChannel(PIN_BUZZER, 2000, 10, CANAL_BUZZER)) return false;
      ledcOutputInvert(PIN_BUZZER, !BUZZER_ACTIVO_EN_ALTO);
    }
    buzzerConfigurado_ = true;
    silenciar();
    Wire.setPins(PIN_SDA, PIN_SCL);
    Wire.begin();
    Wire.setTimeOut(50);
    uint8_t direccion = 0;
    for (uint8_t candidata = 0x3C; candidata <= 0x3D; ++candidata) {
      Wire.beginTransmission(candidata);
      if (Wire.endTransmission() == 0) { direccion = candidata; break; }
    }
    if (!direccion) {
      Serial.println("No se encontro la OLED; prueba de motores disponible por Serial.");
      return false;
    }
#if USAR_SH1106
    const bool ok = pantalla_.begin(direccion, false);
#else
    const bool ok = pantalla_.begin(SSD1306_SWITCHCAPVCC, direccion, false, false);
#endif
    if (!ok) return false;
    ojos_.begin(128, 64, 30);
    lista_ = true;
    cambiarEmocion(Emocion::Neutral, false);
    return true;
  }

  // Gestos positivos para acompanhar los movimientos.
  void gestoAvance(bool alegre) {
    if (!lista_) return;
    cambiarEmocion(alegre ? Emocion::Feliz : Emocion::Curioso, false);
    ojos_.setIdleMode(OFF);
    ojos_.setPosition(alegre ? DEFAULT : N);
    if (alegre) sonidoFeliz(); else sonidoCurioso();
  }
  void gestoIzquierda() {
    if (!lista_) return;
    cambiarEmocion(Emocion::Curioso, false);
    ojos_.setIdleMode(OFF); ojos_.setPosition(W);
    sonidoCurioso();
  }
  void gestoDerecha() {
    if (!lista_) return;
    cambiarEmocion(Emocion::Curioso, false);
    ojos_.setIdleMode(OFF); ojos_.setPosition(E);
    sonidoCurioso();
  }

  void neutral() { cambiarEmocion(Emocion::Neutral); }
  void feliz() { cambiarEmocion(Emocion::Feliz); }
  void triste() { cambiarEmocion(Emocion::Triste); }
  void enojado() { cambiarEmocion(Emocion::Enojado); }
  void curioso() { cambiarEmocion(Emocion::Curioso); }
  void dormido() { cambiarEmocion(Emocion::Dormido); }

  void cambiarEmocion(Emocion nueva, bool conSonido = true) {
    if (!lista_ || static_cast<uint8_t>(nueva) > 5) return;
    if (hayEmocion_ && nueva == emocion_) return;
    hayEmocion_ = true;
    emocion_ = nueva;
    desdeEmocion_ = millis();
    silenciar();
    ojos_.setWidth(36, 36);
    ojos_.setHeight(36, 36);
    ojos_.setBorderradius(8, 8);
    ojos_.setSpacebetween(10);
    ojos_.setMood(DEFAULT);
    ojos_.setCuriosity(OFF);
    ojos_.setIdleMode(ON, 3, 2);
    ojos_.setAutoblinker(ON, 3, 2);
    ojos_.setPosition(DEFAULT);
    ojos_.open();
    switch (nueva) {
      case Emocion::Neutral: break;
      case Emocion::Feliz:
        ojos_.setMood(HAPPY);
        if (conSonido) sonidoFeliz();
        break;
      case Emocion::Triste:
        ojos_.setMood(TIRED); ojos_.setIdleMode(OFF);
        if (conSonido) sonidoTriste();
        break;
      case Emocion::Enojado:
        ojos_.setMood(ANGRY); ojos_.setIdleMode(OFF);
        if (conSonido) sonidoError();
        break;
      case Emocion::Curioso:
        ojos_.setCuriosity(ON); ojos_.setIdleMode(ON, 1, 2);
        if (conSonido) sonidoCurioso();
        break;
      case Emocion::Dormido:
        ojos_.setAutoblinker(OFF); ojos_.setIdleMode(OFF); ojos_.close();
        if (conSonido) sonidoDormir();
        break;
    }
  }
  void sonidoSaludo() {
    static const Nota notas[] = {{800,100},{0,70},{1200,120},{0,70},{1600,160}};
    reproducir(notas);
  }
  void sonidoFeliz() {
    static const Nota notas[] = {{1000,100},{0,70},{1500,100},{0,70},{2000,180}};
    reproducir(notas);
  }
  void sonidoTriste() {
    static const Nota notas[] = {{900,200},{0,100},{650,220},{0,100},{400,280}};
    reproducir(notas);
  }
  void sonidoError() {
    static const Nota notas[] = {{500,140},{0,100},{500,140},{0,100},{350,220}};
    reproducir(notas);
  }
  void sonidoCurioso() {
    static const Nota notas[] = {{900,100},{0,100},{1400,180}};
    reproducir(notas);
  }
  void sonidoDormir() {
    static const Nota notas[] = {{800,140},{0,100},{550,220}};
    reproducir(notas);
  }
  void silenciar() {
    notas_ = nullptr; cantidad_ = 0; indice_ = 0;
    escribirBuzzer(0);
  }
  void actualizar(bool dibujarOjos = true) {
    if (!lista_) return;
    const uint32_t ahora = millis();
    actualizarSonido(ahora);
    actualizarLed(ahora);
    if (dibujarOjos) ojos_.update();
  }

 private:
  struct Nota { uint16_t hz, ms; };
  ControladorOLED pantalla_{128,64,&Wire,-1};
  RoboEyes<ControladorOLED> ojos_{pantalla_};
  bool lista_ = false, buzzerConfigurado_ = false, hayEmocion_ = false;
  Emocion emocion_ = Emocion::Neutral;
  uint32_t desdeEmocion_ = 0, desdeNota_ = 0;
  const Nota* notas_ = nullptr;
  size_t cantidad_ = 0, indice_ = 0;

  void escribirBuzzer(uint16_t hz) {
    if (!buzzerConfigurado_) return;
    if (BUZZER_PASIVO) ledcWriteTone(PIN_BUZZER, hz);
    else {
      const bool nivel = hz ? BUZZER_ACTIVO_EN_ALTO : !BUZZER_ACTIVO_EN_ALTO;
      digitalWrite(PIN_BUZZER, nivel ? HIGH : LOW);
    }
  }
  template <size_t CANTIDAD>
  void reproducir(const Nota (&secuencia)[CANTIDAD]) {
    if (!lista_) return;
    silenciar(); notas_ = secuencia; cantidad_ = CANTIDAD;
    desdeNota_ = millis(); escribirBuzzer(notas_[0].hz);
  }
  void actualizarSonido(uint32_t ahora) {
    if (!notas_) return;
    const uint32_t transcurrido = ahora - desdeNota_;
    const uint32_t duracion = notas_[indice_].ms;
    if (transcurrido < duracion) return;
    if (transcurrido - duracion > 250) { silenciar(); return; }
    if (++indice_ >= cantidad_) { silenciar(); return; }
    desdeNota_ = ahora; escribirBuzzer(notas_[indice_].hz);
  }
  uint8_t respirar(uint32_t t, uint32_t periodo, uint8_t minimo, uint8_t maximo) {
    const uint32_t fase = t % periodo, mitad = periodo / 2;
    const uint32_t altura = fase <= mitad ? fase : periodo - fase;
    return minimo + (maximo - minimo) * altura / mitad;
  }
  void actualizarLed(uint32_t ahora) {
    const uint32_t t = ahora - desdeEmocion_;
    uint8_t brillo = 0;
    switch (emocion_) {
      case Emocion::Neutral: brillo = respirar(t,3000,15,100); break;
      case Emocion::Feliz: {
        const uint32_t fase = t % 1200;
        brillo = (fase < 100 || (fase >= 220 && fase < 320)) ? 255 : 15;
        break;
      }
      case Emocion::Triste: brillo = respirar(t,4000,0,45); break;
      case Emocion::Enojado: brillo = (t / 150) % 2 ? 0 : 255; break;
      case Emocion::Curioso: brillo = (t % 1500 < 350) ? 180 : 15; break;
      case Emocion::Dormido: brillo = respirar(t,5000,0,12); break;
    }
    ledcWrite(PIN_LED,brillo);
  }
};

