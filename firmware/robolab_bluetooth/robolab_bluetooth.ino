// RoboLab: Bluetooth Low Energy UART, Arduino-ESP32 3.3.11 (Bluedroid).
// No requiere wifi, cuenta, emparejamiento del sistema ni bonding.
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <freertos/semphr.h>
#include "Config.h"
#include "Protocol.h"
#include "VidaRobot.h"
#include "BleTransport.h"

#if !defined(CONFIG_BLUEDROID_ENABLED)
#error "Este sketch necesita la biblioteca BLE Bluedroid de Arduino-ESP32."
#endif

constexpr char SERVICE_UUID[] = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char RX_UUID[] = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
constexpr char TX_UUID[] = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
BLEServer* bluetooth = nullptr;
BLECharacteristic* tx = nullptr;
BLE2902* subscription = nullptr;
VidaRobot vida;
struct Packet { uint32_t epoch; char text[100]; };
QueueHandle_t outgoing = nullptr;
SemaphoreHandle_t notificationGate = nullptr;
portMUX_TYPE radioMux = portMUX_INITIALIZER_UNLOCKED;
robolab::BleTransport radio;
uint32_t loopEpoch = 0;
bool ready = false, pwmReady = false, happyForward = true;
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

// La tarea de motores nunca espera notificaciones. Cola fija, envío sin espera.
void enqueueReply(void*, const char* id, const char* value) {
  Packet packet{};
  packet.epoch = loopEpoch;
  if (*id) snprintf(packet.text, sizeof(packet.text), "STATUS %s %s\n", id, value);
  else snprintf(packet.text, sizeof(packet.text), "%s\n", value);
  if (!outgoing || xQueueSend(outgoing, &packet, 0) != pdTRUE) failConnection(packet.epoch);
}

const robolab::Config movementConfig = {
  MS_CASILLA, MS_GIRO_IZQUIERDA, MS_GIRO_DERECHA,
  MS_PAUSA, MAX_EJECUCION_MS, ACEPTAR_GIROS_EN_ARCO
};
robolab::RobotSession session(movementConfig, enqueueReply, nullptr);

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
}

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
