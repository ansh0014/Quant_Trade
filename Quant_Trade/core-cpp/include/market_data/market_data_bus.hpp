#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include "../common/types.hpp"
#include "../common/cacheline.hpp"
#include "../matching_engine/execution_report.hpp"

namespace hft {

struct TradeEvent {
    TradeId    trade_id;
    OrderId    bid_order_id;
    OrderId    ask_order_id;
    Price      price;
    Quantity   quantity;
    Timestamp  timestamp;
    SequenceNo sequence;
    SymbolId   symbol_id;
    uint8_t    _pad[6];
};

struct SnapshotEvent {
    Price      best_bid_price;
    Price      best_ask_price;
    Quantity   best_bid_qty;
    Quantity   best_ask_qty;
    Timestamp  timestamp;
    SequenceNo sequence;
    SymbolId   symbol_id;
    uint8_t    _pad[6];
};

struct ExecutionEvent {
    ExecutionReport report;
};

using TradeHandler     = std::function<void(const TradeEvent&)>;
using SnapshotHandler  = std::function<void(const SnapshotEvent&)>;
using ExecutionHandler = std::function<void(const ExecutionEvent&)>;

constexpr size_t MAX_SUBSCRIBERS = 16;

class MarketDataBus {
public:
    MarketDataBus() noexcept
        : trade_count_(0), snapshot_count_(0), exec_count_(0)
    {}

    bool subscribe_trades(TradeHandler handler) noexcept {
        if (trade_count_ >= MAX_SUBSCRIBERS) return false;
        trade_handlers_[trade_count_++] = std::move(handler);
        return true;
    }

    bool subscribe_snapshots(SnapshotHandler handler) noexcept {
        if (snapshot_count_ >= MAX_SUBSCRIBERS) return false;
        snapshot_handlers_[snapshot_count_++] = std::move(handler);
        return true;
    }

    bool subscribe_executions(ExecutionHandler handler) noexcept {
        if (exec_count_ >= MAX_SUBSCRIBERS) return false;
        exec_handlers_[exec_count_++] = std::move(handler);
        return true;
    }

    void publish_trade(const TradeEvent& ev) noexcept {
        for (size_t i = 0; i < trade_count_; ++i) {
            trade_handlers_[i](ev);
        }
    }

    void publish_snapshot(const SnapshotEvent& ev) noexcept {
        for (size_t i = 0; i < snapshot_count_; ++i) {
            snapshot_handlers_[i](ev);
        }
    }

    void publish_execution(const ExecutionEvent& ev) noexcept {
        for (size_t i = 0; i < exec_count_; ++i) {
            exec_handlers_[i](ev);
        }
    }

    void emit_trade(TradeId tid, OrderId bid, OrderId ask,
                    SymbolId sym, Price price, Quantity qty,
                    SequenceNo seq, Timestamp ts) noexcept {
        TradeEvent ev{};
        ev.trade_id      = tid;
        ev.bid_order_id  = bid;
        ev.ask_order_id  = ask;
        ev.symbol_id     = sym;
        ev.price         = price;
        ev.quantity      = qty;
        ev.sequence      = seq;
        ev.timestamp     = ts;
        publish_trade(ev);
    }

    void emit_snapshot(SymbolId sym,
                       Price bid_p, Quantity bid_q,
                       Price ask_p, Quantity ask_q,
                       SequenceNo seq, Timestamp ts) noexcept {
        SnapshotEvent ev{};
        ev.symbol_id      = sym;
        ev.best_bid_price = bid_p;
        ev.best_bid_qty   = bid_q;
        ev.best_ask_price = ask_p;
        ev.best_ask_qty   = ask_q;
        ev.sequence       = seq;
        ev.timestamp      = ts;
        publish_snapshot(ev);
    }

    void emit_execution(const ExecutionReport& rpt) noexcept {
        ExecutionEvent ev{rpt};
        publish_execution(ev);
    }

    [[nodiscard]] size_t trade_subscriber_count()    const noexcept { return trade_count_; }
    [[nodiscard]] size_t snapshot_subscriber_count() const noexcept { return snapshot_count_; }
    [[nodiscard]] size_t exec_subscriber_count()     const noexcept { return exec_count_; }

private:
    std::array<TradeHandler,     MAX_SUBSCRIBERS> trade_handlers_;
    std::array<SnapshotHandler,  MAX_SUBSCRIBERS> snapshot_handlers_;
    std::array<ExecutionHandler, MAX_SUBSCRIBERS> exec_handlers_;

    size_t trade_count_;
    size_t snapshot_count_;
    size_t exec_count_;
};

} // namespace hft
