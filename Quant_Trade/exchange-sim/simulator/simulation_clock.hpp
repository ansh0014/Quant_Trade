#pragma once

#include <cstdint>
#include <atomic>

namespace hft {

// =============================================================================
// SimulationClock
//
// Provides a monotonic nanosecond clock for the exchange simulator.
// In replay mode, time is driven by event timestamps.
// In synthetic mode, time advances by a configurable tick.
// =============================================================================
class SimulationClock {
public:
    explicit SimulationClock(uint64_t start_ns = 0) noexcept
        : current_ns_(start_ns)
    {}

    // Advance clock to a specific absolute time (replay mode)
    void set(uint64_t ns) noexcept {
        if (ns > current_ns_) current_ns_ = ns;
    }

    // Advance clock by a relative amount
    void advance(uint64_t delta_ns) noexcept {
        current_ns_ += delta_ns;
    }

    [[nodiscard]] uint64_t now() const noexcept {
        return current_ns_;
    }

    void reset(uint64_t start_ns = 0) noexcept {
        current_ns_ = start_ns;
    }

private:
    uint64_t current_ns_;
};

} // namespace hft
