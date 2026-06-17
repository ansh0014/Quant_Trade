#pragma once

#include "event.hpp"

#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <stdexcept>

namespace hft {

// CSV format (header row required):
//   timestamp_ns,side,price,qty,symbol_id[,client_id[,order_type]]
//
// side      : BUY | SELL
// order_type: LIMIT (default) | MARKET | IOC | FOK

class CSVParser {
public:

    static std::vector<ReplayEvent>
    parse(const std::string& file)
    {
        std::vector<ReplayEvent> events;

        std::ifstream in(file);
        if (!in.is_open()) {
            std::fprintf(stderr,
                "CSVParser: unable to open replay file: %s\n", file.c_str());
            return events;
        }

        std::string line;
        getline(in, line); // skip header

        static uint64_t oid_counter = 1; // monotonic order-id across calls

        while (getline(in, line)) {
            if (line.empty()) continue;

            std::stringstream ss(line);

            std::string col_ts, col_side, col_price,
                        col_qty, col_sym, col_cid, col_type;

            getline(ss, col_ts,    ',');
            getline(ss, col_side,  ',');
            getline(ss, col_price, ',');
            getline(ss, col_qty,   ',');
            getline(ss, col_sym,   ',');
            getline(ss, col_cid,   ','); // optional
            getline(ss, col_type,  ','); // optional

            if (col_ts.empty() || col_side.empty() ||
                col_price.empty() || col_qty.empty() || col_sym.empty())
                continue;

            const uint64_t ts        = std::stoull(col_ts);
            const Price    price     = static_cast<Price>(std::stoul(col_price));
            const Quantity qty       = static_cast<Quantity>(std::stoul(col_qty));
            const SymbolId sym       = static_cast<SymbolId>(std::stoul(col_sym));
            const ClientId cid       = col_cid.empty()
                                       ? ClientId{0}
                                       : static_cast<ClientId>(std::stoul(col_cid));

            const OrderSide side = (col_side == "BUY")
                                   ? OrderSide::BUY
                                   : OrderSide::SELL;

            OrderType otype = OrderType::LIMIT;
            if      (col_type == "MARKET") otype = OrderType::MARKET;
            else if (col_type == "IOC")    otype = OrderType::IOC;
            else if (col_type == "FOK")    otype = OrderType::FOK;

            Order order(oid_counter++, price, qty, side, otype, sym, cid, ts);

            ReplayEvent event;
            event.timestamp_ns = ts;
            event.type         = ReplayEventType::NEW_ORDER;
            event.order        = order;

            events.push_back(event);
        }

        return events;
    }
};

} // namespace hft