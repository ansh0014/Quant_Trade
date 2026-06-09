#pragma once

#include "types.hpp"
#include <atomic>
#include <array>
#include <cstdio>
#include <cstring>

namespace hft {


class LowLatencyLogger {
private:
    static constexpr size_t BUFFER_CAPACITY = 65536;
    static constexpr size_t BUFFER_MASK = BUFFER_CAPACITY - 1;
    
    struct LogEntry {
        uint64_t timestamp;
        uint32_t latency_cycles;
        uint32_t event_type;
        char message[48];
    } alignas(64);  
    
    std::array<LogEntry, BUFFER_CAPACITY> buffer;
    std::atomic<uint64_t> write_index{0};  
    
public:
    enum class EventType : uint32_t {
        ORDER_RECEIVED = 0,
        ORDER_MATCHED = 1,
        ORDER_CANCELLED = 2,
        TRADE_GENERATED = 3,
        RISK_CHECK_FAILED = 4,
        STRATEGY_ORDER = 5
    };
    
    LowLatencyLogger() = default;
    ~LowLatencyLogger() = default;
    
    
    void log(uint64_t timestamp, uint32_t cycles, EventType type, const char* msg) noexcept {
      
        uint64_t idx = write_index.fetch_add(1, std::memory_order_relaxed);
        
     
        size_t slot = idx & BUFFER_MASK;
        

        LogEntry& entry = buffer[slot];
        entry.timestamp = timestamp;
        entry.latency_cycles = cycles;
        entry.event_type = static_cast<uint32_t>(type);
        std::strncpy(entry.message, msg, sizeof(entry.message) - 1);
        entry.message[47] = '\0';
    }
    

    void dump_stats(const char* filename) const noexcept {
        FILE* f = std::fopen(filename, "w");
        if (!f) return;
        
      
        std::fprintf(f, "timestamp,cycles,event_type,message\n");
        
        uint64_t current_idx = write_index.load();
        uint64_t start_idx = 0;
  
        if (current_idx >= BUFFER_CAPACITY) {
            start_idx = current_idx - BUFFER_CAPACITY;
        }
        
   
        for (uint64_t i = start_idx; i < current_idx; ++i) {
            size_t slot = i & BUFFER_MASK;
            const auto& entry = buffer[slot];
            std::fprintf(f, "%lu,%u,%u,%s\n", 
                        entry.timestamp, 
                        entry.latency_cycles,
                        entry.event_type,
                        entry.message);
        }
        
        std::fclose(f);
    }
    

    uint64_t total_entries() const noexcept {
        return write_index.load();
    }
    

    size_t capacity() const noexcept {
        return BUFFER_CAPACITY;
    }
};

}   // namespace hft
