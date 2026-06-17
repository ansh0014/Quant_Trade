#pragma once

#include "order_generator.hpp"
#include "../../core-cpp/include/common/types.hpp"
#include "../../core-cpp/include/matching_engine/matching_engine.hpp"

#include <cstdint>
#include <algorithm>

namespace hft {

// =============================================================================
// MarketMaker
//
// Two-sided liquidity provider.  On each tick it:
//   1. Reads the current best bid/ask via MatchingEngine::get_market_data().
//   2. Cancels its previous resting quotes (if any).
//   3. Posts a new bid at (mid - half_spread) and a new ask at (mid + half_spread).
//
// The half-spread and quoted size are configurable.  The market maker uses a
// dedicated ClientId and increments its own order-id sequence.
// =============================================================================
class MarketMaker : public OrderGenerator {
public:
    struct Config {
        SymbolId symbol_id    = 0;
        ClientId client_id    = 1;
        uint32_t half_spread  = 5;        // ticks on each side of mid
        Quantity quote_qty    = 100;
        uint64_t interval_ns  = 1'000'000; // 1 ms refresh
        Price    ref_price    = 10'000;    // seed price if book is empty
        uint64_t seed_oid     = 1'000'000; // starting order-id (avoids collision)
    };

    explicit MarketMaker(MatchingEngine& engine, const Config& cfg)
        : engine_(engine)
        , cfg_(cfg)
        , next_oid_(cfg.seed_oid)
        , pending_bid_oid_(0)
        , pending_ask_oid_(0)
    {}

    // OrderGenerator interface ------------------------------------------------
    bool next_order(uint64_t now_ns, Order& out) noexcept override {
        // Cancel previous resting quotes
        cancel_resting(now_ns);

        // Determine mid price from book; fall back to ref_price if empty
        MarketData md = engine_.get_market_data(cfg_.symbol_id);
        Price mid     = compute_mid(md);

        // Post bid
        Price bid_px = (mid > cfg_.half_spread)
                       ? mid - cfg_.half_spread : 1;
        Price ask_px = mid + cfg_.half_spread;

        pending_bid_oid_ = next_oid_++;
        Order bid(pending_bid_oid_, bid_px, cfg_.quote_qty,
                  OrderSide::BUY,  OrderType::LIMIT,
                  cfg_.symbol_id, cfg_.client_id, now_ns);

        MatchResult r;
        engine_.submit_order(bid, r, now_ns);

        // Post ask (ignore result here; the caller can subscribe via callbacks)
        pending_ask_oid_ = next_oid_++;
        Order ask(pending_ask_oid_, ask_px, cfg_.quote_qty,
                  OrderSide::SELL, OrderType::LIMIT,
                  cfg_.symbol_id, cfg_.client_id, now_ns);
        engine_.submit_order(ask, r, now_ns);

        // We already submitted directly; no need to return an order
        // but we must satisfy the interface — return false (nothing extra).
        (void)out;
        return false;
    }

    [[nodiscard]] uint64_t   interval_ns() const noexcept override { return cfg_.interval_ns; }
    [[nodiscard]] const char* name()       const noexcept override { return "MarketMaker"; }

    void set_half_spread(uint32_t ticks) noexcept { cfg_.half_spread = ticks; }
    void set_quote_qty(Quantity qty)     noexcept { cfg_.quote_qty   = qty;   }

private:
    Price compute_mid(const MarketData& md) const noexcept {
        if (md.best_bid_price > 0 && md.best_ask_price > 0)
            return (md.best_bid_price + md.best_ask_price) / 2;
        if (md.best_bid_price > 0) return md.best_bid_price + cfg_.half_spread;
        if (md.best_ask_price > 0) return (md.best_ask_price > cfg_.half_spread)
                                          ? md.best_ask_price - cfg_.half_spread : 1;
        return cfg_.ref_price;
    }

    void cancel_resting(uint64_t now_ns) noexcept {
        if (pending_bid_oid_) {
            engine_.cancel_order(cfg_.symbol_id, pending_bid_oid_,
                                 cfg_.client_id, 0, now_ns);
            pending_bid_oid_ = 0;
        }
        if (pending_ask_oid_) {
            engine_.cancel_order(cfg_.symbol_id, pending_ask_oid_,
                                 cfg_.client_id, 0, now_ns);
            pending_ask_oid_ = 0;
        }
    }

    MatchingEngine& engine_;
    Config          cfg_;
    uint64_t        next_oid_;
    OrderId         pending_bid_oid_;
    OrderId         pending_ask_oid_;
};

} // namespace hft
