#pragma once

#include <cstdint>
#include <atomic>
#include <array>
#include <cstring>

namespace hft {

constexpr size_t CACHE_LINE_SIZE = 64;

enum class OrderSide : uint8_t {
    BUY = 0,
    SELL = 1
};

enum class OrderState : uint8_t {
    PENDING = 0,
    ACCEPTED = 1,
    PARTIALLY_FILLED = 2,
    FILLED = 3,
    CANCELLED = 4,
    REJECTED = 5
};


struct alignas(CACHE_LINE_SIZE) Order {
    uint64_t order_id;           
    uint32_t price;              
    uint32_t quantity;           
    uint32_t filled;             
    uint32_t client_id;          
    uint32_t timestamp;          
    uint16_t symbol_id;         
    uint8_t side;                
    uint8_t state;               
    
    
    Order() = default;
    Order(uint64_t oid, uint32_t p, uint32_t q, OrderSide s, uint16_t sym)
        : order_id(oid), price(p), quantity(q), filled(0), 
          timestamp(0), symbol_id(sym), 
          side(static_cast<uint8_t>(s)), 
          state(static_cast<uint8_t>(OrderState::PENDING)) {}
    
    uint32_t remaining() const noexcept {
        return quantity - filled;
    }
    
    bool is_filled() const noexcept {
        return filled >= quantity;
    }
};


struct alignas(CACHE_LINE_SIZE) Trade {
    uint64_t trade_id;
    uint64_t bid_order_id;
    uint64_t ask_order_id;
    uint32_t price;
    uint32_t quantity;
    uint32_t timestamp;
    uint16_t symbol_id;
    uint8_t pad[6];  
    
    Trade() = default;
    Trade(uint64_t tid, uint64_t bid, uint64_t ask, uint32_t p, uint32_t q, uint16_t sym)
        : trade_id(tid), bid_order_id(bid), ask_order_id(ask), 
          price(p), quantity(q), symbol_id(sym) {}
};


struct OrderBookLevel {
    uint32_t price;
    uint32_t quantity;
    uint32_t order_count;
};
struct alignas(CACHE_LINE_SIZE) MarketData {
    uint32_t best_bid_price;
    uint32_t best_ask_price;
    uint32_t best_bid_qty;
    uint32_t best_ask_qty;
    uint32_t last_trade_price;
    uint32_t timestamp;
    uint16_t symbol_id;
    uint8_t pad[6];  
    
    MarketData() = default;
    MarketData(uint16_t sym)
        : best_bid_price(0), best_ask_price(0), best_bid_qty(0), 
          best_ask_qty(0), last_trade_price(0), timestamp(0), symbol_id(sym) {}
};

struct LatencyStats {
    uint64_t min_cycles;
    uint64_t max_cycles;
    uint64_t total_cycles;
    uint64_t count;
    
    LatencyStats() : min_cycles(~0ULL), max_cycles(0), total_cycles(0), count(0) {}
    
    void record(uint64_t cycles) noexcept {
        if (cycles < min_cycles) min_cycles = cycles;
        if (cycles > max_cycles) max_cycles = cycles;
        total_cycles += cycles;
        count++;
    }
    
    uint64_t avg_cycles() const noexcept {
        return count > 0 ? total_cycles / count : 0;
    }
    
    double avg_ns(double cpu_ghz) const noexcept {
        return avg_cycles() / cpu_ghz;
    }
};

constexpr size_t MAX_ORDERS = 1024 * 1024; 
constexpr size_t MAX_TRADES = 10 * 1024 * 1024; 
constexpr size_t SYMBOLS = 1024;  
constexpr size_t PRICE_LEVELS = 10000; 

}  