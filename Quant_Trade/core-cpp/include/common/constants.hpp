#pragma once

#include <cstddef>
#include <cstdint>

namespace hft {

constexpr size_t   PAGE_SIZE       = 4096;
constexpr size_t   HUGEPAGE_SIZE   = 2 * 1024 * 1024; // 2 MB

constexpr size_t   MAX_SYMBOLS     = 1024;
constexpr size_t   MAX_ORDERS      = 1ULL << 20;  // 1M orders in pool
constexpr size_t   MAX_TRADES      = 1ULL << 23;  // 8M trades in pool
constexpr size_t   MAX_CLIENTS     = 10000;
constexpr size_t   MAX_PRICE_LEVELS = 16384;       // must be power-of-two for mask tricks

constexpr size_t   SPSC_BUFFER_SIZE = 1ULL << 17;  // 131072 slots
constexpr size_t   MPSC_BUFFER_SIZE = 1ULL << 16;  // 65536 slots
constexpr size_t   DISRUPTOR_SIZE   = 1ULL << 20;  // 1M slots

constexpr size_t   JOURNAL_FLUSH_BATCH = 256;
constexpr size_t   MAX_JOURNAL_FILE_BYTES = 1ULL << 30; // 1 GB

constexpr int64_t  DEFAULT_MAX_POSITION     = 1'000'000;
constexpr int64_t  DEFAULT_MAX_LOSS         = 500'000;
constexpr uint32_t DEFAULT_MAX_ORDER_QTY    = 100'000;
constexpr uint32_t DEFAULT_PRICE_COLLAR_PCT = 5;      // +/- 5% of reference price

constexpr uint64_t INVALID_ORDER_ID  = 0;
constexpr uint64_t INVALID_TRADE_ID  = 0;
constexpr uint32_t INVALID_PRICE     = 0;
constexpr uint32_t MARKET_ORDER_PRICE = 0xFFFFFFFFu; // sentinel for market orders

} // namespace hft
