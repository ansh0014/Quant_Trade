#pragma once

#include <cstddef>
#include <cstdint>
#include <new>

namespace hft {

inline constexpr size_t CACHELINE_SIZE = 64;

#define CACHELINE_ALIGNED alignas(::hft::CACHELINE_SIZE)

template <size_t UsedBytes>
struct CachelinePad {
    static_assert(UsedBytes < CACHELINE_SIZE, "UsedBytes must be < CACHELINE_SIZE");
    static constexpr size_t PAD_SIZE = CACHELINE_SIZE - UsedBytes;
    char _pad[PAD_SIZE];
};

template <>
struct CachelinePad<0> {};

template <typename T>
struct alignas(CACHELINE_SIZE) FalseSharingGuard {
    T value{};

    T& operator*()              noexcept { return value; }
    const T& operator*()  const noexcept { return value; }
    T* operator->()             noexcept { return &value; }
    const T* operator->() const noexcept { return &value; }

private:
    char _pad[CACHELINE_SIZE - (sizeof(T) % CACHELINE_SIZE == 0
                                ? CACHELINE_SIZE
                                : sizeof(T) % CACHELINE_SIZE)];
};

template <typename T>
    requires (sizeof(T) % CACHELINE_SIZE == 0)
struct alignas(CACHELINE_SIZE) FalseSharingGuard<T> {
    T value{};

    T& operator*()              noexcept { return value; }
    const T& operator*()  const noexcept { return value; }
    T* operator->()             noexcept { return &value; }
    const T* operator->() const noexcept { return &value; }
};

[[gnu::always_inline]] inline void prefetch_read(const void* ptr) noexcept {
    __builtin_prefetch(ptr, 0 /*read*/, 3 /*high temporal locality*/);
}

[[gnu::always_inline]] inline void prefetch_write(const void* ptr) noexcept {
    __builtin_prefetch(ptr, 1 /*write*/, 3);
}

#define HFT_LIKELY(x)   __builtin_expect(!!(x), 1)
#define HFT_UNLIKELY(x) __builtin_expect(!!(x), 0)

[[gnu::always_inline]] inline void cpu_relax() noexcept {
    __asm__ volatile("pause" ::: "memory");
}

[[gnu::always_inline]] inline void compiler_barrier() noexcept {
    __asm__ volatile("" ::: "memory");
}

[[nodiscard, gnu::always_inline]] inline uint64_t rdtsc() noexcept {
    uint32_t lo, hi;
    __asm__ volatile("rdtsc" : "=a"(lo), "=d"(hi));
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

[[nodiscard, gnu::always_inline]] inline uint64_t rdtscp() noexcept {
    uint32_t lo, hi, aux;
    __asm__ volatile("rdtscp" : "=a"(lo), "=d"(hi), "=c"(aux) :: "memory");
    return (static_cast<uint64_t>(hi) << 32) | lo;
}

[[gnu::always_inline]] inline void lfence() noexcept {
    __asm__ volatile("lfence" ::: "memory");
}

}
// namespace hft
