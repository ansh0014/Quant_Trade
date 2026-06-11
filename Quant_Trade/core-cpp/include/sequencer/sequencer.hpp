#pragma once

#include <atomic>
#include <cstdint>
#include "../common/cacheline.hpp"

namespace hft {

class Sequencer {
public:
    explicit Sequencer(uint64_t start = 1) noexcept
        : seq_(start)
    {}

    Sequencer(const Sequencer&) = delete;
    Sequencer& operator=(const Sequencer&) = delete;

    [[nodiscard]] uint64_t next_sequence() noexcept {
        return seq_.fetch_add(1, std::memory_order_relaxed);
    }

    [[nodiscard]] uint64_t peek() const noexcept {
        return seq_.load(std::memory_order_acquire);
    }

    void reset(uint64_t val = 1) noexcept {
        seq_.store(val, std::memory_order_seq_cst);
    }

    [[nodiscard]] uint64_t batch_claim(uint64_t count) noexcept {
        return seq_.fetch_add(count, std::memory_order_relaxed);
    }

private:
    alignas(CACHELINE_SIZE) std::atomic<uint64_t> seq_;
    char _pad[CACHELINE_SIZE - sizeof(std::atomic<uint64_t>)];
};

} // namespace hft
