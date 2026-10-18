#pragma once
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
