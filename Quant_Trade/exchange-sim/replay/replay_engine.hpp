#pragma once

#include "csv_parser.hpp"

#include "../../core-cpp/include/matching_engine/matching_engine.hpp"

#include <chrono>
#include <thread>
#include <iostream>

namespace hft {

class ReplayEngine {

private:

    MatchingEngine& engine;

public:

    explicit ReplayEngine(
        MatchingEngine& e)
        : engine(e) {}

    void replay(
        const std::vector<ReplayEvent>& events,
        double speed = 1.0)
    {
        if(events.empty())
            return;

        uint64_t previous =
            events.front().timestamp_ns;

        for(const auto& event : events)
        {
            uint64_t gap =
                event.timestamp_ns
                - previous;

            if(speed > 0.0)
            {
                uint64_t sleep_ns =
                    static_cast<uint64_t>(
                        gap / speed);

                std::this_thread::sleep_for(
                    std::chrono::nanoseconds(
                        sleep_ns));
            }

            process(event);

            previous =
                event.timestamp_ns;
        }
    }

private:

    void process(
        const ReplayEvent& event)
    {
        switch(event.type)
        {
            case ReplayEventType::NEW_ORDER:
            {
                MatchResult result;
                engine.submit_order(
                    event.order, result,
                    event.timestamp_ns);

                for (uint32_t i = 0; i < result.count; ++i)
                {
                    const auto& rpt = result.reports[i];
                    if (rpt.executed_qty == 0) continue;
                    std::printf(
                        "TRADE %-6lu  %u@%u  oid=%lu\n",
                        static_cast<unsigned long>(rpt.trade_id),
                        rpt.executed_qty,
                        rpt.executed_price,
                        static_cast<unsigned long>(rpt.order_id));
                }
                break;
            }

            case ReplayEventType::CANCEL_ORDER:
                engine.cancel_order(
                    event.order.symbol_id,
                    event.order.order_id,
                    event.order.client_id,
                    event.order.sequence,
                    event.timestamp_ns);
                break;
        }
    }
};

} // namespace hft