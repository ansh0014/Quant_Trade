#pragma once

#include "order_generator.hpp"
#include "../../core-cpp/include/common/types.hpp"

#include <cstdint>
#include <random>

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

    NoiseTrader() : NoiseTrader(Config{}) {}
    explicit NoiseTrader(const Config& cfg)
        : cfg_(cfg)
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

        int32_t offset = static_cast<int32_t>(price_dist_(rng_));
        Price   p      = static_cast<Price>(
                            static_cast<int32_t>(cfg_.mid_price) + offset);
        if (p == 0) p = 1; // clamp

        OrderSide side = side_dist_(rng_) == 0
                         ? OrderSide::BUY
                         : OrderSide::SELL;

        out = Order(order_id_++,
                    p,
                    qty_dist_(rng_),
                    side,
                    OrderType::LIMIT,
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
    Config                                 cfg_;
    std::mt19937_64                        rng_;
    std::normal_distribution<double>       price_dist_;
    std::uniform_int_distribution<Quantity> qty_dist_;
    std::uniform_int_distribution<int>     side_dist_;
    uint64_t                               order_id_;
    uint64_t                               count_;
};

} // namespace hft
