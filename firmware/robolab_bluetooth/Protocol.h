#pragma once
#include <cstdio>
#include <cstring>
#include "Motion.h"

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
