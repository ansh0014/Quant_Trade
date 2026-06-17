#pragma once

#include "../../core-cpp/include/common/types.hpp"

#include <cstdio>
#include <cstring>
#include <functional>
#include <vector>

namespace hft {

// =============================================================================
// SnapshotPublisher
//
// Consumes MarketData snapshots from the matching engine and distributes them
// to registered listeners.  In production this would push over UDP multicast
// or shared memory; in the simulator we call registered callbacks directly.
// =============================================================================
class SnapshotPublisher {
public:
    using Listener = std::function<void(const MarketData&)>;

    SnapshotPublisher() = default;

    // Register a new listener (e.g. a strategy, a logger, a network writer)
    void subscribe(Listener listener) {
        listeners_.push_back(std::move(listener));
    }

    // Publish a snapshot to all listeners
    void publish(const MarketData& md) noexcept {
        for (const auto& l : listeners_) {
            l(md);
        }
        ++publish_count_;
    }

    // Also print a human-readable line to stdout (useful in sim mode)
    void publish_verbose(const MarketData& md) noexcept {
        std::printf(
            "[SNAP] sym=%u  bid=%u x %u  ask=%u x %u  last=%u x %u  seq=%lu\n",
            static_cast<unsigned>(md.symbol_id),
            md.best_bid_price, md.best_bid_qty,
            md.best_ask_price, md.best_ask_qty,
            md.last_trade_price, md.last_trade_qty,
            static_cast<unsigned long>(md.sequence));
        publish(md);
    }

    [[nodiscard]] uint64_t publish_count() const noexcept { return publish_count_; }

private:
    std::vector<Listener> listeners_;
    uint64_t              publish_count_ = 0;
};

} // namespace hft
