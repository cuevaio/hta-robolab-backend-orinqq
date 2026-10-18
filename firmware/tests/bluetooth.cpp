#include <cassert>
#include <string>
#include <vector>
#include "../robolab_bluetooth/Protocol.h"
#include "../robolab_bluetooth/BleTransport.h"
#include "../robolab_bluetooth/UsbTransport.h"

struct Reply { std::string id, value; };
static void capture(void* context, const char* id, const char* reply) {
  static_cast<std::vector<Reply>*>(context)->push_back({id, reply});
}
static void line(robolab::RobotSession& session, const std::string& text, uint32_t now = 0) {
  for (char c : text) session.feed(c, now);
}

// La característica ya contiene el valor confirmado tanto para WRITE corto
// como EXEC_WRITE. El segundo evento no contiene puntero/longitud de payload.
struct CommittedCharacteristic {
  std::string value;
  const char* getData() { return value.data(); }
  size_t getLength() const { return value.size(); }
};

static void testBleTransport() {
  robolab::BleTransport radio;
  char byte = 0;
  radio.connect(7);
  const auto first = radio.snapshot();
  assert(first.connected && !first.failed);
  assert(radio.receive(7, "HEL", 3));
  assert(radio.pop(first.epoch, byte) && byte == 'H');
  radio.disconnect(7);
  radio.connect(7); // El stack puede reutilizar conn_id antes del siguiente loop.
  const auto second = radio.snapshot();
  assert(second.connected && second.epoch != first.epoch);
  assert(!radio.current(first.epoch)); // Nunca notificar un STATUS de la conexion anterior.
  assert(!radio.pop(first.epoch, byte));
  assert(!radio.pop(second.epoch, byte)); // Descarta incluso el fragmento pendiente "EL".
  assert(!radio.receive(8, "RUN old A\n", 10)); // Otro cliente no inyecta bytes.
  assert(radio.receive(7, "LO\n", 3));
  std::string received;
  while (radio.pop(second.epoch, byte)) received += byte;
  assert(received == "LO\n");
  radio.fail(first.epoch); // Un fallo de TX viejo no desconecta al cliente nuevo.
  assert(radio.current(second.epoch));

  const robolab::Config config = {1000, 1000, 1000, 100, 100000, true};
  std::vector<Reply> replies;
  robolab::RobotSession robot(config, capture, &replies);
  line(robot, "HELLO\nRUN old A\n");
  robot.tick(250, true);
  assert(robot.motion().output().left && robot.motion().output().right);
  // Aunque connected sigue en true, el cambio de epoch obliga al loop a abortar.
  radio.disconnect(7);
  radio.connect(7);
  assert(radio.snapshot().epoch != second.epoch);
  robot.tick(260, false);
  robot.reset();
  assert(!robot.motion().output().left && !robot.motion().output().right);
  line(robot, "RUN no-hello A\n", 270);
  assert(!robot.motion().active());
  line(robot, "HELLO\nRUN fragment ", 270);
  radio.disconnect(7);
  robot.reset();
  radio.connect(7);
  const auto third = radio.snapshot();
  assert(radio.receive(7, "A\n", 2));
  while (radio.pop(third.epoch, byte)) robot.feed(byte, 280);
  assert(!robot.motion().active()); // El LF nuevo no completa un RUN viejo.

  // La cola RX acotada falla cerrada: nunca ejecuta un prefijo truncado.
  const std::string flood(robolab::BleTransport::RX_CAPACITY, 'A');
  assert(radio.receive(7, flood.data(), flood.size()));
  assert(!radio.receive(7, "\n", 1));
  assert(radio.snapshot().failed && !radio.current(third.epoch));
  assert(!radio.pop(third.epoch, byte));
  radio.disconnect(7);
  radio.connect(7);
  const auto recovered = radio.snapshot();
  assert(!recovered.failed && radio.current(recovered.epoch));
  assert(radio.receive(7, "HELLO\n", 6));
  received.clear();
  while (radio.pop(recovered.epoch, byte)) received += byte;
  assert(received == "HELLO\n");
  CommittedCharacteristic confirmed{"HELLO\nRUN committed A\n"};
  assert(radio.receiveCharacteristic(7, confirmed));
  robot.reset();
  while (radio.pop(recovered.epoch, byte)) robot.feed(byte, 300);
  assert(robot.motion().active());
  assert(replies.back().id == "committed" && replies.back().value == "RUN");
}

static void testUsbTransport() {
  const robolab::Config config = {1000, 1000, 1000, 100, 100000, true};
  std::vector<Reply> replies;
  robolab::RobotSession robot(config, capture, &replies);
  robolab::UsbTransport usb(robot);
  auto feed = [&](const std::string& text, uint32_t now) {
    for (const char byte : text) usb.feed(byte, now);
  };
  feed("HELLO\nRUN reuse A\n", 0);
  robot.tick(250, true);
  assert(robot.motion().output().left && robot.motion().output().right);
  feed("P", 500); // La P de PING no es una orden de emergencia por caracter.
  assert(robot.motion().active());
  feed("ING\n", 500);
  assert(replies.back().value == "PONG" && robot.motion().active());
  feed("noiseHELLO\n", 600); // Solo una linea HELLO exacta abre otra sesion.
  assert(robot.motion().active() && replies.back().value == "ERR:FRAME");
  feed("HELLO\r\n", 700);
  assert(!robot.motion().active());
  assert(!robot.motion().output().left && !robot.motion().output().right);
  assert(replies.back().value == "ROBO/1 ADZ ARC");
  feed("RUN reuse A\n", 800); // Un HELLO nuevo limpia los ids de la sesion anterior.
  assert(robot.motion().active() && replies.back().value == "RUN");
  feed("RUN partial ", 810);
  feed(std::string("\0\n", 2) + "STOP\nHELLO\n", 820); // Prefijo real al abrir/reintentar desde Chrome.
  assert(!robot.motion().active() && replies.back().value == "ROBO/1 ADZ ARC");
  feed("A\n", 830);
  assert(!robot.motion().active() && replies.back().value == "ERR:FRAME");
  feed("HELLO\nRUN old A", 840);
  const size_t beforeResync = replies.size();
  feed(std::string("\0\n", 2), 850); // Nunca completar el RUN viejo con el LF inicial.
  assert(!robot.motion().active());
  assert(!robot.motion().output().left && !robot.motion().output().right);
  assert(replies.back().value == "ERR:FRAME");
  for (size_t i = beforeResync; i < replies.size(); ++i) {
    assert(!(replies[i].id == "old" && (replies[i].value == "OK" || replies[i].value == "RUN")));
  }
  feed("STOP\nHELLO\n", 860);
  assert(replies.back().value == "ROBO/1 ADZ ARC");
  feed("RUN long " + std::string(30, 'A') + "\n", 900);
  feed("PING\n", 1000);
  robot.tick(1250, true);
  assert(robot.motion().output().left && robot.motion().output().right);
  robot.tick(4499, true);
  assert(robot.motion().active());
  robot.tick(4500, true);
  assert(!robot.motion().output().left && !robot.motion().output().right);
  assert(replies.back().id == "long" && replies.back().value == "ERR:HEARTBEAT");
  feed("RUN blocked A\n", 4510);
  assert(!robot.motion().active());
  feed("HELLO\n", 4520);
  feed(std::string(220, 'A') + "\n", 4530);
  assert(replies.back().value == "ERR:FRAME");
  feed("HELLO\nRUN reuse A\n", 4540);
  assert(robot.motion().active() && replies.back().value == "RUN");
}

int main() {
  testBleTransport();
  testUsbTransport();
  const robolab::Config config = {1000, 1000, 1000, 100, 100000, true};
  std::vector<Reply> replies;
  robolab::RobotSession session(config, capture, &replies);
  line(session, "RUN first A\n");
  assert(!session.motion().active()); // no movimiento antes de HELLO
  line(session, "HELLO\r\n");
  assert(replies.back().value == "ROBO/1 ADZ ARC");
  line(session, "RUN first A");
  assert(!session.motion().active()); // una trama incompleta no se ejecuta
  line(session, "\n");
  assert(session.motion().active());
  assert(replies[replies.size()-2].value == "OK" && replies.back().value == "RUN");
  session.tick(250, true);
  assert(session.motion().output().left && session.motion().output().right);
  line(session, "RUN other D\n", 260);
  assert(replies.back().id == "other" && replies.back().value == "ERR:BUSY");
  line(session, "STOP\n", 300);
  assert(!session.motion().active());
  assert(!session.motion().output().left && !session.motion().output().right);
  assert(replies.back().id == "first" && replies.back().value == "ERR:STOPPED");
  line(session, "RUN other D\n", 350);
  assert(!session.motion().active()); // BUSY también es un resultado definitivo de ese id
  assert(replies.back().id == "other" && replies.back().value == "ERR:BUSY");
  line(session, "RUN first A\n", 400);
  assert(!session.motion().active()); // id ya visto, no reiniciar motores
  assert(replies.back().value == "ERR:STOPPED");

  line(session, "RUN reverse ARDA\n", 500);
  assert(replies.back().value == "ERR:REVERSE_UNSUPPORTED");
  assert(!session.motion().active());
  line(session, "RUN invalid AX\n", 500);
  assert(replies.back().value == "ERR:BAD_CHAR");
  line(session, "RUN huge " + std::string(129, 'A') + "\n", 500);
  assert(replies.back().value == "ERR:TOO_LONG");
  line(session, "RUN fragment " + std::string(220, 'A') + "\n", 500);
  assert(replies.back().value == "ERR:FRAME");
  assert(!session.motion().active());

  line(session, "RUN lost A\n", 600);
  session.tick(850, true);
  session.tick(900, false);
  assert(!session.motion().output().left && !session.motion().output().right);
  assert(replies.back().value == "ERR:DISCONNECTED");

  session.reset();
  line(session, "HELLO\n", 0);
  line(session, "RUN timeout A\n", 0);
  session.tick(3500, true);
  assert(replies.back().value == "ERR:HEARTBEAT");
  assert(!session.motion().output().left && !session.motion().output().right);

  session.reset();
  line(session, "HELLO\n");
  line(session, "RUN complete DZ\n");
  session.tick(250, true);
  assert(!session.motion().output().left && session.motion().output().right); // D izquierda
  session.tick(1250, true);
  session.tick(1350, true);
  session.tick(1600, true);
  assert(session.motion().output().left && !session.motion().output().right); // Z derecha
  line(session, "PING\n", 2000);
  assert(replies.back().value == "PONG");
  session.tick(2600, true);
  session.tick(2700, true);
  assert(replies.back().id == "complete" && replies.back().value == "DONE");
  line(session, "RUN complete DZ\n", 2800);
  assert(!session.motion().active() && replies.back().value == "DONE");

  // No expulsar ids antiguos de la memoria y permitir que se vuelvan a ejecutar.
  for (int i = 0; i < 63; ++i) line(session, "RUN id-" + std::to_string(i) + " R\n", 2800);
  line(session, "RUN full A\n", 2800);
  assert(replies.back().value == "ERR:RECONNECT");
  assert(!session.motion().active());

  // Un contador millis() que desborda sigue detectando pérdida de latidos.
  session.reset();
  line(session, "HELLO\n", UINT32_MAX - 100);
  line(session, "RUN wrap A\n", UINT32_MAX - 100);
  session.tick(3400, true);
  assert(replies.back().value == "ERR:HEARTBEAT");
}
