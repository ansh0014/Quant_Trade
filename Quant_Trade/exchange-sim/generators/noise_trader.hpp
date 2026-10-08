#pragma once

#include "order_generator.hpp"
#include "../../core-cpp/include/common/types.hpp"
#include "../../core-cpp/include/matching_engine/matching_engine.hpp"

#include <cstdint>
#include <random>
#include <algorithm>

namespace hft {

// =============================================================================
// NoiseTrader
//
// Generates random limit orders around a configurable mid-price with a
// normally-distributed price offset and uniformly-distributed quantity.
//
// Modelling a "noise" participant that provides randomised order flow
// without any strategic intent — essential for realistic market simulations.
// =============================================================================
class NoiseTrader : public OrderGenerator {
public:
    struct Config {
        SymbolId symbol_id    = 0;
        ClientId client_id    = 999;
        Price    mid_price    = 10'000;   // in price ticks
        uint32_t price_sigma  = 20;       // std-dev of price offset (ticks)
        Quantity min_qty      = 1;
        Quantity max_qty      = 500;
        uint64_t interval_ns  = 500'000;  // 500 µs between orders
        uint64_t max_orders   = 0;        // 0 = unlimited
        uint64_t seed         = 42;
    };

    explicit NoiseTrader(MatchingEngine& engine, const Config& cfg)
        : engine_(engine)
        , cfg_(cfg)
        , rng_(cfg.seed)
        , price_dist_(0.0, static_cast<double>(cfg.price_sigma))
        , qty_dist_(cfg.min_qty, cfg.max_qty)
        , side_dist_(0, 1)
        , order_id_(1)
        , count_(0)
    {}

    bool next_order(uint64_t now_ns, Order& out) noexcept override {
        if (cfg_.max_orders > 0 && count_ >= cfg_.max_orders)
            return false;

        MarketData md = engine_.get_market_data(cfg_.symbol_id);
        Price current_mid = (md.best_bid_price > 0 && md.best_ask_price > 0)
                            ? (md.best_bid_price + md.best_ask_price) / 2
                            : cfg_.mid_price;

        int32_t offset = static_cast<int32_t>(price_dist_(rng_));
        OrderSide side = (side_dist_(rng_) == 0) ? OrderSide::BUY : OrderSide::SELL;

        // 70% aggressive crossing orders (executes against live current book)
        bool is_aggressive = (rng_() % 10 < 7);
        OrderType type = is_aggressive ? OrderType::MARKET : OrderType::LIMIT;

        Price p = current_mid;
        if (is_aggressive) {
            p = (side == OrderSide::BUY)
                ? (md.best_ask_price > 0 ? md.best_ask_price : current_mid + 5)
                : (md.best_bid_price > 0 ? md.best_bid_price : (current_mid > 5 ? current_mid - 5 : 1));
        } else {
            p = static_cast<Price>(std::max<int32_t>(1, static_cast<int32_t>(current_mid) + offset));
        }

        out = Order(order_id_++,
                    p,
                    qty_dist_(rng_),
                    side,
                    type,
                    cfg_.symbol_id,
                    cfg_.client_id,
                    now_ns);

        ++count_;
        return true;
    }

    [[nodiscard]] uint64_t  interval_ns() const noexcept override { return cfg_.interval_ns; }
    [[nodiscard]] const char* name()      const noexcept override { return "NoiseTrader"; }

    void set_mid_price(Price p) noexcept { cfg_.mid_price = p; }

private:
    MatchingEngine&                        engine_;
    Config                                 cfg_;
    std::mt19937_64                        rng_;
    std::normal_distribution<double>       price_dist_;
    std::uniform_int_distribution<Quantity> qty_dist_;
    std::uniform_int_distribution<int>     side_dist_;
    uint64_t                               order_id_;
    uint64_t                               count_;
};

} // namespace hft
