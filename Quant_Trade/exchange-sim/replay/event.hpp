#pragma once

#include "../../core-cpp/include/common/types.hpp"

namespace hft {

enum class ReplayEventType {
    NEW_ORDER,
    CANCEL_ORDER
};

struct ReplayEvent {
    uint64_t timestamp_ns;
    ReplayEventType type;
    Order order;
};

} // namespace hft