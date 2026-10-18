#include <cassert>
#include <string>
#include <vector>
#include "../robolab_bluetooth/Protocol.h"

struct Reply { std::string id, value; };
static void capture(void* context, const char* id, const char* reply) {
  static_cast<std::vector<Reply>*>(context)->push_back({id, reply});
}
static void line(robolab::RobotSession& session, const std::string& text, uint32_t now = 0) {
  for (char c : text) session.feed(c, now);
}

int main() {
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
