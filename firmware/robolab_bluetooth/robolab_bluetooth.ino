// RoboLab: Bluetooth Classic SPP, ESP32 clásico, Arduino-ESP32 3.x.
// No requiere wifi, clave del robot ni registro en Convex.
#include <Arduino.h>
#include <BluetoothSerial.h>
#include <atomic>
#include "Config.h"
#include "Protocol.h"
#include "VidaRobot.h"

#if !defined(CONFIG_BT_SPP_ENABLED)
#error "Se necesita un ESP32 clasico con Bluetooth Classic SPP; S3/C3 no sirven."
#endif

BluetoothSerial bluetooth;
VidaRobot vida;
struct Packet { char text[100]; };
QueueHandle_t outgoing = nullptr;
std::atomic<bool> writeFailed{false};
bool ready = false, previousClient = false, pwmReady = false, happyForward = true;

// La tarea de motores nunca espera un envío Bluetooth. La cola tiene tamaño
// fijo y el productor no bloquea, incluso si la radio o la laptop dejan de leer.
void enqueueReply(void*, const char* id, const char* value) {
  Packet packet{};
  if (*id) snprintf(packet.text, sizeof(packet.text), "STATUS %s %s\n", id, value);
  else snprintf(packet.text, sizeof(packet.text), "%s\n", value);
  if (!outgoing || xQueueSend(outgoing, &packet, 0) != pdTRUE) writeFailed.store(true);
}

const robolab::Config movementConfig = {
  MS_CASILLA, MS_GIRO_IZQUIERDA, MS_GIRO_DERECHA,
  MS_PAUSA, MAX_EJECUCION_MS, ACEPTAR_GIROS_EN_ARCO
};
robolab::RobotSession session(movementConfig, enqueueReply, nullptr);

void sendReplies(void*) {
  Packet packet{};
  for (;;) {
    if (xQueueReceive(outgoing, &packet, portMAX_DELAY) == pdTRUE && bluetooth.hasClient()) {
      const size_t size = strlen(packet.text);
      if (bluetooth.write(reinterpret_cast<const uint8_t*>(packet.text), size) != size) writeFailed.store(true);
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
  bluetooth.enableSSP(false, false);
  if (!outgoing || !bluetooth.begin(ROBOT_NOMBRE, false, true) ||
      xTaskCreate(sendReplies, "robolab-spp", 4096, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("No se pudo iniciar Bluetooth. Motores apagados."); return;
  }
  ready = true;
  Serial.printf("Empareja %s en la laptop. Abre RoboLab y elige Bluetooth.\n", ROBOT_NOMBRE);
  Serial.println("Monitor serie: P = parar. R no disponible; D/Z son giros en arco.");
}

void loop() {
  // La pérdida de cliente y el watchdog se procesan antes de cualquier comando.
  const bool connected = ready && bluetooth.hasClient();
  session.tick(millis(), connected);
  applyMotors();
  if (connected != previousClient) {
    session.reset();
    if (outgoing) xQueueReset(outgoing);
    writeFailed.store(false);
    previousClient = connected;
    vida.silenciar(); vida.neutral();
  }
  if (writeFailed.exchange(false)) {
    session.stop("ERR:NETWORK");
    applyMotors();
    bluetooth.disconnect(); // Los motores ya están apagados.
  }
  for (int i = 0; i < 32 && Serial.available(); ++i) {
    const char c = static_cast<char>(Serial.read());
    if (c == 'P' || c == 'p') {
      session.stop(); applyMotors();
      bluetooth.disconnect(); // P tiene prioridad sobre cualquier RUN que siga en la cola.
      return;
    }
  }
  if (connected) {
    for (int i = 0; i < 256 && bluetooth.available(); ++i) {
      session.feed(static_cast<char>(bluetooth.read()), millis());
    }
  }
  session.tick(millis(), connected);
  applyMotors();
  animateStep();
  vida.actualizar(!session.motion().moving());
  delay(2);
}
