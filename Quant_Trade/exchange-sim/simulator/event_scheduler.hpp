#pragma once

#include "simulation_clock.hpp"

#include <functional>
#include <queue>
#include <vector>
#include <cstdint>

namespace hft {

// =============================================================================
// EventScheduler
//
// Min-heap priority queue of scheduled callbacks keyed by nanosecond timestamp.
// Drives synthetic simulation: market maker, noise trader, and any
// periodic tasks can schedule themselves here.
// =============================================================================
struct ScheduledEvent {
    uint64_t                  fire_ns;      // absolute simulation ns
    uint64_t                  id;           // monotonic id for tie-breaking
    std::function<void()>     callback;

    bool operator>(const ScheduledEvent& o) const noexcept {
        if (fire_ns != o.fire_ns) return fire_ns > o.fire_ns;
        return id > o.id;
    }
};

class EventScheduler {
public:
    EventScheduler() = default;

    // Schedule a one-shot callback at absolute simulation time `fire_ns`
    void schedule(uint64_t fire_ns, std::function<void()> cb) {
        queue_.push({ fire_ns, next_id_++, std::move(cb) });
    }

    // Schedule a recurring callback every `interval_ns` nanoseconds,
    // starting from `first_ns`. The callback should return true to
    // continue rescheduling, or false to stop.
    void schedule_recurring(uint64_t first_ns,
                            uint64_t interval_ns,
                            std::function<bool(uint64_t /*fire_ns*/)> cb)
    {
        // Capture interval and the scheduler itself to re-enqueue after firing
        auto fire = [this, first_ns, interval_ns, cb]() mutable {
            if (cb(first_ns)) {
                schedule_recurring(first_ns + interval_ns, interval_ns, cb);
            }
        };
        schedule(first_ns, std::move(fire));
    }

    // Process all events with fire_ns <= clock.now()
    void tick(SimulationClock& clock) {
        while (!queue_.empty() && queue_.top().fire_ns <= clock.now()) {
            // Pop by copy (top returns const ref)
            ScheduledEvent ev = queue_.top();
            queue_.pop();
            ev.callback();
        }
    }

    // Run until no more events remain, advancing the clock to each event
    void run_all(SimulationClock& clock) {
        while (!queue_.empty()) {
            clock.set(queue_.top().fire_ns);
            tick(clock);
        }
    }

    [[nodiscard]] bool   empty() const noexcept { return queue_.empty(); }
    [[nodiscard]] size_t size()  const noexcept { return queue_.size(); }

    void clear() {
        while (!queue_.empty()) queue_.pop();
    }

private:
    using MinHeap = std::priority_queue<
        ScheduledEvent,
        std::vector<ScheduledEvent>,
        std::greater<ScheduledEvent>
    >;

    MinHeap  queue_;
    uint64_t next_id_ = 0;
};

} // namespace hft
