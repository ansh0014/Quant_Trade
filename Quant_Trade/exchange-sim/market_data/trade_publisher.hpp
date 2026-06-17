#pragma once

#include "../../core-cpp/include/common/types.hpp"

#include <cstdio>
#include <functional>
#include <vector>

namespace hft {

// =============================================================================
// TradePublisher
//
// Consumes Trade records produced by the matching engine and distributes them
// to all registered listeners.  Listeners can be logging backends, P&L engines,
// risk monitors, or strategy feedback loops.
// =============================================================================
class TradePublisher {
public:
    using Listener = std::function<void(const Trade&)>;

    TradePublisher() = default;

    void subscribe(Listener listener) {
        listeners_.push_back(std::move(listener));
    }

    void publish(const Trade& trade) noexcept {
        for (const auto& l : listeners_) {
            l(trade);
        }
        ++trade_count_;
        total_volume_ += trade.quantity;
    }

    void publish_verbose(const Trade& trade) noexcept {
        std::printf(
            "[TRADE] id=%lu  %u@%u  bid_oid=%lu  ask_oid=%lu  sym=%u  seq=%lu\n",
            static_cast<unsigned long>(trade.trade_id),
            trade.quantity,
            trade.price,
            static_cast<unsigned long>(trade.bid_order_id),
            static_cast<unsigned long>(trade.ask_order_id),
            static_cast<unsigned>(trade.symbol_id),
            static_cast<unsigned long>(trade.sequence));
        publish(trade);
    }

    [[nodiscard]] uint64_t trade_count()   const noexcept { return trade_count_;   }
    [[nodiscard]] uint64_t total_volume()  const noexcept { return total_volume_;  }

private:
    std::vector<Listener> listeners_;
    uint64_t              trade_count_  = 0;
    uint64_t              total_volume_ = 0;
};

} // namespace hft
