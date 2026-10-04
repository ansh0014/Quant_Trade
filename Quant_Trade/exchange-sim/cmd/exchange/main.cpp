
#include "../../replay/replay_engine.hpp"
#include "../../replay/csv_parser.hpp"
#include "../../replay/replay_controller.hpp"
#include "../../generators/market_maker.cpp"
#include "../../generators/noise_trader.hpp"
#include "../../generators/order_generator.hpp"
#include "../../market_data/snapshot_publisher.hpp"
#include "../../market_data/trade_publisher.hpp"
#include "../../market_data/ws_publisher.hpp"
#include "../../simulator/simulation_clock.hpp"
#include "../../simulator/event_scheduler.hpp"

// core-cpp is 2 levels up from cmd/exchange/
#include "../../core-cpp/include/matching_engine/matching_engine.hpp"
#include "../../core-cpp/include/common/types.hpp"
#include "../../core-cpp/include/common/cacheline.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <chrono>
#include <memory>
#include <unordered_map>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static void print_usage(const char* prog) {
    std::printf(
        "Usage:\n"
        "  %s --replay  <csv_file> [--speed <multiplier>]\n"
        "  %s --synth   [--duration <seconds>] [--symbol <id>]\n"
        "               [--spread <ticks>] [--noise-interval-us <us>]\n"
        "               [--ws-port <port>]\n"
        "\n"
        "Options:\n"
        "  --speed               Replay speed multiplier (default 1.0, 0=max)\n"
        "  --duration            Synthetic sim duration in seconds (default 10)\n"
        "  --symbol              Symbol id (default 0)\n"
        "  --spread              Market-maker half-spread in ticks (default 5)\n"
        "  --noise-interval-us   Noise trader period in us (default 500)\n"
        "  --ws-port             WebSocket broadcast port (default 8080, 0=off)\n",
        prog, prog);
}

// ---------------------------------------------------------------------------
// REPLAY mode
// ---------------------------------------------------------------------------
static int run_replay(const std::string& csv_path, double speed)
{
    std::printf("=== REPLAY MODE  file=%s  speed=%.2f ===\n",
                csv_path.c_str(), speed);

    // CSVParser returns empty vector on error (no exceptions)
    std::vector<hft::ReplayEvent> events =
        hft::CSVParser::parse(csv_path);

    if (events.empty()) {
        std::fprintf(stderr, "No events loaded — aborting.\n");
        return 1;
    }
    std::printf("Loaded %zu events\n", events.size());

    // Dynamically allocate MatchingEngine on the heap to avoid stack overflow (64MB structure)
    auto engine = std::make_unique<hft::MatchingEngine>();
    hft::ReplayEngine replay_engine(*engine);
    replay_engine.replay(events, speed);

    std::printf("\nReplay complete.  Orders: %zu  Pool used: %zu\n",
                events.size(), engine->node_pool_used());
    return 0;
}

// ---------------------------------------------------------------------------
// SYNTHETIC mode
// ---------------------------------------------------------------------------
static int run_synth(hft::SymbolId symbol_id,
                     uint32_t      half_spread,
                     uint64_t      noise_interval_us,
                     uint64_t      duration_sec,
                     int           ws_port)
{
    std::printf(
        "=== SYNTH MODE  symbol=%u  spread=+/-%u  noise=%llu us  duration=%llu s ===\n",
        static_cast<unsigned>(symbol_id),
        half_spread,
        static_cast<unsigned long long>(noise_interval_us),
        static_cast<unsigned long long>(duration_sec));

    // Dynamically allocate MatchingEngine on the heap to avoid stack overflow (64MB structure)
    auto engine = std::make_unique<hft::MatchingEngine>();
    hft::SimulationClock clock;
    hft::EventScheduler  scheduler;

    // -- WebSocket publisher -------------------------------------------------
    // Symbol map for JSON: symbol_id (uint16) -> string name
    std::unordered_map<uint16_t, std::string> sym_map;
    sym_map[0] = "AAPL";
    sym_map[1] = "MSFT";
    sym_map[2] = "TSLA";
    sym_map[3] = "NVDA";

    hft::WsPublisher ws_pub(ws_port);
    if (ws_port > 0) {
        ws_pub.start();
    }

    // -- Snapshot publisher --------------------------------------------------
    hft::SnapshotPublisher snap_pub;
    snap_pub.subscribe([&ws_pub, &sym_map, ws_port](const hft::MarketData& md) {
        static uint64_t cnt = 0;
        const uint64_t now = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count());
        if (++cnt % 2000 == 0) {
            std::printf("[SNAP] #%llu sym=%u  bid=%u/%u  ask=%u/%u  last=%u  ws_clients=%zu\n",
                static_cast<unsigned long long>(cnt),
                md.symbol_id,
                md.best_bid_price, md.best_bid_qty,
                md.best_ask_price, md.best_ask_qty,
                md.last_trade_price,
                ws_port > 0 ? ws_pub.client_count() : 0);
        }
        if (ws_port > 0) {
            ws_pub.publish_tick(md, sym_map, now);
        }
    });

    // -- Trade publisher -----------------------------------------------------
    uint64_t trade_count = 0;
    hft::TradePublisher trade_pub;
    trade_pub.subscribe([&trade_count, &ws_pub, ws_port](const hft::Trade& t) {
        ++trade_count;
        if (ws_port > 0) {
            ws_pub.publish_trade(t);
        }
    });

    const uint64_t end_ns = duration_sec * 1'000'000'000ULL;

    struct SymbolConfig {
        hft::SymbolId id;
        uint32_t price;
        uint32_t spread;
    };
    std::vector<SymbolConfig> active_syms = {
        { 0, 18500, half_spread },       // AAPL ($185.00)
        { 1, 42000, half_spread + 1 },   // MSFT ($420.00)
        { 2, 24000, half_spread + 2 },   // TSLA ($240.00)
        { 3, 12500, half_spread }        // NVDA ($125.00)
    };

    std::vector<std::unique_ptr<hft::MarketMaker>> mms;
    std::vector<std::unique_ptr<hft::NoiseTrader>> nts;

    for (size_t s = 0; s < active_syms.size(); ++s) {
        const auto& sc = active_syms[s];

        // Market Maker
        hft::MarketMaker::Config mm_cfg;
        mm_cfg.symbol_id   = sc.id;
        mm_cfg.client_id   = static_cast<hft::ClientId>(10 + s);
        mm_cfg.half_spread = sc.spread;
        mm_cfg.quote_qty   = 200;
        mm_cfg.ref_price   = sc.price;
        mm_cfg.interval_ns = 1'000'000; // 1 ms
        auto mm = std::make_unique<hft::MarketMaker>(*engine, mm_cfg);

        // Noise Trader
        hft::NoiseTrader::Config nt_cfg;
        nt_cfg.symbol_id   = sc.id;
        nt_cfg.client_id   = static_cast<hft::ClientId>(20 + s);
        nt_cfg.mid_price   = sc.price;
        nt_cfg.price_sigma = 15;
        nt_cfg.min_qty     = 1;
        nt_cfg.max_qty     = 100;
        nt_cfg.interval_ns = (noise_interval_us + s * 10000) * 1'000;
        nt_cfg.seed        = 0xdeadbeefULL + s * 0x12345ULL;
        auto nt = std::make_unique<hft::NoiseTrader>(nt_cfg);

        auto* mm_ptr = mm.get();
        auto* nt_ptr = nt.get();
        auto sym = sc.id;

        mms.push_back(std::move(mm));
        nts.push_back(std::move(nt));

        // Schedule market-maker refreshes
        scheduler.schedule_recurring(
            mm_cfg.interval_ns, mm_cfg.interval_ns,
            [&, mm_ptr, sym](uint64_t fire_ns) {
                if (fire_ns > end_ns) return false;
                hft::Order dummy;
                mm_ptr->next_order(fire_ns, dummy);
                snap_pub.publish(engine->get_market_data(sym));
                return true;
            });

        // Schedule noise-trader orders
        scheduler.schedule_recurring(
            nt_cfg.interval_ns, nt_cfg.interval_ns,
            [&, nt_ptr, sym](uint64_t fire_ns) {
                if (fire_ns > end_ns) return false;
                hft::Order order;
                if (!nt_ptr->next_order(fire_ns, order)) return false;

                hft::MatchResult result;
                engine->submit_order(order, result, fire_ns);

                if (result.matched) {
                    for (uint32_t i = 0; i < result.fill_count; ++i) {
                        const auto& taker_rpt = result.reports[i * 2];
                        const auto& maker_rpt = result.reports[i * 2 + 1];
                        if (taker_rpt.executed_qty == 0) continue;
                        hft::Trade trade;
                        trade.trade_id     = taker_rpt.trade_id;
                        trade.bid_order_id = order.is_buy() ? order.order_id : maker_rpt.order_id;
                        trade.ask_order_id = order.is_buy() ? maker_rpt.order_id : order.order_id;
                        trade.price        = taker_rpt.executed_price;
                        trade.quantity     = taker_rpt.executed_qty;
                        trade.symbol_id    = sym;
                        trade.timestamp    = fire_ns;
                        trade_pub.publish(trade);
                    }
                }
                return true;
            });
    }

    // -- Run -----------------------------------------------------------------
    const auto t0 = std::chrono::steady_clock::now();
    scheduler.run_all(clock);
    const auto t1 = std::chrono::steady_clock::now();

    const double wall_ms =
        std::chrono::duration<double, std::milli>(t1 - t0).count();

    std::printf("\n=== SYNTH COMPLETE ===\n");
    std::printf("  Simulated time : %.3f s\n",
                static_cast<double>(end_ns) / 1e9);
    std::printf("  Wall time      : %.1f ms\n", wall_ms);
    std::printf("  Trades matched : %llu\n",
                static_cast<unsigned long long>(trade_count));
    std::printf("  Snapshots pub  : %llu\n",
                static_cast<unsigned long long>(snap_pub.publish_count()));
    std::printf("  Pool used      : %zu\n", engine->node_pool_used());
    return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(int argc, char* argv[])
{
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    std::string   mode;
    std::string   csv_path;
    double        speed        = 1.0;
    uint64_t      duration_sec = 10;
    hft::SymbolId symbol_id   = 0;
    uint32_t      half_spread  = 5;
    uint64_t      noise_us     = 500;
    int           ws_port      = 8080;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];

        if      (arg == "--replay" && i + 1 < argc)            { mode = "replay"; csv_path = argv[++i]; }
        else if (arg == "--synth")                             { mode = "synth"; }
        else if (arg == "--speed" && i + 1 < argc)            { speed = std::atof(argv[++i]); }
        else if (arg == "--duration" && i + 1 < argc)         { duration_sec = static_cast<uint64_t>(std::atoll(argv[++i])); }
        else if (arg == "--symbol" && i + 1 < argc)           { symbol_id = static_cast<hft::SymbolId>(std::atoi(argv[++i])); }
        else if (arg == "--spread" && i + 1 < argc)           { half_spread = static_cast<uint32_t>(std::atoi(argv[++i])); }
        else if (arg == "--noise-interval-us" && i + 1 < argc){ noise_us = static_cast<uint64_t>(std::atoll(argv[++i])); }
        else if (arg == "--ws-port" && i + 1 < argc)          { ws_port = std::atoi(argv[++i]); }
        else if (arg == "--help" || arg == "-h")               { print_usage(argv[0]); return 0; }
        else {
            std::fprintf(stderr, "Unknown argument: %s\n", arg.c_str());
            print_usage(argv[0]);
            return 1;
        }
    }

    if      (mode == "replay") return run_replay(csv_path, speed);
    else if (mode == "synth")  return run_synth(symbol_id, half_spread, noise_us, duration_sec, ws_port);
    else {
        std::fprintf(stderr, "Error: must specify --replay or --synth\n");
        print_usage(argv[0]);
        return 1;
    }
}
