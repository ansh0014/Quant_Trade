#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <optional>
#include "../common/cacheline.hpp"
#include "../common/constants.hpp"

namespace hft {

template <typename T, size_t Capacity = SPSC_BUFFER_SIZE>
class SPSCRingBuffer {
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of two");
    static constexpr size_t MASK = Capacity - 1;

public:
    SPSCRingBuffer() noexcept
        : producer_seq_(0), consumer_seq_(0)
    {}

    SPSCRingBuffer(const SPSCRingBuffer&) = delete;
    SPSCRingBuffer& operator=(const SPSCRingBuffer&) = delete;

    [[nodiscard]] bool push(const T& item) noexcept {
        const size_t prod = producer_seq_.load(std::memory_order_relaxed);
        const size_t next = prod + 1;

        if (HFT_UNLIKELY(next - consumer_seq_.load(std::memory_order_acquire) > Capacity)) {
            return false;
        }

        slots_[prod & MASK] = item;

        producer_seq_.store(next, std::memory_order_release);
        return true;
    }

    [[nodiscard]] bool push(T&& item) noexcept {
        const size_t prod = producer_seq_.load(std::memory_order_relaxed);
        const size_t next = prod + 1;

        if (HFT_UNLIKELY(next - consumer_seq_.load(std::memory_order_acquire) > Capacity)) {
            return false;
        }

        slots_[prod & MASK] = static_cast<T&&>(item);
        producer_seq_.store(next, std::memory_order_release);
        return true;
    }

    [[nodiscard]] bool pop(T& out) noexcept {
        const size_t cons = consumer_seq_.load(std::memory_order_relaxed);

        if (HFT_UNLIKELY(producer_seq_.load(std::memory_order_acquire) == cons)) {
            return false;
        }

        out = slots_[cons & MASK];

        consumer_seq_.store(cons + 1, std::memory_order_release);
        return true;
    }

    [[nodiscard]] size_t size() const noexcept {
        const size_t prod = producer_seq_.load(std::memory_order_acquire);
        const size_t cons = consumer_seq_.load(std::memory_order_acquire);
        return prod - cons;
    }

    [[nodiscard]] bool   empty()    const noexcept { return size() == 0; }
    [[nodiscard]] size_t capacity() const noexcept { return Capacity; }

private:
    alignas(CACHELINE_SIZE) T slots_[Capacity];

    alignas(CACHELINE_SIZE) std::atomic<size_t> producer_seq_;

    alignas(CACHELINE_SIZE) std::atomic<size_t> consumer_seq_;
};

} // namespace hft
