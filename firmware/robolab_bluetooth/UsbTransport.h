#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include "Protocol.h"

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
