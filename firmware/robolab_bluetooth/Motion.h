#pragma once
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

