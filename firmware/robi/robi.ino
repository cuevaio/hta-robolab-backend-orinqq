// RoboLab completo en un archivo: motores, ojos, luces, sonidos y USB Serial (BLE opcional).
// Se puede copiar como robi/robi.ino. No necesita cabeceras locales.
// Exportado con npm run firmware:bundle desde firmware/robolab_bluetooth.

// RoboLab: USB Serial (UART 115200) por defecto, Arduino-ESP32 3.3.11.
// Para experimentar con BLE UART, compilar con ROBOLAB_USAR_BLE=1.
#ifndef ROBOLAB_USAR_BLE
#define ROBOLAB_USAR_BLE 0
#endif
#include <Arduino.h>
#include <atomic>
// ---- Config.h integrado ----

#include <Arduino.h>
constexpr char ROBOT_NOMBRE[] = "RoboLab";
constexpr uint8_t MOTOR_IZQUIERDO = 22;
constexpr uint8_t MOTOR_DERECHO = 23;
int velocidadAvance = 75;
int velocidadGiro = 110;
constexpr uint32_t FRECUENCIA_PWM = 500;
constexpr uint8_t BITS_PWM = 8;
constexpr uint8_t CANAL_MOTOR_IZQUIERDO = 0;
constexpr uint8_t CANAL_MOTOR_DERECHO = 2;
constexpr bool ACEPTAR_GIROS_EN_ARCO = true;
constexpr uint32_t MS_CASILLA = 1000;
constexpr uint32_t MS_GIRO_IZQUIERDA = 1000;
constexpr uint32_t MS_GIRO_DERECHA = 1000;
constexpr uint32_t MS_PAUSA = 100;
constexpr uint32_t MAX_EJECUCION_MS = 100000;
#define USAR_SH1106 1
constexpr uint8_t PIN_SDA = 21;
constexpr uint8_t PIN_SCL = 19;
constexpr uint8_t PIN_LED = 27;
constexpr uint8_t PIN_BUZZER = 16;
constexpr bool BUZZER_PASIVO = true;
constexpr bool BUZZER_ACTIVO_EN_ALTO = true;
constexpr uint8_t CANAL_LED = 4;
constexpr uint8_t CANAL_BUZZER = 6;


// ---- Protocol.h integrado ----

#include <cstdio>
#include <cstring>
// ---- Motion.h integrado ----

// Ejecutor del robi.ino del equipo, independiente del transporte.
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace robolab {
enum class Check { Ok, BadChar, TooLong, ReverseUnsupported, TurnUnsupported, TimingInvalid, DurationLimit, Busy };
enum class Failure { None, LinkLost, Timeout, Network, Stopped };
constexpr uint32_t gestureMs = 250;
struct Output { bool left; bool right; };
struct Config {
  uint32_t forwardMs, leftMs, rightMs, pauseMs, maxRunMs;
  bool allowArcTurns;
};

inline bool validTiming(const Config& config) {
  return config.forwardMs > 0 && config.forwardMs <= 10000 &&
    config.leftMs > 0 && config.leftMs <= 10000 &&
    config.rightMs > 0 && config.rightMs <= 10000 && config.pauseMs <= 10000 &&
    config.maxRunMs > 0 && config.maxRunMs <= 100000;
}

inline Check validateProgram(const char* text, size_t size, const Config& config) {
  if (!validTiming(config)) return Check::TimingInvalid;
  if (!text || size == 0) return Check::BadChar;
  if (size > 128) return Check::TooLong;
  bool reverse = false, turns = false;
  uint64_t duration = 0;
  for (size_t i = 0; i < size; ++i) {
    switch (text[i]) {
      case 'A': duration += config.forwardMs; break;
      case 'R': reverse = true; break;
      case 'D': turns = true; duration += config.leftMs; break;
      case 'Z': turns = true; duration += config.rightMs; break;
      default: return Check::BadChar;
    }
    duration += config.pauseMs + gestureMs;
  }
  if (reverse) return Check::ReverseUnsupported;
  if (turns && !config.allowArcTurns) return Check::TurnUnsupported;
  if (duration >= config.maxRunMs) return Check::DurationLimit;
  return Check::Ok;
}

inline const char* checkReply(Check check) {
  switch (check) {
    case Check::Ok: return "OK";
    case Check::BadChar: return "ERR:BAD_CHAR";
    case Check::TooLong: return "ERR:TOO_LONG";
    case Check::ReverseUnsupported: return "ERR:REVERSE_UNSUPPORTED";
    case Check::TurnUnsupported: return "ERR:TURN_UNSUPPORTED";
    case Check::TimingInvalid: return "ERR:TIMING_INVALID";
    case Check::DurationLimit: return "ERR:DURATION_LIMIT";
    case Check::Busy: return "ERR:BUSY";
  }
  return "ERR:MOTOR";
}

class Motion {
 public:
  explicit Motion(Config config) : config_(config) {}
  Check start(const char* text, size_t size, uint32_t now) {
    if (active()) return Check::Busy;
    reset();
    const Check check = validateProgram(text, size, config_);
    if (check != Check::Ok) return check;
    std::memcpy(program_, text, size);
    program_[size] = '\0';
    length_ = size;
    started_ = now;
    activate(now);
    return Check::Ok;
  }

  void tick(uint32_t now, bool linkConnected) {
    if (!active()) return;
    if (!linkConnected) { abort(Failure::LinkLost); return; }
    if (now - started_ >= config_.maxRunMs) { abort(Failure::Timeout); return; }
    if (phase_ == Phase::Preparing && now - phaseStarted_ >= gestureMs) {
      const char command = program_[index_];
      output_ = {command != 'D', command != 'Z'};
      phase_ = Phase::Moving;
      phaseStarted_ = now;
    } else if (phase_ == Phase::Moving && now - phaseStarted_ >= stepDuration()) {
      output_ = {false, false};
      phase_ = Phase::Pause;
      phaseStarted_ = now;
    } else if (phase_ == Phase::Pause && now - phaseStarted_ >= config_.pauseMs) {
      ++index_;
      if (index_ == length_) phase_ = Phase::Done;
      else activate(now);
    }
  }

  void abort(Failure failure) {
    output_ = {false, false};
    stepPending_ = false;
    failure_ = failure;
    phase_ = Phase::Failed;
  }
  void reset() {
    output_ = {false, false};
    stepPending_ = false;
    phase_ = Phase::Idle;
    failure_ = Failure::None;
    index_ = 0;
    length_ = 0;
  }
  Output output() const { return output_; }
  bool active() const { return phase_ == Phase::Preparing || phase_ == Phase::Moving || phase_ == Phase::Pause; }
  bool moving() const { return phase_ == Phase::Moving; }
  bool pausing() const { return phase_ == Phase::Pause; }
  char command() const { return index_ < length_ ? program_[index_] : '\0'; }
  size_t step() const { return index_ + 1; }
  bool takeStep() { const bool value = stepPending_; stepPending_ = false; return value; }
  bool done() const { return phase_ == Phase::Done; }
  bool failed() const { return phase_ == Phase::Failed; }
  Failure failure() const { return failure_; }

 private:
  enum class Phase { Idle, Preparing, Moving, Pause, Done, Failed };
  uint32_t stepDuration() const {
    if (program_[index_] == 'D') return config_.leftMs;
    if (program_[index_] == 'Z') return config_.rightMs;
    return config_.forwardMs;
  }
  void activate(uint32_t now) {
    output_ = {false, false};
    phaseStarted_ = now;
    phase_ = Phase::Preparing;
    stepPending_ = true;
  }
  Config config_;
  char program_[129] = {};
  size_t length_ = 0, index_ = 0;
  uint32_t started_ = 0, phaseStarted_ = 0;
  Output output_ = {false, false};
  Phase phase_ = Phase::Idle;
  Failure failure_ = Failure::None;
  bool stepPending_ = false;
};
}



namespace robolab {
// Sin Arduino ni red: el mismo parser y ejecutor se prueban en la computadora.
class RobotSession {
 public:
  using Emit = void (*)(void*, const char*, const char*);
  RobotSession(Config config, Emit emit, void* context)
      : motion_(config), emit_(emit), context_(context), arc_(config.allowArcTurns) {}
  Motion& motion() { return motion_; }

  void reset() {
    motion_.reset();
    length_ = 0; overflow_ = false; welcomed_ = false; used_ = 0;
    activeId_[0] = '\0';
  }

  void feed(char c, uint32_t now) {
    if (c != '\n') {
      if (length_ < 200 && c != '\0') line_[length_++] = c;
      else overflow_ = true;
      return;
    }
    if (overflow_) emit_(context_, "", "ERR:FRAME");
    else {
      if (length_ && line_[length_-1] == '\r') --length_;
      line_[length_] = '\0';
      process(now);
    }
    length_ = 0; overflow_ = false;
  }

  void tick(uint32_t now, bool connected) {
    if (!connected) welcomed_ = false;
    if (!motion_.active()) return;
    if (!connected) { stop("ERR:DISCONNECTED"); return; }
    if (now - lastPing_ >= 3500) { welcomed_ = false; stop("ERR:HEARTBEAT"); return; }
    motion_.tick(now, true);
    if (motion_.done()) finish("DONE");
    else if (motion_.failed()) finish("ERR:TIMEOUT");
  }

  void stop(const char* reason = "ERR:STOPPED") {
    if (!motion_.active()) return;
    motion_.abort(Failure::Stopped);
    finish(reason);
  }

 private:
  struct Remembered { char id[37]; char status[40]; };
  Motion motion_;
  Emit emit_;
  void* context_;
  bool arc_, welcomed_ = false, overflow_ = false;
  char line_[201] = {}, activeId_[37] = {};
  size_t length_ = 0, used_ = 0;
  uint32_t lastPing_ = 0;
  Remembered history_[64] = {};

  static bool validId(const char* id) {
    const size_t size = std::strlen(id);
    if (!size || size > 36) return false;
    for (size_t i = 0; i < size; ++i) {
      const char c = id[i];
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-')) return false;
    }
    return true;
  }
  void rememberStatus(const char* id, const char* status) {
    for (size_t i = 0; i < used_; ++i) if (std::strcmp(id, history_[i].id) == 0) {
      std::snprintf(history_[i].status, sizeof(history_[i].status), "%s", status);
      break;
    }
    emit_(context_, id, status);
  }
  void finish(const char* status) {
    motion_.reset(); // Las salidas quedan apagadas antes de notificar.
    rememberStatus(activeId_, status);
    activeId_[0] = '\0';
  }
  void process(uint32_t now) {
    if (std::strcmp(line_, "HELLO") == 0) {
      welcomed_ = true; lastPing_ = now;
      emit_(context_, "", arc_ ? "ROBO/1 ADZ ARC" : "ROBO/1 A PIVOT");
    } else if (std::strcmp(line_, "PING") == 0 && welcomed_) {
      lastPing_ = now;
      emit_(context_, "", "PONG");
    } else if (std::strcmp(line_, "STOP") == 0) {
      if (motion_.active()) stop();
      else emit_(context_, "", "STOPPED");
    } else if (std::strncmp(line_, "RUN ", 4) == 0 && welcomed_) {
      char* id = line_ + 4;
      char* separator = std::strchr(id, ' ');
      if (!separator) { emit_(context_, "", "ERR:FRAME"); return; }
      *separator = '\0';
      if (!validId(id)) { emit_(context_, "", "ERR:FRAME"); return; }
      const char* sequence = separator + 1;
      for (size_t i = 0; i < used_; ++i) if (std::strcmp(id, history_[i].id) == 0) {
        emit_(context_, id, history_[i].status); return;
      }
      if (used_ == 64) { emit_(context_, id, "ERR:RECONNECT"); return; }
      std::snprintf(history_[used_++].id, sizeof(history_[0].id), "%s", id);
      if (motion_.active()) { rememberStatus(id, "ERR:BUSY"); return; }
      const Check check = motion_.start(sequence, std::strlen(sequence), now);
      if (check != Check::Ok) { rememberStatus(id, checkReply(check)); return; }
      std::snprintf(activeId_, sizeof(activeId_), "%s", id);
      rememberStatus(id, "OK");
      rememberStatus(id, "RUN");
    } else emit_(context_, "", "ERR:FRAME");
  }
};
}

// ---- VidaRobot.h integrado ----

// Ojos, luces y sonidos del robi.ino del equipo.
// ---- Config.h integrado ----

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


// ---- UsbTransport.h integrado ----

#include <cstddef>
#include <cstdint>
#include <cstring>
// ---- Protocol.h integrado ----


namespace robolab {
// UART no expone el cierre del USB a través de un puente CH340. Cada HELLO
// completo inicia sesión; el cliente escribe \x00\nSTOP\nHELLO\n al abrir el puerto.
class UsbTransport {
 public:
  using Reset = void (*)(void*);
  explicit UsbTransport(RobotSession& session, Reset reset = nullptr, void* context = nullptr)
      : session_(session), reset_(reset), context_(context) {}

  void feed(char byte, uint32_t now) {
    if (byte != '\n') {
      // NUL se conserva: invalida cualquier RUN parcial antes de resincro.
      // Conservar 201 bytes basta para que RobotSession rechace una línea >200.
      if (length_ < sizeof(line_)) line_[length_++] = byte;
      return;
    }
    const bool hello = (length_ == 5 && std::memcmp(line_, "HELLO", 5) == 0) ||
        (length_ == 6 && std::memcmp(line_, "HELLO\r", 6) == 0);
    if (hello) {
      session_.reset(); // Apaga salidas, olvida ids y vacía el parser anterior.
      if (reset_) reset_(context_); // Aplicar motores apagados antes de emitir identidad.
    }
    for (size_t i = 0; i < length_; ++i) session_.feed(line_[i], now);
    session_.feed('\n', now);
    clear();
  }
  void clear() { length_ = 0; }

 private:
  RobotSession& session_;
  Reset reset_;
  void* context_;
  char line_[201] = {};
  size_t length_ = 0;
};
}

// ---- BleTransport.h integrado ----

#include <cstddef>
#include <cstdint>

namespace robolab {
// Estado puro del transporte. El adaptador Arduino protege cada operación con
// su portMUX: callbacks encolan bytes; solo loop() toca RobotSession.
class BleTransport {
 public:
  static constexpr size_t RX_CAPACITY = 512;
  struct State { uint32_t epoch; uint16_t client; bool connected, failed; };

  void connect(uint16_t client) {
    ++state_.epoch;
    state_.client = client;
    state_.connected = true;
    state_.failed = false;
    clear();
  }
  void disconnect(uint16_t client) {
    if (!state_.connected || client != state_.client) return;
    ++state_.epoch;
    state_.connected = false;
    state_.failed = false;
    clear();
  }
  State snapshot() const { return state_; }
  bool current(uint32_t epoch) const {
    return state_.epoch == epoch && state_.connected && !state_.failed;
  }
  void fail(uint32_t epoch) {
    if (current(epoch)) { state_.failed = true; clear(); }
  }
  bool receive(uint16_t client, const char* bytes, size_t length) {
    if (!current(state_.epoch) || client != state_.client) return false;
    if (length > RX_CAPACITY - size_) { fail(state_.epoch); return false; }
    for (size_t i = 0; i < length; ++i) {
      bytes_[(head_ + size_) % RX_CAPACITY] = bytes[i];
      ++size_;
    }
    return true;
  }
  // La biblioteca ya confirmó el valor antes de llamar onWrite; en un
  // EXEC_WRITE no existe write.value/write.len en el parámetro del evento.
  template <class Characteristic>
  bool receiveCharacteristic(uint16_t client, Characteristic& characteristic) {
    return receive(client, reinterpret_cast<const char*>(characteristic.getData()), characteristic.getLength());
  }
  bool pop(uint32_t epoch, char& byte) {
    if (!current(epoch) || !size_) return false;
    byte = bytes_[head_];
    head_ = (head_ + 1) % RX_CAPACITY;
    --size_;
    return true;
  }

 private:
  State state_{0, 0, false, false};
  char bytes_[RX_CAPACITY] = {};
  size_t head_ = 0, size_ = 0;
  void clear() { head_ = 0; size_ = 0; }
};
}

#if ROBOLAB_USAR_BLE
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <freertos/semphr.h>
#if !defined(CONFIG_BLUEDROID_ENABLED)
#error "La variante BLE necesita Bluedroid de Arduino-ESP32."
#endif
#endif

VidaRobot vida;
struct Packet { uint32_t epoch; char text[100]; };
QueueHandle_t outgoing = nullptr;
bool ready = false, pwmReady = false, happyForward = true;
#if ROBOLAB_USAR_BLE
constexpr char SERVICE_UUID[] = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char RX_UUID[] = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char TX_UUID[] = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
BLEServer* bluetooth = nullptr;
BLECharacteristic* tx = nullptr;
BLE2902* subscription = nullptr;
SemaphoreHandle_t notificationGate = nullptr;
portMUX_TYPE radioMux = portMUX_INITIALIZER_UNLOCKED;
robolab::BleTransport radio;
uint32_t loopEpoch = 0;
bool advertisePending = false;

robolab::BleTransport::State radioState() {
  portENTER_CRITICAL(&radioMux);
  const auto state = radio.snapshot();
  portEXIT_CRITICAL(&radioMux);
  return state;
}

void failConnection(uint32_t epoch) {
  portENTER_CRITICAL(&radioMux);
  radio.fail(epoch);
  portEXIT_CRITICAL(&radioMux);
}

#else
std::atomic<uint32_t> usbEpoch{0};
std::atomic<bool> writeFailed{false};
void failConnection(uint32_t epoch) {
  if (epoch == usbEpoch.load()) writeFailed.store(true);
}
#endif

uint32_t replyEpoch() {
#if ROBOLAB_USAR_BLE
  return loopEpoch;
#else
  return usbEpoch.load();
#endif
}

// La tarea de motores nunca espera notificaciones. Cola fija, envío sin espera.
void enqueueReply(void*, const char* id, const char* value) {
  Packet packet{};
  packet.epoch = replyEpoch();
  if (*id) snprintf(packet.text, sizeof(packet.text), "STATUS %s %s\n", id, value);
  else snprintf(packet.text, sizeof(packet.text), "%s\n", value);
  if (!outgoing || xQueueSend(outgoing, &packet, 0) != pdTRUE) failConnection(packet.epoch);
}

const robolab::Config movementConfig = {
  MS_CASILLA, MS_GIRO_IZQUIERDA, MS_GIRO_DERECHA,
  MS_PAUSA, MAX_EJECUCION_MS, ACEPTAR_GIROS_EN_ARCO
};
robolab::RobotSession session(movementConfig, enqueueReply, nullptr);

#if ROBOLAB_USAR_BLE
class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*, esp_ble_gatts_cb_param_t* event) override {
    subscription->setNotifications(false);
    portENTER_CRITICAL(&radioMux);
    radio.connect(event->connect.conn_id);
    advertisePending = false;
    portEXIT_CRITICAL(&radioMux);
  }
  void onDisconnect(BLEServer*, esp_ble_gatts_cb_param_t* event) override {
    portENTER_CRITICAL(&radioMux);
    radio.disconnect(event->disconnect.conn_id);
    advertisePending = !radio.snapshot().connected;
    portEXIT_CRITICAL(&radioMux);
    // loop() vuelve a anunciar cuando termina cualquier notificación vieja.
  }
};

class ReceiveCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic, esp_ble_gatts_cb_param_t* event) override {
    portENTER_CRITICAL(&radioMux);
    // conn_id es el prefijo común de write/exec_write; su payload no lo es.
    radio.receiveCharacteristic(event->write.conn_id, *characteristic);
    portEXIT_CRITICAL(&radioMux);
    // Nunca ejecutar RUN, tocar RobotSession ni motores desde el callback BLE.
  }
};
ConnectionCallbacks connectionCallbacks;
ReceiveCallbacks receiveCallbacks;

class NotifyCallbacks : public BLECharacteristicCallbacks {
 public:
  // Arduino-ESP32 3.3.11 llama onStatus de forma síncrona desde notify().
  bool succeeded = false;
  void onStatus(BLECharacteristic*, Status status, uint32_t) override {
    succeeded = status == Status::SUCCESS_NOTIFY;
  }
};
NotifyCallbacks notifyCallbacks;

void sendReplies(void*) {
  Packet packet{};
  for (;;) {
    if (xQueueReceive(outgoing, &packet, portMAX_DELAY) != pdTRUE) continue;
    const size_t size = strlen(packet.text);
    for (size_t offset = 0; offset < size; offset += 20) {
      xSemaphoreTake(notificationGate, portMAX_DELAY);
      const auto state = radioState();
      if (!state.connected || state.failed || state.epoch != packet.epoch) {
        xSemaphoreGive(notificationGate);
        break;
      }
      const size_t length = size - offset < 20 ? size - offset : 20;
      tx->setValue(reinterpret_cast<const uint8_t*>(packet.text + offset), length);
      notifyCallbacks.succeeded = false;
      tx->notify(); // Retorna void: el resultado se recibe en onStatus.
      if (!notifyCallbacks.succeeded) failConnection(packet.epoch);
      xSemaphoreGive(notificationGate);
      if (!notifyCallbacks.succeeded) break;
      vTaskDelay(1); // Ceder la radio sin bloquear el watchdog de loop().
    }
  }
}

#else
void sendReplies(void*) {
  Packet packet{};
  for (;;) {
    if (xQueueReceive(outgoing, &packet, portMAX_DELAY) != pdTRUE) continue;
    if (packet.epoch != usbEpoch.load()) continue;
    const size_t size = strlen(packet.text);
    if (Serial.write(reinterpret_cast<const uint8_t*>(packet.text), size) != size) failConnection(packet.epoch);
  }
}
#endif

void applyMotors() {
  if (!pwmReady) {
    digitalWrite(MOTOR_IZQUIERDO, LOW);
    digitalWrite(MOTOR_DERECHO, LOW);
    return;
  }
  const robolab::Output output = session.motion().output();
  const int power = session.motion().command() == 'A' ? velocidadAvance : velocidadGiro;
  ledcWrite(MOTOR_IZQUIERDO, output.left ? power : 0);
  ledcWrite(MOTOR_DERECHO, output.right ? power : 0);
}

void animateStep() {
  if (!session.motion().takeStep()) return;
  vida.silenciar();
  switch (session.motion().command()) {
    case 'A': vida.gestoAvance(happyForward); happyForward = !happyForward; break;
    case 'D': vida.gestoIzquierda(); break;
    case 'Z': vida.gestoDerecha(); break;
  }
}

#if !ROBOLAB_USAR_BLE
void resetUsbConnection(void*) {
  usbEpoch.fetch_add(1); // No enviar respuestas pendientes de una sesión anterior.
  applyMotors(); // UsbTransport ya dejó las salidas apagadas antes de HELLO.
  vida.silenciar(); vida.neutral();
}
robolab::UsbTransport usb(session, resetUsbConnection);
#endif

void setup() {
  pinMode(MOTOR_IZQUIERDO, OUTPUT); digitalWrite(MOTOR_IZQUIERDO, LOW);
  pinMode(MOTOR_DERECHO, OUTPUT); digitalWrite(MOTOR_DERECHO, LOW);
  Serial.begin(115200);
  vida.iniciar(); // Sin OLED la conexión y los motores siguen disponibles.
  const bool left = ledcAttachChannel(MOTOR_IZQUIERDO, FRECUENCIA_PWM, BITS_PWM, CANAL_MOTOR_IZQUIERDO);
  const bool right = ledcAttachChannel(MOTOR_DERECHO, FRECUENCIA_PWM, BITS_PWM, CANAL_MOTOR_DERECHO);
  pwmReady = left && right;
  if (left) ledcWrite(MOTOR_IZQUIERDO, 0);
  if (right) ledcWrite(MOTOR_DERECHO, 0);
  if (!pwmReady || !robolab::validTiming(movementConfig) ||
      velocidadAvance < 1 || velocidadAvance > 255 || velocidadGiro < 1 || velocidadGiro > 255) {
    Serial.println("Configuracion/PWM invalido. Motores apagados."); return;
  }
  outgoing = xQueueCreate(16, sizeof(Packet));
#if ROBOLAB_USAR_BLE
  notificationGate = xSemaphoreCreateMutex();
  if (!outgoing || !notificationGate) {
    Serial.println("No se pudo iniciar BLE. Motores apagados."); return;
  }
  BLEDevice::init(ROBOT_NOMBRE);
  BLEDevice::setMTU(23); // Payload útil universal: 20 bytes, aunque el cliente negocie más.
  bluetooth = BLEDevice::createServer();
  bluetooth->setCallbacks(&connectionCallbacks);
  bluetooth->advertiseOnDisconnect(false);
  BLEService* service = bluetooth->createService(SERVICE_UUID);
  tx = service->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  subscription = new BLE2902();
  tx->addDescriptor(subscription);
  tx->setCallbacks(&notifyCallbacks);
  BLECharacteristic* rx = service->createCharacteristic(RX_UUID, BLECharacteristic::PROPERTY_WRITE);
  rx->setAccessPermissions(ESP_GATT_PERM_WRITE); // Sin cifrado ni bonding requerido.
  rx->setCallbacks(&receiveCallbacks);
  service->start();
  if (xTaskCreate(sendReplies, "robolab-ble-tx", 4096, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("No se pudo iniciar BLE. Motores apagados."); return;
  }
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true); // El nombre RoboLab viaja en la respuesta de escaneo.
  advertising->start();
  ready = true;
  Serial.printf("Abre RoboLab en Chrome y elige %s por Bluetooth BLE.\n", ROBOT_NOMBRE);
  Serial.println("Monitor serie: P = parar. R no disponible; D/Z son giros en arco.");
#else
  if (!outgoing || xTaskCreate(sendReplies, "robolab-usb-tx", 4096, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("No se pudo iniciar USB Serial. Motores apagados."); return;
  }
  ready = true;
  Serial.println("Abre RoboLab en Chrome y elige el robot conectado por USB (115200).");
  Serial.println("Para parar: boton Parar robot o linea STOP. R no disponible; D/Z son giros en arco.");
#endif
}

#if ROBOLAB_USAR_BLE
void synchronizeConnection() {
  const auto state = radioState();
  if (state.epoch == loopEpoch) return;
  session.tick(millis(), false); // Aborta incluso si desconectó y reconectó entre dos ticks.
  session.reset(); // También limpia parciales e ids de la conexión anterior.
  applyMotors();
  loopEpoch = state.epoch;
  vida.silenciar(); vida.neutral();
}

void disconnectRobot() {
  const auto state = radioState();
  failConnection(state.epoch); // No aceptar otro RUN mientras llega onDisconnect.
  if (state.connected) bluetooth->disconnect(state.client);
}

void restartAdvertising() {
  // No esperar a la tarea TX: si está ocupada se reintenta en el siguiente loop.
  // Impide reutilizar conn_id con una notificación antigua aún en vuelo.
  if (!ready || xSemaphoreTake(notificationGate, 0) != pdTRUE) return;
  portENTER_CRITICAL(&radioMux);
  const bool restart = advertisePending && !radio.snapshot().connected;
  if (restart) advertisePending = false;
  portEXIT_CRITICAL(&radioMux);
  if (restart) BLEDevice::startAdvertising();
  xSemaphoreGive(notificationGate);
}

void loop() {
  // La pérdida de cliente y el watchdog se procesan antes de cualquier comando.
  synchronizeConnection();
  auto state = radioState();
  bool connected = ready && state.connected && state.epoch == loopEpoch;
  session.tick(millis(), connected);
  applyMotors();
  if (state.failed && state.connected) {
    session.stop("ERR:NETWORK");
    applyMotors();
    disconnectRobot(); // Los motores ya están apagados.
    connected = false;
  }
  for (int i = 0; i < 32 && Serial.available(); ++i) {
    const char c = static_cast<char>(Serial.read());
    if (c == 'P' || c == 'p') {
      session.stop(); applyMotors();
      disconnectRobot(); // P tiene prioridad sobre cualquier RUN que siga en la cola.
      return;
    }
  }
  if (connected) {
    for (int i = 0; i < 256; ++i) {
      char byte;
      portENTER_CRITICAL(&radioMux);
      const bool available = radio.pop(loopEpoch, byte);
      portEXIT_CRITICAL(&radioMux);
      if (!available) break;
      session.feed(byte, millis());
    }
  }
  synchronizeConnection();
  state = radioState();
  connected = ready && state.connected && !state.failed && state.epoch == loopEpoch;
  session.tick(millis(), connected);
  applyMotors();
  animateStep();
  vida.actualizar(!session.motion().moving());
  restartAdvertising();
  delay(2);
}
#else
void loop() {
  // CH340 no informa del cierre del puerto al ESP32: el latido sigue siendo
  // obligatorio incluso conectado por cable. Procesarlo antes que los comandos.
  session.tick(millis(), ready);
  applyMotors();
  if (writeFailed.exchange(false)) {
    session.stop("ERR:NETWORK");
    applyMotors();
    session.reset(); usb.clear();
    usbEpoch.fetch_add(1);
    writeFailed.store(false);
  }
  if (ready) {
    for (int i = 0; i < 256 && Serial.available(); ++i) {
      usb.feed(static_cast<char>(Serial.read()), millis());
    }
  }
  session.tick(millis(), ready);
  applyMotors();
  animateStep();
  vida.actualizar(!session.motion().moving());
  delay(2);
}
#endif
