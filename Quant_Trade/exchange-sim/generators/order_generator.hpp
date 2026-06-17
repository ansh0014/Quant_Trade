#pragma once

#include "../../core-cpp/include/common/types.hpp"

#include <cstdint>
#include <functional>

namespace hft {

// =============================================================================
// OrderGenerator  (pure interface)
//
// Any synthetic participant (market maker, noise trader, …) implements this
// interface.  The simulator calls next_order() at each scheduled fire time.
// Returns false when the generator is exhausted.
// =============================================================================
class OrderGenerator {
public:
    virtual ~OrderGenerator() = default;

    // Called by the simulator at `now_ns`.
    // Returns true and fills `out` if an order should be sent; returns false
    // to indicate the generator is done (or has nothing to send this tick).
    virtual bool next_order(uint64_t now_ns, Order& out) noexcept = 0;

    // Interval hint: how often (ns) the scheduler should call this generator.
    // Zero means the generator controls its own scheduling externally.
    [[nodiscard]] virtual uint64_t interval_ns() const noexcept = 0;

    // Human-readable name for logging/stats
    [[nodiscard]] virtual const char* name() const noexcept = 0;
};

// Convenience alias for callbacks that receive an order
using OrderCallback = std::function<void(const Order&)>;

} // namespace hft
