#pragma once

#include <cstdint>
#include <array>
#include "../common/types.hpp"
#include "../common/constants.hpp"
#include "../common/cacheline.hpp"

namespace hft {

struct Position {
    int64_t  net_qty       = 0;
    int64_t  long_qty      = 0;
    int64_t  short_qty     = 0;
    int64_t  realized_pnl  = 0;
    int64_t  unrealized_pnl = 0;
    uint64_t avg_cost      = 0;
    uint32_t avg_price     = 0;

    void on_fill(OrderSide side, Price price, Quantity qty) noexcept {
        const int64_t signed_qty = (side == OrderSide::BUY)
                                   ? static_cast<int64_t>(qty)
                                   : -static_cast<int64_t>(qty);

        if (net_qty == 0) {
            net_qty   = signed_qty;
            avg_price = price;
            avg_cost  = static_cast<uint64_t>(price) * qty;
        } else if ((net_qty > 0) == (signed_qty > 0)) {
            const int64_t new_qty  = net_qty + signed_qty;
            const uint64_t new_cost = avg_cost + static_cast<uint64_t>(price) * qty;
            avg_cost  = new_cost;
            avg_price = static_cast<uint32_t>(new_cost / static_cast<uint64_t>(new_qty > 0 ? new_qty : -new_qty));
            net_qty   = new_qty;
        } else {
            const int64_t close_qty = (signed_qty < 0)
                ? -std::min(-signed_qty, net_qty)
                : -std::min(signed_qty, -net_qty);
            const int64_t abs_close = close_qty < 0 ? -close_qty : close_qty;

            if (net_qty > 0) {
                realized_pnl += (static_cast<int64_t>(price) - avg_price) * abs_close;
            } else {
                realized_pnl += (static_cast<int64_t>(avg_price) - price) * abs_close;
            }

            net_qty += signed_qty;
            if (net_qty == 0) {
                avg_price = 0;
                avg_cost  = 0;
            }
        }

        if (side == OrderSide::BUY)  long_qty  += qty;
        else                         short_qty += qty;
    }

    void mark_to_market(Price market_price) noexcept {
        if (net_qty == 0) { unrealized_pnl = 0; return; }
        unrealized_pnl = (static_cast<int64_t>(market_price) - avg_price) * net_qty;
    }

    [[nodiscard]] int64_t total_pnl() const noexcept {
        return realized_pnl + unrealized_pnl;
    }
};

class PositionManager {
public:
    PositionManager() noexcept = default;

    void on_trade(ClientId client_id, SymbolId sym,
                  OrderSide side, Price price, Quantity qty) noexcept
    {
        if (HFT_UNLIKELY(client_id >= MAX_CLIENTS || sym >= MAX_SYMBOLS)) return;
        positions_[client_id][sym].on_fill(side, price, qty);
    }

    [[nodiscard]] const Position& get_position(ClientId client_id, SymbolId sym) const noexcept {
        static const Position zero{};
        if (HFT_UNLIKELY(client_id >= MAX_CLIENTS || sym >= MAX_SYMBOLS)) return zero;
        return positions_[client_id][sym];
    }

    [[nodiscard]] int64_t get_net_qty(ClientId client_id, SymbolId sym) const noexcept {
        if (HFT_UNLIKELY(client_id >= MAX_CLIENTS || sym >= MAX_SYMBOLS)) return 0;
        return positions_[client_id][sym].net_qty;
    }

    void mark_all(SymbolId sym, Price market_price) noexcept {
        if (HFT_UNLIKELY(sym >= MAX_SYMBOLS)) return;
        for (size_t c = 0; c < MAX_CLIENTS; ++c) {
            positions_[c][sym].mark_to_market(market_price);
        }
    }

    void reset_client(ClientId client_id) noexcept {
        if (HFT_UNLIKELY(client_id >= MAX_CLIENTS)) return;
        for (auto& p : positions_[client_id]) p = Position{};
    }

private:
    std::array<std::array<Position, MAX_SYMBOLS>, MAX_CLIENTS> positions_;
};

} // namespace hft
