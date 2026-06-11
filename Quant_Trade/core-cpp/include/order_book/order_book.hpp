#pragma once

#include <cstddef>
#include <cstdint>
#include <array>
#include <unordered_map>
#include <map>
#include <functional>
#include "../common/types.hpp"
#include "../common/constants.hpp"
#include "../common/cacheline.hpp"
#include "../memory/object_pool.hpp"
#include "order_node.hpp"
#include "price_level.hpp"

namespace hft {

using FillCallback = std::function<void(OrderNode*, OrderNode*, Quantity, Price)>;

class OrderBook {
public:
    explicit OrderBook(SymbolId sym) noexcept
        : symbol_id_(sym)
    {}

    OrderBook(const OrderBook&) = delete;
    OrderBook& operator=(const OrderBook&) = delete;

    void add_order(OrderNode* node) noexcept {
        if (node->is_buy()) {
            bids_[node->price].push_back(node);
            bids_[node->price].price = node->price;
        } else {
            asks_[node->price].push_back(node);
            asks_[node->price].price = node->price;
        }
        lookup_[node->order_id] = node;
    }

    [[nodiscard]] OrderNode* cancel_order(OrderId id) noexcept {
        auto it = lookup_.find(id);
        if (HFT_UNLIKELY(it == lookup_.end())) return nullptr;

        OrderNode* node = it->second;
        lookup_.erase(it);
        remove_from_book(node);
        return node;
    }

    bool modify_order(OrderId id, Price new_price, Quantity new_qty) noexcept {
        OrderNode* node = cancel_order(id);
        if (HFT_UNLIKELY(!node)) return false;

        node->price     = new_price;
        node->orig_qty  = new_qty;
        node->remain_qty = new_qty;
        node->status    = static_cast<uint8_t>(OrderStatus::ACCEPTED);

        add_order(node);
        return true;
    }

    Quantity match_order(OrderNode* taker, FillCallback& cb) noexcept {
        const bool is_buy = taker->is_buy();
        auto match_loop = [&](auto& opposite_side) {
            while (taker->remain_qty > 0 && !opposite_side.empty()) {
                auto level_it = opposite_side.begin();
                PriceLevel& level = level_it->second;

                if (!price_crosses(taker, level.price, is_buy)) break;

                OrderNode* maker = level.front();
                if (HFT_UNLIKELY(!maker)) {
                    opposite_side.erase(level_it);
                    continue;
                }

                const Quantity fill_qty = (taker->remain_qty < maker->remain_qty)
                                            ? taker->remain_qty
                                            : maker->remain_qty;
                const Price   fill_price = maker->price;

                taker->remain_qty -= fill_qty;
                maker->remain_qty -= fill_qty;
                level.reduce_qty(fill_qty);

                cb(taker, maker, fill_qty, fill_price);

                if (maker->remain_qty == 0) {
                    (void)level.pop_front();
                    lookup_.erase(maker->order_id);
                    if (level.empty()) {
                        opposite_side.erase(level_it);
                    }
                }
            }
        };

        if (taker->is_buy()) {
            match_loop(asks_);
        } else {
            match_loop(bids_);
        }

        return taker->remain_qty;
    }

    [[nodiscard]] MarketData snapshot() const noexcept {
        MarketData md(symbol_id_);
        if (!bids_.empty()) {
            const auto& bl = bids_.begin()->second;
            md.best_bid_price = bl.price;
            md.best_bid_qty   = bl.agg_qty;
        }
        if (!asks_.empty()) {
            const auto& al = asks_.begin()->second;
            md.best_ask_price = al.price;
            md.best_ask_qty   = al.agg_qty;
        }
        return md;
    }

    [[nodiscard]] Price best_bid() const noexcept {
        return bids_.empty() ? INVALID_PRICE : bids_.begin()->first;
    }

    [[nodiscard]] Price best_ask() const noexcept {
        return asks_.empty() ? INVALID_PRICE : asks_.begin()->first;
    }

    [[nodiscard]] size_t bid_levels() const noexcept { return bids_.size(); }
    [[nodiscard]] size_t ask_levels() const noexcept { return asks_.size(); }
    [[nodiscard]] size_t order_count() const noexcept { return lookup_.size(); }
    [[nodiscard]] SymbolId symbol() const noexcept { return symbol_id_; }

    template <typename Fn>
    void for_each_bid_level(Fn&& fn, size_t max_levels = 10) const noexcept {
        size_t n = 0;
        for (const auto& [price, level] : bids_) {
            if (n++ >= max_levels) break;
            fn(price, level.agg_qty, level.order_cnt);
        }
    }

    template <typename Fn>
    void for_each_ask_level(Fn&& fn, size_t max_levels = 10) const noexcept {
        size_t n = 0;
        for (const auto& [price, level] : asks_) {
            if (n++ >= max_levels) break;
            fn(price, level.agg_qty, level.order_cnt);
        }
    }

    void clear() noexcept {
        bids_.clear();
        asks_.clear();
        lookup_.clear();
    }

private:
    [[nodiscard]] static bool price_crosses(
        const OrderNode* taker, Price maker_price, bool taker_is_buy) noexcept
    {
        if (taker->is_market()) return true;
        return taker_is_buy ? (taker->price >= maker_price)
                            : (taker->price <= maker_price);
    }

    void remove_from_book(OrderNode* node) noexcept {
        if (node->is_buy()) {
            auto it = bids_.find(node->price);
            if (it != bids_.end()) {
                it->second.remove(node);
                if (it->second.empty()) bids_.erase(it);
            }
        } else {
            auto it = asks_.find(node->price);
            if (it != asks_.end()) {
                it->second.remove(node);
                if (it->second.empty()) asks_.erase(it);
            }
        }
    }

    SymbolId symbol_id_;

    std::map<Price, PriceLevel, std::greater<Price>> bids_;
    std::map<Price, PriceLevel, std::less<Price>>    asks_;
    std::unordered_map<OrderId, OrderNode*>          lookup_;
};

} // namespace hft
